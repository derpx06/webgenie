import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import type { AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import { handleAgentError, isFatalAgentError } from './utils/error-handler';
import { preparePlannerMessages, cleanPlannerOutput, createPlannerParseFallbackOutput } from './planner/utils';
import { ContextBuilder } from '../memory';
import type { HumanMessage } from '@langchain/core/messages';
import { plannerLLMOutputSchema, type NextStepContract, type PlannerLLMOutput, type PlanningMode } from '../contracts';
import { buildToolDefinitions, buildToolValidators } from '../actions/builder';
import type { ActionSchema } from '../actions/schemas';
import { ResponseParseError } from './errors';

const logger = createLogger('PlannerAgent');

export const planToolSchema: ActionSchema = {
  name: 'plan',
  description:
    'Report whether the user task is complete and, if it is not, the next phase for the browser navigator. Call it exactly once.',
  schema: plannerLLMOutputSchema,
};

const PLAN_TOOLS = buildToolDefinitions([planToolSchema]);
const PLAN_VALIDATORS = buildToolValidators([planToolSchema]);

export type PlannerOutput = PlannerLLMOutput & {
  mode?: PlanningMode;
  next_step_contract?: NextStepContract | null;
};

export class PlannerAgent extends BaseAgent<PlannerOutput> {
  private lastBroadcastPlan = '';

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(options, { ...extraOptions, id: 'planner' });
  }

  async execute(state: HumanMessage): Promise<AgentOutput<PlannerOutput>> {
    try {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');

      const contextPacket = ContextBuilder.buildContextPacket(this.context, this.prompt.getSystemMessage(), state, 'planner');

      const plannerMessages = preparePlannerMessages(
        contextPacket,
        this.context.options.useVision,
        this.context.options.useVisionForPlanner,
      );

      const { calls } = await this.invokeWithTools(plannerMessages, PLAN_TOOLS, PLAN_VALIDATORS);

      const transcript = this.context.messageManager.getTranscript();
      const latestTask = transcript.map(entry => entry.type).lastIndexOf('task');
      const cleanedPlan = cleanPlannerOutput(calls[0].args as unknown as PlannerLLMOutput, {
        goal: this.context.memory.goalManager.getCurrentGoal() || this.context.memory.goalManager.getPrimaryGoal() || '',
        currentObservation: this.context.activeObservation ?? null,
        userAnswered: transcript.slice(latestTask + 1).some(entry => entry.type === 'human_answer'),
      });

      // Save macro objective to context
      if (!cleanedPlan.done && cleanedPlan.macro_objective) {
        this.context.lastMacroObjective = cleanedPlan.macro_objective;
      }
      this.context.currentContract = cleanedPlan.next_step_contract ?? null;
      if (this.context.traceStore) {
        void this.context.traceStore.append({
          taskId: this.context.taskId,
          actor: 'planner',
          type: 'plan.created',
          planId: cleanedPlan.next_step_contract?.id,
          contractId: cleanedPlan.next_step_contract?.id,
          observationId: cleanedPlan.next_step_contract?.expectedObservation.observationId ?? this.context.activeObservation?.id,
          payload: { output: cleanedPlan },
          timestamp: Date.now(),
        });
      }

      // UI update
      const eventMessage = cleanedPlan.done
        ? cleanedPlan.final_answer || this.context.finalAnswer || ''
        : `Executing Phase: ${cleanedPlan.macro_objective}`;
      const normalizedMessage = eventMessage.trim();

      // Reduce noisy repeated planner chatter in UI when the plan hasn't changed.
      if (cleanedPlan.done || normalizedMessage !== this.lastBroadcastPlan) {
        this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, eventMessage);
        this.lastBroadcastPlan = normalizedMessage;
      }

      logger.info('Planner output', JSON.stringify(cleanedPlan, null, 2));

      return {
        id: this.id,
        result: cleanedPlan,
      };
    } catch (error) {
      return this.handleExecutionError(error);
    }
  }

  private handleExecutionError(error: unknown): AgentOutput<PlannerOutput> {
    if (error instanceof ResponseParseError) {
      return this.handleParseFallback(error);
    }

    try {
      handleAgentError(error, 'Planning failed');
    } catch (e) {
      // Auth, bad request, billing, rate limit, cancel and blocked-URL errors end the task.
      if (isFatalAgentError(e)) throw e;
      const msg = e instanceof Error ? e.message : String(e ?? 'Unknown planning error');
      logger.error(msg);
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_FAIL, msg);
      return {
        id: this.id,
        error: msg,
      };
    }
    // handleAgentError always throws, but TypeScript needs this
    return { id: this.id, error: 'Planning failed: unknown error' };
  }

  private handleParseFallback(error: ResponseParseError): AgentOutput<PlannerOutput> {
    const goal = this.context.memory.goalManager.getCurrentGoal() || this.context.memory.goalManager.getPrimaryGoal() || '';
    const fallbackPlan = createPlannerParseFallbackOutput({
      goal,
      currentObservation: this.context.activeObservation ?? null,
      reason: error.message,
    });

    if (!fallbackPlan.done && fallbackPlan.macro_objective) {
      this.context.lastMacroObjective = fallbackPlan.macro_objective;
    }
    this.context.currentContract = fallbackPlan.next_step_contract ?? null;

    if (this.context.traceStore) {
      void this.context.traceStore.append({
        taskId: this.context.taskId,
        actor: 'planner',
        type: 'plan.created',
        planId: fallbackPlan.next_step_contract?.id,
        contractId: fallbackPlan.next_step_contract?.id,
        observationId: fallbackPlan.next_step_contract?.expectedObservation.observationId ?? this.context.activeObservation?.id,
        payload: {
          output: fallbackPlan,
          fallbackReason: error.message,
        },
        timestamp: Date.now(),
      });
    }

    const eventMessage = `Planner returned no valid plan; continuing with a safe fallback contract: ${fallbackPlan.macro_objective}`;
    const normalizedMessage = eventMessage.trim();
    if (normalizedMessage !== this.lastBroadcastPlan) {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, eventMessage);
      this.lastBroadcastPlan = normalizedMessage;
    }

    logger.warning('Planner parse failed; using fallback contract', {
      reason: error.message,
      contractId: fallbackPlan.next_step_contract?.id,
      observationId: fallbackPlan.next_step_contract?.expectedObservation.observationId,
    });

    return {
      id: this.id,
      result: fallbackPlan,
    };
  }
}

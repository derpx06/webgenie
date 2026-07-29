import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import type { AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import { handleAgentError } from './utils/error-handler';
import { preparePlannerMessages, cleanPlannerOutput, createPlannerParseFallbackOutput } from './planner/utils';
import { ContextBuilder } from '../memory';
import type { HumanMessage } from '@langchain/core/messages';
import { plannerLLMOutputSchema } from '../contracts';
import { ResponseParseError } from './errors';

const logger = createLogger('PlannerAgent');

export const PLANNER_JSON_OUTPUT_INSTRUCTION = `Return ONLY this JSON object, no markdown:
{"observation":"","challenges":"","done":false,"macro_objective":"NAVIGATE","final_answer":"","reasoning":"","web_task":true,"mode":"single_browser_action","next_goal":"","allowed_actions":["click_element"],"success_condition":"","failure_signals":[],"target_indexes":[]}
Rules: done and web_task are booleans. Do not include next_step_contract, id, createdAt, or observationId.`;

export const plannerOutputSchema = plannerLLMOutputSchema.strict();

export type PlannerOutput = z.infer<typeof plannerOutputSchema> & {
  next_step_contract?: import('../contracts').NextStepContract | null;
};

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  private lastBroadcastPlan = '';

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(
      plannerOutputSchema,
      {
        ...options,
        useProviderStructuredOutput: false,
      },
      { ...extraOptions, id: 'planner' },
    );
  }

  protected override getManualJsonOutputInstruction(): string {
    return PLANNER_JSON_OUTPUT_INSTRUCTION;
  }

  protected override getManualJsonRetryInstruction(): string {
    return `Your previous planner response did not match the required JSON. ${PLANNER_JSON_OUTPUT_INSTRUCTION}`;
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    try {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');

      // Extract current page state message from MessageManager (last added message)
      const allMsgs = this.context.messageManager.getMessages();
      const currentStateMsg = allMsgs[allMsgs.length - 1] as HumanMessage;

      // Build structured context packet
      const contextPacket = ContextBuilder.buildContextPacket(
        this.context,
        this.prompt.getSystemMessage(),
        currentStateMsg,
        'planner',
      );

      const plannerMessages = preparePlannerMessages(
        contextPacket,
        this.context.options.useVision,
        this.context.options.useVisionForPlanner
      );

      const modelOutput = await this.invoke(plannerMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate planner output');
      }

      const cleanedPlan = cleanPlannerOutput(modelOutput, {
        goal: this.context.memory.goalManager.getCurrentGoal() || this.context.memory.goalManager.getPrimaryGoal() || '',
        currentObservation: this.context.activeObservation ?? null,
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
      const eventMessage = cleanedPlan.done ? cleanedPlan.final_answer : `Executing Phase: ${cleanedPlan.macro_objective}`;
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
      // Safe string extraction — handleAgentError may re-throw non-Error objects
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

    const eventMessage = `Planner output was invalid JSON; continuing with a safe fallback contract: ${fallbackPlan.macro_objective}`;
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

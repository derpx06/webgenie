import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import type { AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import { handleAgentError } from './utils/error-handler';
import { preparePlannerMessages, cleanPlannerOutput } from './planner/utils';
import { ContextBuilder } from '../memory';
import type { HumanMessage } from '@langchain/core/messages';

const logger = createLogger('PlannerAgent');

// Define Zod schema for planner output
export const plannerOutputSchema = z.object({
  observation: z.string(),
  challenges: z.string(),
  done: z.union([
    z.boolean(),
    z.string().transform(val => {
      const low = val.toLowerCase();
      if (low === 'true') return true;
      if (low === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
  next_steps: z.string(),
  final_answer: z.string(),
  reasoning: z.string(),
  web_task: z.union([
    z.boolean(),
    z.string().transform(val => {
      const low = val.toLowerCase();
      if (low === 'true') return true;
      if (low === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  private lastBroadcastPlan = '';

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
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
        currentStateMsg
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

      const cleanedPlan = cleanPlannerOutput(modelOutput);

      // UI update
      const eventMessage = cleanedPlan.done ? cleanedPlan.final_answer : cleanedPlan.next_steps;
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
}

import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import type { AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import { handleAgentError } from './utils/error-handler';
import { preparePlannerMessages, cleanPlannerOutput } from './planner/utils';

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
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    try {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');

      const messages = this.context.messageManager.getMessages();
      const plannerMessages = preparePlannerMessages(
        this.prompt.getSystemMessage(),
        messages,
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
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, eventMessage);

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
      const msg = (e as Error).message;
      logger.error(msg);
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_FAIL, msg);
      return {
        id: this.id,
        error: msg,
      };
    }
  }
}

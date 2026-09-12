import type { ReplanDecision, ReplanTrigger } from './types';

export interface ReplanDecisionInput {
  /** False until the planner has run in this execution (new task, follow-up or resume). */
  planned: boolean;
  navigatorDone: boolean;
  /** The navigator produced no usable action last step (invalid output after re-asks, model error). */
  navigatorErrored: boolean;
  /** The last step asked the user; their answer must reach the planner. */
  waitingForHuman: boolean;
  /** Consecutive steps whose last page-changing action validated failed or unknown. */
  unvalidatedSteps: number;
  /** The same actions were repeated on an unchanged page. */
  stalled: boolean;
  stepsSinceLastPlan: number;
  planningInterval: number;
}

const replan = (trigger: ReplanTrigger, reason: string): ReplanDecision => ({ shouldReplan: true, trigger, reason });

/** Replans only when the planner can learn something new. Triggers are checked in precedence order. */
export function getReplanDecision(input: ReplanDecisionInput): ReplanDecision {
  if (!input.planned) return replan('initial', 'The task needs a plan.');
  if (input.waitingForHuman) return replan('human_needed', 'The user answered; the plan must use the answer.');
  if (input.navigatorDone) return replan('contract_complete', 'The navigator reported completion; the planner verifies it.');
  if (input.navigatorErrored) return replan('navigator_error', 'The navigator could not produce a valid action.');
  if (input.unvalidatedSteps >= 2) {
    return replan('validation', `${input.unvalidatedSteps} consecutive steps did not validate.`);
  }
  if (input.stalled) return replan('progress_stall', 'The same actions repeated on an unchanged page.');
  if (input.stepsSinceLastPlan >= input.planningInterval) return replan('step_interval', 'Planner interval elapsed.');
  return { shouldReplan: false, trigger: 'none', reason: 'The current plan remains active.' };
}

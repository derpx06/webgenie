import type { ReplanDecision, ReplanTrigger } from './types';

export interface ReplanDecisionInput {
  /** False until the planner has run in this execution (new task, follow-up or resume). */
  planned: boolean;
  navigatorDone: boolean;
  /** The navigator produced no usable action last step (invalid output after re-asks, model error). */
  navigatorErrored: boolean;
  /** The last step asked the user; their answer must reach the planner. */
  waitingForHuman: boolean;
  /** The planner's last plan was sent back (a pending requirement, an unread page, a goal repeated without progress). */
  completionRefused?: boolean;
  /** Consecutive steps whose last page-changing action validated failed or unknown. */
  unvalidatedSteps: number;
  /** The same actions were repeated on an unchanged page. */
  stalled: boolean;
  stepsSinceLastPlan: number;
  planningInterval: number;
  /** Every navigator step since the last plan validated as passed. Unset counts as not. */
  stepsPassedSinceLastPlan?: boolean;
  /** The last plan moved a requirement from applied back to pending. */
  requirementReopened?: boolean;
}

const replan = (trigger: ReplanTrigger, reason: string): ReplanDecision => ({ shouldReplan: true, trigger, reason });

/** Replans only when the planner can learn something new. Triggers are checked in precedence order. */
export function getReplanDecision(input: ReplanDecisionInput): ReplanDecision {
  if (!input.planned) return replan('initial', 'The task needs a plan.');
  if (input.waitingForHuman) return replan('human_needed', 'The user answered; the plan must use the answer.');
  if (input.completionRefused) return replan('completion_refused', 'The last plan was sent back; the planner plans again with the reason.');
  if (input.navigatorDone) return replan('contract_complete', 'The navigator reported completion; the planner verifies it.');
  if (input.navigatorErrored) return replan('navigator_error', 'The navigator could not produce a valid action.');
  if (input.unvalidatedSteps >= 2) {
    return replan('validation', `${input.unvalidatedSteps} consecutive steps did not validate.`);
  }
  if (input.stalled) return replan('progress_stall', 'The same actions repeated on an unchanged page.');
  // A plan whose steps all validate needs no check on a timer (up to 13 interval re-plans in one run of passing steps);
  // it is still checked after twice the interval, so a navigator drifting through passing steps is caught.
  // ponytail: fixed 2x ceiling; make it an option if long passing runs need a different oversight cadence.
  const onTrack = input.stepsPassedSinceLastPlan === true && !input.requirementReopened;
  if (input.stepsSinceLastPlan >= input.planningInterval * (onTrack ? 2 : 1)) return replan('step_interval', 'Planner interval elapsed.');
  return { shouldReplan: false, trigger: 'none', reason: 'The current plan remains active.' };
}

const GOAL_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'current', 'page', 'into', 'its', 'then']);

/** A goal's words, so a reworded repeat ("on this page" / "on the current page") still counts as the same goal. */
function goalWords(goal: string): Set<string> {
  return new Set(
    goal
      .toLowerCase()
      .replace(/[!-/:-@[-`{-~“”‘’…]+/g, ' ')
      .split(/\s+/)
      .filter(word => (word.length > 2 || /\d/.test(word)) && !GOAL_STOPWORDS.has(word)),
  );
}

function sameGoal(a: Set<string>, b: Set<string>): boolean {
  const shared = [...a].filter(word => b.has(word)).length;
  const union = a.size + b.size - shared;
  return union === 0 || shared / union >= 0.75;
}

/**
 * Goals the planner set and how often since the task last made progress (a new page state reached by a validated
 * action, a saved finding, a requirement applied, an answer from the user). Reviewed runs planned the same goal (the
 * same search, reopening the same articles) up to eight times until the token cap, with nothing telling the planner
 * that route had already failed.
 */
export class GoalRepeats {
  private goals: Array<{ goal: string; words: Set<string>; plans: number }> = [];

  /** Records a planned goal; returns how many times it has now been planned without progress. */
  plan(goal: string): number {
    const words = goalWords(goal);
    const known = this.goals.find(entry => sameGoal(entry.words, words));
    if (known) {
      known.goal = goal;
      return ++known.plans;
    }
    this.goals.push({ goal, words, plans: 1 });
    return 1;
  }

  progress(): void {
    this.goals = [];
  }

  /** Goals planned more than once without progress, most repeated first. */
  repeated(): string[] {
    return this.goals.filter(entry => entry.plans > 1).sort((a, b) => b.plans - a.plans).map(entry => entry.goal);
  }
}

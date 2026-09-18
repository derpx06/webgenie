/**
 * One budget for the whole run, spent by every worker. When it runs low the run gets cheaper instead of stopping, in
 * the order that costs the least accuracy first: screenshots go, then concurrency, then the model tier. Only an
 * exhausted budget stops dispatch, because at that point there is no cheaper path left.
 *
 * The budget counts *uncached* input tokens (input minus the provider's cache reads). Counting cache reads at full
 * price is what killed 21.7% of a benchmark round inside its real budget (reports/TRACE_REVIEW.md §6.2).
 */
import type { ModelTier } from './types';

export interface GovernorPolicy {
  /** 0 full speed, 1 no screenshots, 2 also single worker, 3 also the cheap model. */
  level: 0 | 1 | 2 | 3;
  screenshots: boolean;
  concurrency: number;
  model: ModelTier;
  /** Nothing left to spend: no new node is dispatched, and what is running finishes. */
  exhausted: boolean;
}

export class CostGovernor {
  private spent = 0;
  /** The last level announced, so a degrade is reported once. */
  private announced: number | null = null;

  constructor(
    private readonly budgetTokens: number,
    private readonly baseConcurrency: number,
    private readonly onDegrade?: (policy: GovernorPolicy) => void,
  ) {}

  /** Uncached input tokens, the way the cost is really paid. */
  spend(inputTokens: number, cachedTokens = 0): void {
    this.spent += Math.max(0, inputTokens - cachedTokens);
    const policy = this.policy();
    if (this.announced !== policy.level) {
      this.announced = policy.level;
      if (policy.level > 0) this.onDegrade?.(policy);
    }
  }

  get spentTokens(): number {
    return this.spent;
  }

  /** What the budget can still pay for; never negative. */
  remaining(): number {
    return Math.max(0, this.budgetTokens - this.spent);
  }

  fractionLeft(): number {
    return this.budgetTokens <= 0 ? 0 : this.remaining() / this.budgetTokens;
  }

  policy(): GovernorPolicy {
    const left = this.fractionLeft();
    const level = left > 0.5 ? 0 : left > 0.25 ? 1 : left > 0.1 ? 2 : 3;
    return {
      level,
      screenshots: level < 1,
      concurrency: level < 2 ? this.baseConcurrency : 1,
      model: level < 3 ? 'default' : 'cheap',
      exhausted: this.remaining() <= 0,
    };
  }

  /** What a node may still spend: its own budget, but never more than the run has left. */
  allowanceFor(nodeBudgetTokens: number): number {
    return Math.min(nodeBudgetTokens, this.remaining());
  }
}

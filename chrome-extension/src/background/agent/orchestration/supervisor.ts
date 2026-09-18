/**
 * Watches the workers and decides what to do with a bad one. A worker is bad three ways: it stopped making progress
 * (stuck), it makes the same progress over and over (looping — 36% of all actions in the benchmark were repeats), or
 * it has spent its node's budget. Any of those gets it killed; afterwards the node is retried with backoff, escalated
 * to the stronger model, or given up on, and every one of those decisions is recorded on the node so a resumed run and
 * the trace both say why.
 *
 * The supervisor holds no timers: the pool polls `killReason()` while a node runs. That keeps the policy testable
 * without a clock and keeps the timers in one place.
 */
export type KillReason = 'stuck' | 'looping' | 'over_budget';

export interface SupervisorLimits {
  /** No progress for this long is a stuck worker. */
  stuckMs: number;
  /** The same progress signature this many times in a row is a loop. */
  loopThreshold: number;
  /** Attempts per node, killed ones included. */
  maxAttempts: number;
  /** From this attempt on, the retry asks for the stronger model. */
  escalateAfter: number;
  backoffMs: number;
  maxBackoffMs: number;
}

export const DEFAULT_SUPERVISOR_LIMITS: SupervisorLimits = {
  stuckMs: 90_000,
  loopThreshold: 4,
  maxAttempts: 3,
  escalateAfter: 2,
  backoffMs: 2_000,
  maxBackoffMs: 30_000,
};

export type SupervisorDecision =
  | { action: 'retry'; afterMs: number; escalate: boolean; reason: string }
  | { action: 'give_up'; reason: string };

interface Watch {
  lastProgressAt: number;
  lastSignature: string;
  repeats: number;
  tokens: number;
}

export class Supervisor {
  private readonly limits: SupervisorLimits;
  private readonly watches = new Map<string, Watch>();
  private readonly records = new Map<string, string[]>();

  constructor(limits: Partial<SupervisorLimits> = {}, private readonly now: () => number = Date.now) {
    this.limits = { ...DEFAULT_SUPERVISOR_LIMITS, ...limits };
  }

  started(nodeId: string): void {
    this.watches.set(nodeId, { lastProgressAt: this.now(), lastSignature: '', repeats: 0, tokens: 0 });
  }

  /** One sign of life from a worker: what it did, and what the attempt has spent so far. */
  progress(nodeId: string, signature: string, tokens = 0): void {
    const watch = this.watches.get(nodeId);
    if (!watch) return;
    watch.lastProgressAt = this.now();
    watch.repeats = signature && signature === watch.lastSignature ? watch.repeats + 1 : 0;
    watch.lastSignature = signature;
    watch.tokens = Math.max(watch.tokens, tokens);
  }

  /** Why this worker should be killed now, or null while it is behaving. */
  killReason(nodeId: string, allowanceTokens: number): KillReason | null {
    const watch = this.watches.get(nodeId);
    if (!watch) return null;
    if (watch.tokens > allowanceTokens) return 'over_budget';
    if (watch.repeats + 1 >= this.limits.loopThreshold) return 'looping';
    if (this.now() - watch.lastProgressAt >= this.limits.stuckMs) return 'stuck';
    return null;
  }

  ended(nodeId: string): void {
    this.watches.delete(nodeId);
  }

  /** Whether a node that has used `attempts` attempts may have another; asked before a re-dispatch, and records nothing. */
  canRetry(attempts: number): boolean {
    return attempts < this.limits.maxAttempts;
  }

  /** What to do after an attempt ended badly. `attempts` counts the attempt that just ended. */
  decide(nodeId: string, attempts: number, reason: string): SupervisorDecision {
    if (attempts >= this.limits.maxAttempts) {
      const decision = { action: 'give_up' as const, reason: `${reason}; ${attempts} attempts used` };
      this.record(nodeId, decision.reason);
      return decision;
    }
    const escalate = attempts >= this.limits.escalateAfter;
    const afterMs = Math.min(this.limits.backoffMs * 2 ** (attempts - 1), this.limits.maxBackoffMs);
    const decision = {
      action: 'retry' as const,
      afterMs,
      escalate,
      reason: `${reason}; retry ${attempts + 1} in ${afterMs} ms${escalate ? ' with the stronger model' : ''}`,
    };
    this.record(nodeId, decision.reason);
    return decision;
  }

  /** Recorded on the node as well; kept here so a decision made before a checkpoint is not lost to the trace. */
  record(nodeId: string, note: string): void {
    const notes = this.records.get(nodeId) ?? [];
    notes.push(note);
    this.records.set(nodeId, notes);
  }

  notes(nodeId: string): string[] {
    return [...(this.records.get(nodeId) ?? [])];
  }
}

/**
 * Turns raw trace records (background/trace.ts, IndexedDB "WebGenieTraces") into the rollups the
 * trace dashboard renders. Pure: no IndexedDB, no chrome.*, no DOM — so it is unit-testable and the
 * reader in the options page can stay a thin cursor walk.
 *
 * The wall-clock split follows reports/research/analysis-3-latency.md: every record contributes an
 * interval, the intervals are merged in a fixed priority order, and each bucket is charged only the
 * time no higher bucket already owns.
 */
import type { TraceRecord } from './trace';

/**
 * The only fields the dashboard reads. The cursor projects every record through `slimRecord` so a
 * `session` record's 200 kB page state is never held in memory.
 */
export interface TraceSlim {
  ts: number;
  kind: string;
  level: string;
  component: string;
  msg: string;
  step?: number;
  durationMs?: number;
  model?: string;
  usage?: TokenUsage;
  finishReason?: string;
  details?: string;
  error?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export type TaskOutcome = 'ok' | 'fail' | 'cancel' | 'pause' | 'running';

export interface TaskOverview {
  taskId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** The task text, when the trace contains the executor's "Executing task:" line. */
  task?: string;
  outcome: TaskOutcome;
  /** The final answer or failure reason carried by the terminal task event. */
  outcomeDetails?: string;
  steps: number;
  llmCalls: number;
  records: number;
  models: string[];
  tokens: TokenUsage;
  /** Cached input tokens ÷ input tokens, 0 when nothing was read. */
  cachedShare: number;
}

export interface WallClock {
  totalMs: number;
  modelOkMs: number;
  modelFailedMs: number;
  hedgeMs: number;
  backoffMs: number;
  settleMs: number;
  actionMs: number;
  getStateMs: number;
  networkIdleMs: number;
  /** Everything no span covers: page loads, checkpoints, trace writes. */
  otherMs: number;
}

export interface Health {
  rateLimited: number;
  providerUnreachable: number;
  transientRetries: number;
  hedges: number;
  timeouts: number;
  failedCalls: number;
  validationReasks: number;
  toolCallGiveUps: number;
  toolsRejected: number;
  /** Page-blind intent checks run before task-only data or a page-supplied URL was used. */
  guardChecks: number;
  validationsFailed: number;
  errors: number;
}

export interface LlmCall {
  ts: number;
  component: string;
  model?: string;
  durationMs: number;
  usage?: TokenUsage;
  finishReason?: string;
  status: 'ok' | 'failed' | 'superseded';
  error?: string;
}

export interface StepSummary {
  step: number;
  startedAt: number;
  durationMs: number;
  llmCalls: LlmCall[];
  actions: { ts: number; name: string; durationMs: number; error?: string }[];
  validations: { ts: number; name: string; verdict: string }[];
  errors: { ts: number; component: string; msg: string }[];
  tokens: TokenUsage;
  /** Sum of the step's model-call latencies, hedged duplicates included. */
  modelMs: number;
}

export interface TaskDetail {
  overview: TaskOverview;
  wallClock: WallClock;
  health: Health;
  steps: StepSummary[];
}

const TASK_TEXT = /Executing task:\s*(.+)$/s;
const RATE_LIMIT_DELAY = /retrying in ([\d.]+)s/;
const SETTLE_TOTAL = /^\[ActionSettle\].*\btotal=(\d+)ms/;
const VALIDATED = /^validated (\S+): (\S+)$/;
const ACTION_SPAN = /^action (\S+)/;
const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 };

/** Bucket priority: the first bucket to claim a millisecond keeps it (analysis-3-latency.md). */
const BUCKETS = ['modelOk', 'modelFailed', 'hedge', 'backoff', 'settle', 'action', 'getState', 'networkIdle'] as const;
type Bucket = (typeof BUCKETS)[number];

type Interval = { start: number; end: number };

export function slimRecord(entry: TraceRecord): TraceSlim {
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const usage = data.usage as Partial<TokenUsage> | undefined;
  const error = data.error as { message?: string } | string | undefined;
  return {
    ts: entry.ts,
    kind: entry.kind,
    level: entry.level,
    component: entry.component,
    msg: entry.msg,
    step: entry.step,
    durationMs: entry.durationMs,
    model: typeof data.model === 'string' ? data.model : undefined,
    usage: usage
      ? {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          reasoningTokens: usage.reasoningTokens ?? 0,
        }
      : undefined,
    finishReason: typeof data.finishReason === 'string' ? data.finishReason : undefined,
    details: typeof data.details === 'string' ? data.details.slice(0, 2_000) : undefined,
    error: typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : undefined,
  };
}

function addUsage(total: TokenUsage, usage: TokenUsage | undefined): void {
  if (!usage) return;
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  total.cacheReadTokens += usage.cacheReadTokens;
  total.reasoningTokens += usage.reasoningTokens;
}

function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(one => one.end > one.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const one of sorted) {
    const last = out[out.length - 1];
    if (last && one.start <= last.end) last.end = Math.max(last.end, one.end);
    else out.push({ ...one });
  }
  return out;
}

/** Milliseconds of `intervals` that `claimed` (merged, sorted) does not already own. */
function uncoveredMs(intervals: Interval[], claimed: Interval[]): number {
  let total = 0;
  for (const one of intervals) {
    let cursor = one.start;
    for (const taken of claimed) {
      if (taken.end <= cursor) continue;
      if (taken.start >= one.end) break;
      if (taken.start > cursor) total += taken.start - cursor;
      cursor = Math.max(cursor, taken.end);
      if (cursor >= one.end) break;
    }
    if (cursor < one.end) total += one.end - cursor;
  }
  return total;
}

function llmStatus(msg: string): LlmCall['status'] {
  if (msg.includes('superseded')) return 'superseded';
  return msg.includes('failed') ? 'failed' : 'ok';
}

/** The intervals one record contributes, tagged with the bucket that may claim them. */
function intervalsOf(entry: TraceSlim): { bucket: Bucket; start: number; end: number }[] {
  if (entry.kind === 'llm') {
    if (entry.durationMs !== undefined && entry.msg.startsWith('llm call')) {
      const status = llmStatus(entry.msg);
      const bucket: Bucket = status === 'ok' ? 'modelOk' : status === 'failed' ? 'modelFailed' : 'hedge';
      return [{ bucket, start: entry.ts - entry.durationMs, end: entry.ts }];
    }
    const delay = RATE_LIMIT_DELAY.exec(entry.msg);
    if (delay) return [{ bucket: 'backoff', start: entry.ts, end: entry.ts + Number(delay[1]) * 1_000 }];
    return [];
  }
  if (entry.kind === 'span' && entry.durationMs !== undefined) {
    const bucket: Bucket | null =
      entry.msg === 'getState'
        ? 'getState'
        : entry.msg === 'network idle'
          ? 'networkIdle'
          : entry.msg === 'input dispatch' || ACTION_SPAN.test(entry.msg)
            ? 'action'
            : null;
    return bucket ? [{ bucket, start: entry.ts - entry.durationMs, end: entry.ts }] : [];
  }
  const settle = SETTLE_TOTAL.exec(entry.msg);
  if (settle) return [{ bucket: 'settle', start: entry.ts - Number(settle[1]), end: entry.ts }];
  return [];
}

function splitWallClock(entries: TraceSlim[], startedAt: number): WallClock {
  const byBucket = new Map<Bucket, Interval[]>();
  let latest = startedAt;
  for (const entry of entries) {
    for (const { bucket, start, end } of intervalsOf(entry)) {
      latest = Math.max(latest, end);
      const list = byBucket.get(bucket) ?? [];
      list.push({ start: Math.max(start, startedAt), end });
      byBucket.set(bucket, list);
    }
  }
  const endedAt = Math.max(latest, entries.length ? entries[entries.length - 1].ts : startedAt);
  const totals = {} as Record<Bucket, number>;
  let claimed: Interval[] = [];
  for (const bucket of BUCKETS) {
    const own = merge(byBucket.get(bucket) ?? []);
    totals[bucket] = uncoveredMs(own, claimed);
    claimed = merge([...claimed, ...own]);
  }
  const totalMs = endedAt - startedAt;
  const covered = BUCKETS.reduce((sum, bucket) => sum + totals[bucket], 0);
  return {
    totalMs,
    modelOkMs: totals.modelOk,
    modelFailedMs: totals.modelFailed,
    hedgeMs: totals.hedge,
    backoffMs: totals.backoff,
    settleMs: totals.settle,
    actionMs: totals.action,
    getStateMs: totals.getState,
    networkIdleMs: totals.networkIdle,
    otherMs: Math.max(0, totalMs - covered),
  };
}

function countHealth(entries: TraceSlim[]): Health {
  const health: Health = {
    rateLimited: 0,
    providerUnreachable: 0,
    transientRetries: 0,
    hedges: 0,
    timeouts: 0,
    failedCalls: 0,
    validationReasks: 0,
    toolCallGiveUps: 0,
    toolsRejected: 0,
    guardChecks: 0,
    validationsFailed: 0,
    errors: 0,
  };
  for (const entry of entries) {
    if (entry.level === 'error') health.errors++;
    if (entry.kind === 'llm') {
      if (entry.msg.startsWith('rate limited')) health.rateLimited++;
      else if (entry.msg.startsWith('provider unreachable')) health.providerUnreachable++;
      else if (entry.msg.startsWith('transient failure')) health.transientRetries++;
      else if (entry.msg.startsWith('slow call')) health.hedges++;
      else if (entry.msg === 'tool call validation failed') health.validationReasks++;
      else if (entry.msg.startsWith('no valid tool call')) health.toolCallGiveUps++;
      else if (entry.msg.startsWith('provider rejected tools')) health.toolsRejected++;
      else if (entry.msg.startsWith('llm call') && llmStatus(entry.msg) === 'failed') {
        health.failedCalls++;
        if (/timed out/i.test(entry.error ?? '')) health.timeouts++;
      }
    } else if (entry.kind === 'span') {
      if (entry.msg === 'intent check') health.guardChecks++;
      const validated = VALIDATED.exec(entry.msg);
      if (validated && validated[2] === 'failed') health.validationsFailed++;
    }
  }
  return health;
}

function buildSteps(entries: TraceSlim[]): StepSummary[] {
  const byStep = new Map<number, StepSummary>();
  for (const entry of entries) {
    if (entry.step === undefined) continue;
    let step = byStep.get(entry.step);
    if (!step) {
      step = {
        step: entry.step,
        startedAt: entry.ts,
        durationMs: 0,
        llmCalls: [],
        actions: [],
        validations: [],
        errors: [],
        tokens: { ...ZERO },
        modelMs: 0,
      };
      byStep.set(entry.step, step);
    }
    step.durationMs = Math.max(step.durationMs, entry.ts - step.startedAt);
    if (entry.kind === 'llm' && entry.durationMs !== undefined && entry.msg.startsWith('llm call')) {
      const status = llmStatus(entry.msg);
      step.llmCalls.push({
        ts: entry.ts,
        component: entry.component,
        model: entry.model,
        durationMs: entry.durationMs,
        usage: entry.usage,
        finishReason: entry.finishReason,
        status,
        error: entry.error,
      });
      step.modelMs += entry.durationMs;
      if (status === 'ok') addUsage(step.tokens, entry.usage);
    } else if (entry.kind === 'span') {
      const action = ACTION_SPAN.exec(entry.msg);
      if (action && entry.durationMs !== undefined) {
        step.actions.push({ ts: entry.ts, name: action[1], durationMs: entry.durationMs, error: entry.error });
      }
      const validated = VALIDATED.exec(entry.msg);
      if (validated) step.validations.push({ ts: entry.ts, name: validated[1], verdict: validated[2] });
    }
    if (entry.level === 'error') step.errors.push({ ts: entry.ts, component: entry.component, msg: entry.msg });
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

const OUTCOMES: Record<string, TaskOutcome> = {
  'task.ok': 'ok',
  'task.fail': 'fail',
  'task.cancel': 'cancel',
  'task.pause': 'pause',
};

/** One task's whole rollup. `entries` need not be sorted; anything not about `taskId` is the caller's problem. */
export function summarizeTask(taskId: string, entries: TraceSlim[]): TaskDetail {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const startedAt = sorted.length ? sorted[0].ts : 0;
  const wallClock = splitWallClock(sorted, startedAt);
  const tokens: TokenUsage = { ...ZERO };
  const models = new Set<string>();
  const usedSteps = new Set<number>();
  let llmCalls = 0;
  let task: string | undefined;
  let outcome: TaskOutcome = 'running';
  let outcomeDetails: string | undefined;

  for (const entry of sorted) {
    if (entry.step !== undefined) usedSteps.add(entry.step);
    if (entry.model) models.add(entry.model);
    if (entry.kind === 'llm' && entry.msg.startsWith('llm call') && llmStatus(entry.msg) === 'ok') {
      llmCalls++;
      addUsage(tokens, entry.usage);
    }
    if (!task) {
      const match = TASK_TEXT.exec(entry.msg);
      if (match) task = match[1].trim();
    }
    const mapped = OUTCOMES[entry.msg];
    if (entry.kind === 'event' && mapped) {
      outcome = mapped;
      outcomeDetails = entry.details;
    }
  }

  return {
    overview: {
      taskId,
      startedAt,
      endedAt: startedAt + wallClock.totalMs,
      durationMs: wallClock.totalMs,
      task,
      outcome,
      outcomeDetails,
      steps: usedSteps.size,
      llmCalls,
      records: sorted.length,
      models: [...models],
      tokens,
      cachedShare: tokens.inputTokens > 0 ? tokens.cacheReadTokens / tokens.inputTokens : 0,
    },
    wallClock,
    health: countHealth(sorted),
    steps: buildSteps(sorted),
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * The worker pool: how many workers may run at once, and how one supervised worker runs.
 *
 * Concurrency is what the caller asks for, capped by the machine — each worker drives its own tab with its own
 * debugger session and its own page reads, which is roughly a browser tab's worth of memory each. `navigator`'s
 * `deviceMemory` and `hardwareConcurrency` are advisory and often absent, so they only ever lower the number.
 */
import { createLogger } from '@src/background/log';
import type { KillReason, Supervisor } from './supervisor';
import type { NodeResult, NodeRunner, WorkerBrief } from './types';

const logger = createLogger('WorkerPool');

export const MAX_CONCURRENCY = 8;

export interface AttemptOutcome {
  result?: NodeResult;
  /** Set when the supervisor stopped the worker. */
  killed?: KillReason;
  error?: string;
}

/** Workers that may share the browser, given what the caller asked for and what the machine can hold. */
export function resolveConcurrency(requested: number): number {
  const nav = (typeof navigator === 'undefined' ? undefined : navigator) as
    | { deviceMemory?: number; hardwareConcurrency?: number }
    | undefined;
  // ponytail: one tab per ~2 GB and per 2 cores is a rule of thumb, not a measurement; measure real tab cost if
  // workers start swapping.
  const byMemory = nav?.deviceMemory ? Math.floor(nav.deviceMemory / 2) : MAX_CONCURRENCY;
  const byCores = nav?.hardwareConcurrency ? Math.floor(nav.hardwareConcurrency / 2) : MAX_CONCURRENCY;
  return Math.max(1, Math.min(requested, byMemory, byCores, MAX_CONCURRENCY));
}

/**
 * Runs one attempt under the supervisor: the worker's progress is reported as it happens, and a stuck, looping or
 * over-budget worker is aborted through its signal. A worker that ignores its signal is still abandoned — its result
 * is discarded — so one wedged tab cannot hold the run.
 */
export async function runSupervised(
  runner: NodeRunner,
  brief: WorkerBrief,
  supervisor: Supervisor,
  allowanceTokens: number,
  options: { pollMs?: number; signal?: AbortSignal } = {},
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const abortRun = () => controller.abort();
  options.signal?.addEventListener('abort', abortRun, { once: true });
  supervisor.started(brief.nodeId);

  let killed: KillReason | undefined;
  const watchdog = setInterval(() => {
    const reason = supervisor.killReason(brief.nodeId, allowanceTokens);
    if (!reason) return;
    killed = reason;
    logger.warning(`killing ${brief.nodeId}: ${reason}`);
    controller.abort();
  }, options.pollMs ?? 1_000);

  try {
    const result = await new Promise<NodeResult>((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error(killed ?? 'aborted')), { once: true });
      runner(brief, {
        signal: controller.signal,
        onProgress: (signature, tokens) => supervisor.progress(brief.nodeId, signature, tokens),
      }).then(resolve, reject);
    });
    return result.ok ? { result } : { result, error: result.error ?? 'the worker did not finish its subtask' };
  } catch (error) {
    if (killed) return { killed };
    if (options.signal?.aborted) return { error: 'the run was stopped' };
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearInterval(watchdog);
    supervisor.ended(brief.nodeId);
    options.signal?.removeEventListener('abort', abortRun);
  }
}

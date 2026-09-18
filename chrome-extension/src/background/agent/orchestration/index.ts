/**
 * Orchestration: running one task as several supervised workers instead of one.
 *
 * The parts, and where each one lives:
 * - `decompose.ts` — one model call turns a task into a plan graph; anything unusable falls back to one node.
 * - `dag.ts` — what may run now, what must wait, what can never run; a one-node plan is the ordinary task path.
 * - `pool.ts`, `worker.ts` — N workers, each an ordinary `Executor` on its own tab with its own task id.
 * - `blackboard.ts` — the run's append-only record; `claim()` gives an address to exactly one worker.
 * - `brief.ts` — what a worker is told: its part, its dependencies' answers, the addresses already taken.
 * - `supervisor.ts` — stuck, looping and over-budget workers: killed, retried with backoff, escalated, recorded.
 * - `governor.ts` — one budget across all workers; screenshots, then concurrency, then the model tier give way.
 * - `verifier.ts` — an independent call re-checks the claims against the blackboard and can re-dispatch a worker.
 * - `checkpoint.ts`, `orchestrator.ts` — a checkpoint after every node; `resume(runId)` picks the run back up.
 *
 * **What MV3 does not allow.** Everything runs in one background service worker. There is no second process and no
 * second browser context, so workers share cookies, site storage, the network and this extension's state; isolation is
 * one tab per worker plus a `<runId>:<nodeId>` storage namespace, and nothing more. The service worker can also be
 * stopped by Chrome at any time, which is why the run checkpoint, not memory, is the source of truth.
 */
export * from './types';
export * from './dag';
export * from './blackboard';
export * from './brief';
export * from './governor';
export * from './supervisor';
export * from './pool';
export * from './verifier';
export * from './checkpoint';
export * from './orchestrator';
export * from './worker';
export * from './decompose';

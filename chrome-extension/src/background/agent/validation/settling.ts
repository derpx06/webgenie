export interface ActionSettlingOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export interface ActionSettlingResult<T> {
  state: T;
  settled: boolean;
  polls: number;
  elapsedMs: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();

  return new Promise(resolve => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export async function waitForActionSettled<T>(
  readState: () => Promise<T>,
  isSettled: (state: T) => boolean,
  options: ActionSettlingOptions = {},
): Promise<ActionSettlingResult<T>> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 2000);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 100);
  const startedAt = Date.now();
  let state = await readState();
  let polls = 0;

  if (isSettled(state)) {
    return { state, settled: true, polls, elapsedMs: Date.now() - startedAt };
  }

  while (!options.signal?.aborted && Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    await sleep(Math.min(pollIntervalMs, remainingMs), options.signal);
    if (options.signal?.aborted) break;

    state = await readState();
    polls++;
    if (isSettled(state)) {
      return { state, settled: true, polls, elapsedMs: Date.now() - startedAt };
    }
  }

  return { state, settled: false, polls, elapsedMs: Date.now() - startedAt };
}

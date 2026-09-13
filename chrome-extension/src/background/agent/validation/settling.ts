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
  options: ActionSettlingOptions & {
    /** Once settled, keep reading until two reads in a row are the same page (it stopped changing), within the timeout. */
    isSame?: (previous: T, next: T) => boolean;
  } = {},
): Promise<ActionSettlingResult<T>> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 2000);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 100);
  const startedAt = Date.now();
  let state = await readState();
  let polls = 0;
  const remaining = () => timeoutMs - (Date.now() - startedAt);

  // A page that responded may still be loading the rest (results, a dialog's content): the next read should see it whole.
  const settledWhenQuiet = async (): Promise<ActionSettlingResult<T>> => {
    while (options.isSame && !options.signal?.aborted && remaining() > 0) {
      await sleep(Math.min(pollIntervalMs, remaining()), options.signal);
      if (options.signal?.aborted) break;
      const next = await readState();
      polls++;
      const quiet = options.isSame(state, next);
      state = next;
      if (quiet) break;
    }
    return { state, settled: true, polls, elapsedMs: Date.now() - startedAt };
  };

  if (isSettled(state)) {
    return settledWhenQuiet();
  }

  while (!options.signal?.aborted && remaining() > 0) {
    await sleep(Math.min(pollIntervalMs, remaining()), options.signal);
    if (options.signal?.aborted) break;

    state = await readState();
    polls++;
    if (isSettled(state)) {
      return settledWhenQuiet();
    }
  }

  return { state, settled: false, polls, elapsedMs: Date.now() - startedAt };
}

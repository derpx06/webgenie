import { describe, expect, it } from 'vitest';
import { waitForActionSettled } from '../settling';

/** Reads that return the given values in order, repeating the last one. */
const reads = (values: string[]) => {
  let i = 0;
  return async () => values[Math.min(i++, values.length - 1)];
};

describe('waitForActionSettled quiet wait', () => {
  it('keeps reading after the page responded until two reads match, so the next read sees the page whole', async () => {
    const result = await waitForActionSettled(reads(['before', 'loading', 'results 1-10', 'results 1-20', 'results 1-20']), state => state !== 'before', {
      pollIntervalMs: 1,
      timeoutMs: 1000,
      isSame: (previous, next) => previous === next,
    });
    expect(result).toMatchObject({ state: 'results 1-20', settled: true });
  });

  it('stops at the timeout on a page that never holds still, and returns at once without isSame', async () => {
    let n = 0;
    const ticking = await waitForActionSettled(async () => `clock ${n++}`, () => true, { pollIntervalMs: 5, timeoutMs: 40, isSame: (a, b) => a === b });
    expect(ticking.settled).toBe(true);
    expect(ticking.elapsedMs).toBeLessThan(200);

    const plain = await waitForActionSettled(reads(['changed']), () => true, { pollIntervalMs: 1, timeoutMs: 1000 });
    expect(plain).toMatchObject({ state: 'changed', polls: 0 });
  });
});

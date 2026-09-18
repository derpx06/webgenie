import { describe, expect, it } from 'vitest';
import { waitForActionSettled } from '../settling';

describe('waitForActionSettled', () => {
  it('polls until a delayed SPA postcondition becomes visible', async () => {
    const snapshots = [
      { state: 'Follow' },
      { state: 'Follow' },
      { state: 'Following' },
    ];
    let reads = 0;

    const result = await waitForActionSettled(
      async () => snapshots[Math.min(reads++, snapshots.length - 1)],
      snapshot => snapshot.state === 'Following',
      { timeoutMs: 100, pollIntervalMs: 0 },
    );

    expect(result.settled).toBe(true);
    expect(result.state.state).toBe('Following');
    expect(reads).toBe(3);
  });

  it('skips the quiet read when the action\'s own result is the evidence', async () => {
    let reads = 0;
    const settle = (needsQuiet?: (state: { state: string }) => boolean) =>
      waitForActionSettled(
        async () => ({ state: `read ${++reads}` }),
        () => true,
        { timeoutMs: 100, pollIntervalMs: 0, isSame: () => true, needsQuiet },
      );

    expect((await settle(() => false)).polls).toBe(0);
    expect(reads).toBe(1);
    expect((await settle()).polls).toBe(1);
    expect(reads).toBe(3);
    expect((await settle(() => true)).polls).toBe(1);
    expect(reads).toBe(5);
  });

  it('returns the latest state when the bounded settle timeout expires', async () => {
    const result = await waitForActionSettled(
      async () => ({ state: 'unchanged' }),
      snapshot => snapshot.state === 'changed',
      { timeoutMs: 0, pollIntervalMs: 0 },
    );

    expect(result.settled).toBe(false);
    expect(result.state.state).toBe('unchanged');
    expect(result.polls).toBe(0);
  });
});

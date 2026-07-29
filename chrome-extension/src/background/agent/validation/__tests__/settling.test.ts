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

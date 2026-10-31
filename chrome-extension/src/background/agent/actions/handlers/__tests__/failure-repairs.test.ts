import { describe, expect, it } from 'vitest';
import { explainHistoryFailure } from '../navigation';
import { dispatchGuard, repairHint } from '../../../validation/service';

/**
 * Both of these reached the model as the browser's own wording in the last round, with nothing to do next: "Node is detached
 * from document" in 13 of 271 tasks, "History entry to navigate to not found" in 6. A failure message earns its place by
 * carrying the repair.
 */
describe('a vanished element says what to do next', () => {
  it('classifies the browser wording as a stale element', () => {
    expect(dispatchGuard('Node is detached from document')).toBe('stale-index');
    expect(dispatchGuard('Element is detached from the document')).toBe('stale-index');
  });

  it('adds the next step for a stale element, and nothing for the refusals that already carry theirs', () => {
    const hint = repairHint('stale-index');
    expect(hint).toContain('fresh');
    expect(hint).toMatch(/choose again/i);
    expect(hint).toMatch(/instead of repeating this index/i);
    for (const guard of ['covered', 'invisible', 'disabled', 'moving', 'read-only', null]) expect(repairHint(guard)).toBe('');
  });
});

describe('going back with nowhere to go says how to get there instead', () => {
  it('names the way out, for back and for forward', () => {
    const back = explainHistoryFailure('History entry to navigate to not found.', false);
    expect(back).toContain('no earlier page');
    expect(back).toContain('go_to_url');
    expect(back).not.toContain('History entry');

    const forward = explainHistoryFailure('History entry to navigate to not found.', true);
    expect(forward).toContain('no later page');
  });

  it('passes any other failure through untouched', () => {
    expect(explainHistoryFailure('Target closed', false)).toBe('Target closed');
  });
});

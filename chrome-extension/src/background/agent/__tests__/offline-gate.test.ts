import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

const traced = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@src/background/trace', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  // `ts` is added by the real record(); taskMetrics sorts and times on it.
  return { ...actual, record: (entry: Record<string, unknown>) => void traced.push({ ts: Date.now(), ...entry }) };
});

import * as metricsModule from '../../../../e2e/metrics.mjs';
import { click, createHarness, done, plan, settle, stubChrome, until } from './fakes';

/** What this gate reads out of the live harness's own metrics. The module is plain JS and shared on purpose: one
 *  definition of "regression" for the offline gate and the 20-hour round alike. */
interface TaskMetrics {
  schemaRejections: number;
  guards: Record<string, { refused: number; allowed: number; asked: number }>;
  replans: Record<string, number>;
  [counter: string]: unknown;
}
const { taskMetrics, HEALTH_COUNTERS } = metricsModule as unknown as {
  taskMetrics: (records: unknown[], events: unknown[], options?: Record<string, unknown>) => TaskMetrics;
  HEALTH_COUNTERS: string[];
};


/**
 * The agent loop driven with no model and no browser, measured with the same `metrics.mjs` the 20-hour live round
 * uses. The live round's minimum detectable effect is about nine points, so it never could have caught any of the
 * regressions below; each of them, though, is a counter going from zero to tens.
 *
 * These are scenarios, not unit tests: the predicates they cover were all individually correct when the regressions
 * shipped. What was wrong was the loop around them.
 */
beforeEach(() => {
  traced.length = 0;
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const listPage = {
  url: 'https://shop.test/list',
  title: 'Results',
  text: ['12 results'],
  elements: [{ text: 'Next page' }, { text: 'Filter' }],
};

async function drive(h: ReturnType<typeof createHarness>) {
  const execution = h.executor.execute();
  await until(() => h.llm.remaining('navigator') === 0 || !!h.last()?.state?.startsWith('task.'));
  await h.executor.cancel();
  await settle(execution);
  return taskMetrics(traced, h.events);
}

describe('offline gate', () => {
  /**
   * The regression that froze eleven tasks. `loop-detection.test.ts` passed throughout, because `loopNudge`'s
   * thresholds were right; the loop around it was not. A model that insists on one move must be stopped and the
   * plan reconsidered, not left to spend the step budget.
   */
  it('escapes a model that repeats one move, and replans instead of retrying', async () => {
    const h = createHarness({
      task: 'Page through the results',
      pages: [listPage],
      planner: Array(20).fill(plan({ next_goal: 'Page through the list' })),
      navigator: [...Array(12).fill(click(0)), done('No more pages', false)],
    });
    const metrics = await drive(h);

    // The loop is broken well before the twelve scripted clicks.
    expect(h.browser.actions.length).toBeLessThan(8);
    // And it is broken by a refusal that names the repeat, not by running out of budget. Either repeat guard may
    // answer: the exact-argument one is checked first and wins when the index happens to stay the same, and the
    // signature one catches the same move at a new index (the next scenario).
    const repeatGuards = Object.keys(metrics.guards).filter(name => /repeat/.test(name));
    expect(repeatGuards.length).toBeGreaterThan(0);
    expect(repeatGuards.reduce((n, name) => n + metrics.guards[name].refused, 0)).toBeGreaterThan(0);
    // A refusal closes the route, so the planner hears about it at once.
    expect(metrics.replans.validation ?? 0).toBeGreaterThan(0);
  });

  /** The repeat key used to be the exact arguments, and an index changes on every page read. */
  it('counts the same move as the same move when its index changes', async () => {
    const shifting = [
      { ...listPage, elements: [{ text: 'Next page' }, { text: 'Filter' }] },
      { ...listPage, elements: [{ text: 'Filter' }, { text: 'Next page' }] },
      { ...listPage, elements: [{ text: 'Sort' }, { text: 'Filter' }, { text: 'Next page' }] },
      { ...listPage, elements: [{ text: 'Next page' }, { text: 'Filter' }] },
      { ...listPage, elements: [{ text: 'Filter' }, { text: 'Next page' }] },
    ];
    const h = createHarness({
      task: 'Page through the results',
      pages: shifting,
      planner: Array(20).fill(plan({ next_goal: 'Open the next page' })),
      // The same control every time, at index 0, 1, 2, 0, 1: the exact-argument key sees five different actions.
      navigator: [click(0), click(1), click(2), click(0), click(1), done('Done', false)],
    });
    const metrics = await drive(h);
    expect(metrics.guards['repeat-signature']?.refused ?? 0).toBeGreaterThan(0);
  });

  /** Health counters are the gate. Any of them rising on an ordinary task is a regression. */
  it('runs an ordinary task with every health counter at zero', async () => {
    const h = createHarness({
      task: 'Read the results count',
      pages: [listPage],
      planner: [plan({ next_goal: 'Read the page' }), plan({ done: true, final_answer: '12 results' })],
      navigator: [done('12 results')],
    });
    const metrics = await drive(h);

    const risen = HEALTH_COUNTERS.filter(key => typeof metrics[key] === 'number' && (metrics[key] as number) > 0);
    expect(risen).toEqual([]);
    expect(metrics.schemaRejections).toBe(0);
  });

  /**
   * The completion check reads `promptState`, which is the page as the prompt was built. A page that changed since
   * made every "does the page back this?" check answer about a page that no longer exists.
   */
  it('re-reads the page before accepting a finish', async () => {
    const h = createHarness({
      task: 'Read the results count',
      pages: [listPage, { ...listPage, text: ['42 results'] }],
      planner: [plan({ next_goal: 'Read it' }), plan({ done: true, final_answer: '42 results' })],
      navigator: [done('42 results')],
    });
    const readsBefore = h.browser.reads;
    await drive(h);
    expect(h.browser.reads).toBeGreaterThan(readsBefore);
    expect(h.has('task.ok' as never) || h.states().some(state => String(state).startsWith('task.'))).toBe(true);
  });
});

import { afterEach, beforeEach, describe, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

const traced = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@src/background/trace', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, record: (entry: Record<string, unknown>) => void traced.push({ ts: Date.now(), ...entry }) };
});

import * as metricsModule from '../../../../e2e/metrics.mjs';
import { click, createHarness, done, plan, settle, stubChrome, until } from './fakes';

/**
 * Not a gate: a measurement. Prints one JSON line of mechanism counters so the same scenarios can be run against two
 * commits and the numbers compared. The live judged round cannot resolve anything under about nine points; these are
 * counters, and they move by whole multiples.
 *
 *   npx vitest run src/background/agent/__tests__/measure.test.ts 2>&1 | grep MEASURE
 */
const { taskMetrics } = metricsModule as unknown as {
  taskMetrics: (records: unknown[], events: unknown[]) => Record<string, any>;
};

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
  // A pending question is terminal for measurement: a build that stops to ask would otherwise wait for a human that
  // this harness never supplies. Whether it asks at all is one of the numbers being measured.
  await until(
    () =>
      h.llm.remaining('navigator') === 0 ||
      !!h.last()?.state?.startsWith('task.') ||
      h.events.some(event => event.state === 'act.ask_human'),
    30_000,
  );
  await h.executor.cancel();
  await settle(execution);
  return taskMetrics(traced, h.events);
}

const refusals = (metrics: Record<string, any>) =>
  Object.values(metrics.guards ?? {}).reduce((n: number, row: any) => n + (row.refused ?? 0), 0);

describe('measure', () => {
  it('prints mechanism counters', async () => {
    const out: Record<string, unknown> = {};

    // 1. A model that insists on one move, at a shifting index: how far does it get, and is it stopped?
    const shifting = [
      { ...listPage, elements: [{ text: 'Next page' }, { text: 'Filter' }] },
      { ...listPage, elements: [{ text: 'Filter' }, { text: 'Next page' }] },
      { ...listPage, elements: [{ text: 'Sort' }, { text: 'Filter' }, { text: 'Next page' }] },
      { ...listPage, elements: [{ text: 'Next page' }, { text: 'Filter' }] },
      { ...listPage, elements: [{ text: 'Filter' }, { text: 'Next page' }] },
      { ...listPage, elements: [{ text: 'Sort' }, { text: 'Next page' }] },
      { ...listPage, elements: [{ text: 'Next page' }] },
      { ...listPage, elements: [{ text: 'Filter' }, { text: 'Next page' }] },
    ];
    const loopShifting = createHarness({
      task: 'Page through the results',
      pages: shifting,
      planner: Array(30).fill(plan({ next_goal: 'Open the next page' })),
      navigator: [click(0), click(1), click(2), click(0), click(1), click(1), click(0), click(1), done('Done', false)],
    });
    const m1 = await drive(loopShifting);
    out.shiftingIndex_actionsExecuted = loopShifting.browser.actions.length;
    out.shiftingIndex_guardRefusals = refusals(m1);
    out.shiftingIndex_navigatorCalls = m1.navigatorCalls ?? 0;

    // 2. The same move at a fixed index, which the exact-argument key always caught.
    const loopFixed = createHarness({
      task: 'Page through the results',
      pages: [listPage],
      planner: Array(30).fill(plan({ next_goal: 'Open the next page' })),
      navigator: [...Array(12).fill(click(0)), done('Done', false)],
    });
    const m2 = await drive(loopFixed);
    out.fixedIndex_actionsExecuted = loopFixed.browser.actions.length;
    out.fixedIndex_guardRefusals = refusals(m2);
    out.fixedIndex_replansFromRefusal = m2.replans?.validation ?? 0;

    // 3. Reads on a finishing task versus one that never finishes: the completion re-read.
    const scenario = (finish: boolean) =>
      createHarness({
        task: 'Read the results count',
        pages: [listPage, { ...listPage, text: ['42 results'] }],
        planner: finish
          ? [plan({ next_goal: 'Read it' }), plan({ done: true, final_answer: '42 results' })]
          : [plan({ next_goal: 'Read it' }), plan({ next_goal: 'Keep reading' })],
        navigator: [done('42 results')],
      });
    const finishing = scenario(true);
    await drive(finishing);
    const unfinished = scenario(false);
    await drive(unfinished);
    out.completionExtraReads = finishing.browser.reads - unfinished.browser.reads;

    // 4. An order: is it pressed, and is the user asked to approve it?
    const checkout = { url: 'https://shop.test/checkout', title: 'Checkout', text: ['Total $40.00'], elements: [{ text: 'Place order' }] };
    const order = createHarness({
      task: 'Place the order for my cart',
      pages: [checkout],
      planner: Array(8).fill(plan({ next_goal: 'Place the order' })),
      navigator: [click(0), click(0), done('x', false)],
    });
    const m4 = await drive(order);
    out.order_clicksExecuted = order.browser.actions.length;
    out.order_questionsAsked = order.events.filter(e => e.state === 'act.ask_human').length;
    out.order_guardRefusals = refusals(m4);

    // 5. Is the user's request repeated after the page content?
    const probe = createHarness({
      task: 'Find the cheapest lamp',
      pages: [listPage],
      planner: [plan({ next_goal: 'Look' })],
      navigator: [done('x')],
    });
    await drive(probe);
    const navText = probe.llm.requestsFor('navigator').map(r => String(r.messages.at(-1)?.content ?? '')).join('\n');
    const elementsAt = navText.indexOf('Interactive elements');
    const taskAt = navText.lastIndexOf('Find the cheapest lamp');
    out.taskRestatedAfterPage = elementsAt >= 0 && taskAt > elementsAt;

    console.log(`MEASURE ${JSON.stringify(out)}`);
  });
});

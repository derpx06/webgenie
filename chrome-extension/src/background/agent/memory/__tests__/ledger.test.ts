import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { TaskLedger } from '../in-chat/ledger';
import { call, createHarness, done, plan, settle, stubChrome, textOf, until, type PageSpec } from '../../__tests__/fakes';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the ledger itself', () => {
  it('collapses the same address into one line with a count and the newest note', () => {
    const ledger = new TaskLedger();
    ledger.visited('shop.test/search', 'no results');
    ledger.visited('shop.test/search', 'no results');
    ledger.visited('shop.test/search', '27 results');
    expect(ledger.all()).toHaveLength(1);
    expect(ledger.render(1600)).toBe('- seen shop.test/search x3: 27 results');
  });

  it('puts dead ends and refusals before pages, and drops pages seen once when the budget is tight', () => {
    const ledger = new TaskLedger();
    for (const page of ['a/1', 'a/2', 'a/3']) ledger.visited(page, 'a page');
    ledger.visited('a/4', 'seen twice');
    ledger.visited('a/4', 'seen twice');
    ledger.refused('click_element', 'the element has no visible area');
    ledger.deadEnd('a/9', 'you went back from it');

    const lines = ledger.render(130).split('\n');
    expect(lines[0]).toContain('dead end a/9');
    expect(lines[1]).toContain('refused click_element');
    expect(lines[2]).toContain('seen a/4 x2');
    expect(lines[lines.length - 1]).toMatch(/^- and \d+ more pages seen once$/);
    expect(ledger.render(130).length).toBeLessThanOrEqual(130 + '- and 3 more pages seen once'.length);
  });

  it('is empty until something happens', () => {
    expect(new TaskLedger().render(1600)).toBe('');
  });
});

const page = (url: string, title: string): PageSpec => ({ url, title, elements: [{ text: 'Next' }] });

describe('the agent writing to the ledger', () => {
  it('records the pages it landed on and shows them to both agents', async () => {
    const h = createHarness({
      pages: [page('https://shop.test/a', 'Page A'), page('https://shop.test/b', 'Page B')],
      planner: Array(6).fill(plan()),
      navigator: [call('click_element', { index: 0, commits: 'none' }), done('Finished')],
    });
    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);

    const said = h.llm.requests.map(request => textOf(request.messages)).join('\n');
    expect(said).toContain('[ALREADY TRIED]');
    expect(said).toContain('shop.test/b');
    expect(h.executor.getContext().ledger.all().some(entry => entry.kind === 'visit')).toBe(true);
  });

  it('records a page it went back from as a dead end', async () => {
    const h = createHarness({
      pages: [page('https://shop.test/a', 'Page A'), page('https://shop.test/b', 'Page B')],
      planner: Array(6).fill(plan()),
      navigator: [call('go_back', {}), done('Finished')],
    });
    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);

    const deadEnds = h.executor.getContext().ledger.all().filter(entry => entry.kind === 'dead_end');
    expect(deadEnds).toHaveLength(1);
    expect(deadEnds[0].subject).toContain('shop.test/a');
    expect(h.llm.requests.map(request => textOf(request.messages)).join('\n')).toContain('dead end shop.test/a');
  });

  it('records a refused action with its reason', async () => {
    const h = createHarness({
      pages: [page('https://shop.test/a', 'Page A')],
      planner: Array(8).fill(plan()),
      // An index the page read never showed is refused by the navigator's own guard.
      navigator: [call('click_element', { index: 44, commits: 'none' }), done('Finished')],
    });
    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);

    const refusals = h.executor.getContext().ledger.all().filter(entry => entry.kind === 'refused');
    expect(refusals).toHaveLength(1);
    expect(refusals[0].subject).toBe('click_element');
  });
});

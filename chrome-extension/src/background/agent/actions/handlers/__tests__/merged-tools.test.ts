import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { call, createHarness, done, plan, settle, stubChrome, until, type PageSpec } from '../../../__tests__/fakes';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const page: PageSpec = {
  url: 'https://app.test/',
  title: 'App',
  text: ['Total: $42.00'],
  elements: [{ text: 'Menu' }, { text: 'Basket' }],
};

/** Runs one action and returns what the browser was asked to do. */
async function run(name: string, args: Record<string, unknown>, task = 'Use the page') {
  const h = createHarness({
    task,
    pages: [page],
    planner: Array(6).fill(plan()),
    navigator: [call(name, args), done('Used')],
  });
  const execution = h.executor.execute();
  await until(() => h.llm.remaining('navigator') === 0);
  await h.executor.cancel();
  await settle(execution);
  return h.browser.actions;
}

/**
 * The verbs the model almost never chose are options of the tool it does choose. Every one of them still reaches the
 * same browser call, so a page that needs a hover menu, a context menu, a drag, a second tab or a text scroll is not
 * out of reach with a smaller tool list.
 */
describe('the gestures folded into click_element', () => {
  it('clicks by default and hovers, right-clicks or drags when an option says so', async () => {
    expect(await run('click_element', { index: 1, commits: 'none' })).toEqual([
      { type: 'click', index: 1, label: 'Basket' },
    ]);
    expect(await run('click_element', { index: 0, hover: true, commits: 'none' })).toEqual([
      { type: 'hover', index: 0, label: 'Menu' },
    ]);
    expect(await run('click_element', { index: 0, right: true, commits: 'none' })).toEqual([
      { type: 'right_click', index: 0, label: 'Menu' },
    ]);
    expect(await run('click_element', { index: 0, drop_on: 1, commits: 'none' })).toEqual([
      { type: 'drag', index: 0, target: 1 },
    ]);
    expect(await run('click_element', { index: 1, double: true, commits: 'none' })).toEqual([
      { type: 'double_click', index: 1, label: 'Basket' },
    ]);
  });
});

describe('the options that replaced a tool of their own', () => {
  it('opens an address in this tab or a new one', async () => {
    const task = 'Open https://other.test/ and tell me its heading';
    expect(await run('go_to_url', { url: 'https://other.test/' }, task)).toEqual([{ type: 'navigate', url: 'https://other.test/' }]);
    expect(await run('go_to_url', { url: 'https://other.test/', new_tab: true }, task)).toEqual([
      { type: 'open_tab', url: 'https://other.test/' },
    ]);
  });

  it('goes back, or forward when asked', async () => {
    expect(await run('go_back', {})).toEqual([{ type: 'go_back' }]);
    expect(await run('go_back', { forward: true })).toEqual([{ type: 'go_forward' }]);
  });

  it('switches to a tab, or closes it', async () => {
    expect(await run('switch_tab', { tab_id: 7 })).toEqual([{ type: 'switch_tab', tabId: 7 }]);
    expect(await run('switch_tab', { tab_id: 7, action: 'close' })).toEqual([{ type: 'close_tab', tabId: 7 }]);
  });

  it('scrolls to a text instead of by screens when one is named', async () => {
    expect(await run('scroll', { direction: 'down', text: '$42.00' })).toEqual([{ type: 'scroll_to_text', text: '$42.00' }]);
  });
});

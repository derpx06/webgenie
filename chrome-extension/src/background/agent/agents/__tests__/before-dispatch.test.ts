import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { click, createHarness, done, plan, settle, stubChrome, textOf, until } from '../../__tests__/fakes';
import type { Script } from '../../__tests__/fakes';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const keepPlanning: Script[] = Array(8).fill(plan({ macro_objective: 'EXPLORE_PAGE', next_goal: 'Carry on' }));

describe('An element the page will not let the agent use', () => {
  it('is refused with the fix and the elements on the page that carry the same name', async () => {
    const h = createHarness({
      task: 'Open the menu',
      pages: [
        {
          url: 'https://shop.test/',
          title: 'Shop',
          elements: [
            { tag: 'button', attributes: { 'aria-label': 'Menu' } },
            { tag: 'button', attributes: { 'aria-label': 'Menu' } },
            { tag: 'button', attributes: { 'aria-label': 'Search' } },
          ],
        },
      ],
      planner: keepPlanning,
      navigator: [click(0), done('Stuck', false)],
    });
    const page = await h.browser.getCurrentPage();
    (page as unknown as { clickNode: () => Promise<never> }).clickNode = async () => {
      throw new Error('The element has no visible area: it is hidden, or inside a collapsed section, menu or panel.');
    };

    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);

    const sent = h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n');
    expect(sent).toContain('no visible area');
    expect(sent).toContain('Elements named like it on the current page: [1] "Menu"');
    expect(sent).not.toContain('[2] "Search"');
  });

  it('is not sent again unchanged the moment it failed: the model looks at the current page first', async () => {
    const h = createHarness({
      task: 'Open the menu',
      pages: [{ url: 'https://shop.test/', title: 'Shop', elements: [{ tag: 'button', attributes: { 'aria-label': 'Menu' } }] }],
      planner: keepPlanning,
      navigator: [click(0), click(0), click(0), done('Stuck', false)],
    });
    const page = await h.browser.getCurrentPage();
    let clicks = 0;
    (page as unknown as { clickNode: () => Promise<never> }).clickNode = async () => {
      clicks++;
      throw new Error('The element is covered by <div> "Cookie choices"');
    };

    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);

    // The second click is refused; the third, sent after that refusal, is the model's deliberate retry.
    expect(clicks).toBe(2);
    expect(h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n')).toContain(
      'Not done: this exact action just failed',
    );
  });
});

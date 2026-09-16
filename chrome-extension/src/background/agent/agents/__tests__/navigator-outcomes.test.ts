import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { ExecutionState } from '../../event/types';
import { click, createHarness, done, plan, settle, stubChrome, textOf, typeText, until } from '../../__tests__/fakes';
import type { PageSpec, Script } from '../../__tests__/fakes';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const keepPlanning: Script[] = Array(12).fill(plan({ macro_objective: 'FORM_FILL', next_goal: 'Carry on with the task' }));

/** Runs the scripted navigator replies, answering questions with `answers` in order, then cancels. */
async function run(pages: PageSpec[], navigator: Script[], answers: string[] = []) {
  const h = createHarness({ task: 'Fill in the form', pages, planner: keepPlanning, navigator });
  const execution = h.executor.execute();
  for (const answer of answers) {
    const asked = h.events.filter(event => event.state === ExecutionState.ACT_ASK_HUMAN).length;
    await until(() => h.events.filter(event => event.state === ExecutionState.ACT_ASK_HUMAN).length > asked);
    await h.executor.submitHumanResponse(answer);
  }
  await until(() => h.llm.remaining('navigator') === 0);
  await h.executor.cancel();
  await settle(execution);
  const sent = () => h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n');
  return { h, sent };
}

describe('Batches of actions', () => {
  const url = 'https://form.test/';
  const fields = [
    { tag: 'input', attributes: { type: 'text', 'aria-label': 'First name' } },
    { tag: 'input', attributes: { type: 'text', 'aria-label': 'Last name' } },
  ];

  it('go on when typing only reveals an incidental element such as a help link', async () => {
    const withLink = { url, title: 'Form', text: ['First name is required'], elements: [...fields, { tag: 'a', text: 'Why do we ask?' }] };
    const { h, sent } = await run(
      [{ url, title: 'Form', elements: fields }, withLink, withLink],
      [[typeText(0, 'Ada'), typeText(1, 'Lovelace')], done('Filled')],
    );

    expect(h.browser.actions.map(action => action.index)).toEqual([0, 1]);
    expect(sent()).not.toContain('the rest of this response was not run');
  });

  it('stop when typing reveals new form fields', async () => {
    const more = { url, title: 'Form', elements: [...fields, { tag: 'input', attributes: { type: 'text', 'aria-label': 'Middle name' } }] };
    const { h, sent } = await run(
      [{ url, title: 'Form', elements: fields }, more, more],
      [[typeText(0, 'Ada'), typeText(1, 'Lovelace')], done('Filled')],
    );

    expect(h.browser.actions.map(action => action.index)).toEqual([0]);
    expect(sent()).toContain('It revealed new form fields, so the rest of this response was not run.');
  });
});

describe('Fields with suggestions', () => {
  const url = 'https://travel.test/';
  const city = { tag: 'input', attributes: { role: 'combobox', 'aria-label': 'City' } };
  const search = { text: 'Search' };

  it('list the suggestions that appeared after typing, with their indexes', async () => {
    const suggested = {
      url,
      title: 'Travel',
      text: ['Please select a city from the suggestions'],
      elements: [city, search, { tag: 'li', text: 'Paris, France', attributes: { role: 'option' } }, { tag: 'li', text: 'Paris, Texas', attributes: { role: 'option' } }],
    };
    const { h, sent } = await run(
      [{ url, title: 'Travel', elements: [city, search] }, suggested, suggested],
      [[typeText(0, 'Paris'), click(1)], done('Typed')],
    );

    // The suggestions stop the batch: the click on Search waits.
    expect(h.browser.actions.map(action => action.type)).toEqual(['input']);
    const text = sent();
    expect(text).toContain('Suggestions: [2] "Paris, France", [3] "Paris, Texas". Click the one that matches instead of pressing Enter');
    expect(text).toContain('The page answered the typing with: "Please select a city from the suggestions"');
  });

  it('say when no suggestions appeared', async () => {
    const page = { url, title: 'Travel', elements: [city, search] };
    const { sent } = await run([page, page], [typeText(0, 'Xyzzy'), done('Typed')]);

    expect(sent()).toContain('No suggestions appeared for this text.');
  });
});

describe('Clicks that change nothing useful', () => {
  it('are not passed when only the address fragment changed', async () => {
    const page = { url: 'https://news.test/article', title: 'Article', text: ['Story'], elements: [{ text: 'Next story' }] };
    const { sent } = await run([page, { ...page, url: 'https://news.test/article#overlay' }], [click(0), done('Stuck')]);

    expect(sent()).toContain('The click only changed the address fragment (none to #overlay); the page content did not change.');
  });

  it('name the menu a click opened', async () => {
    const url = 'https://shop.test/';
    const opened = { url, title: 'Shop', elements: [{ text: 'Sort' }, { text: 'Price: low to high', attributes: { role: 'menuitem' } }] };
    const { sent } = await run([{ url, title: 'Shop', elements: [{ text: 'Sort' }] }, opened], [click(0), done('Open')]);

    expect(sent()).toContain('A menu or list opened: [1] "Price: low to high".');
  });
});

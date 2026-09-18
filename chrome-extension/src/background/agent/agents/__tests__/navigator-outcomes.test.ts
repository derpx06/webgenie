import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { ExecutionState } from '../../event/types';
import { askHuman, call, click, createHarness, done, plan, settle, stubChrome, textOf, typeText, until } from '../../__tests__/fakes';
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

describe('Actions repeated on a page that does not change', () => {
  const url = 'https://form.test/';

  it('are refused from the fourth identical one on', async () => {
    const page = { url, title: 'Form', elements: [{ tag: 'input', attributes: { type: 'text', 'aria-label': 'City' } }] };
    const type = typeText(0, 'Paris');
    const { h, sent } = await run([page], [type, type, type, type, done('Typed')]);

    expect(h.browser.actions.filter(action => action.type === 'input')).toHaveLength(3);
    expect(sent()).toContain('you have already done exactly this 3 times on this page and nothing on it changed');
  });

  it('go on as long as each one changes the page', async () => {
    const feed = (items: number) => ({
      url,
      title: 'Feed',
      elements: [{ text: 'Load more' }, ...Array.from({ length: items }, (_, i) => ({ tag: 'a', text: `Item ${i + 1}` }))],
    });
    const { h, sent } = await run([feed(1), feed(2), feed(3), feed(4), feed(5)], [click(0), click(0), click(0), click(0), done('Loaded')]);

    expect(h.browser.actions.filter(action => action.type === 'click')).toHaveLength(4);
    expect(sent()).not.toContain('nothing on it changed');
  });

  it('refuse a page scroll after three that revealed nothing new', async () => {
    const scroll = call('scroll', { direction: 'down' });
    const { h, sent } = await run([{ url, title: 'Long page', elements: [{ text: 'Top' }] }], [scroll, scroll, scroll, scroll, done('Read')]);

    expect(h.browser.actions.filter(action => action.type === 'scroll_to_text')).toHaveLength(0);
    expect(sent()).toContain('Not scrolled: the last 3 page scrolls revealed nothing new');
  });
});

describe('Going back off a page that shows an applied filter or sort', () => {
  const url = 'https://dir.test/search';
  const sorted = {
    url,
    title: 'Results',
    elements: [{ text: 'Sort: Experience, high to low' }, { tag: 'a', text: 'Top result' }],
  };
  const filtered: Script[] = Array(12).fill(
    plan({
      macro_objective: 'FORM_FILL',
      next_goal: 'Carry on with the task',
      requirements: [{ requirement: 'most experienced', status: 'applied', evidence: 'sort label "Sort: Experience, high to low"' }],
    }),
  );
  const back = call('go_back', {});
  const runSorted = async (navigator: Script[]) => {
    const h = createHarness({ task: 'Find the most experienced agent', pages: [sorted], planner: filtered, navigator });
    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);
    return { h, sent: h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n') };
  };

  it('is refused once, naming what the page shows applied', async () => {
    const { h, sent } = await runSorted([back, done('Reported')]);

    expect(h.browser.actions.filter(action => action.type === 'go_back')).toHaveLength(0);
    expect(sent).toContain('going back removes it');
    expect(sent).toContain('Never leave a page to check what is applied on it');
  });

  it('goes through when the navigator sends it again', async () => {
    const { h } = await runSorted([back, back, done('Reported')]);

    expect(h.browser.actions.filter(action => action.type === 'go_back')).toHaveLength(1);
  });

  it('is not refused on a page that does not show the applied evidence', async () => {
    const profile = { url: 'https://dir.test/agent/one', title: 'Agent', elements: [{ text: '54 years in the business' }] };
    const h = createHarness({ task: 'Find the most experienced agent', pages: [profile], planner: filtered, navigator: [back, done('Reported')] });
    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);

    expect(h.browser.actions.filter(action => action.type === 'go_back')).toHaveLength(1);
  });
});

describe('Verification challenges', () => {
  const blocked = {
    url: 'https://site.test/search',
    title: 'Just a moment',
    text: ['Verify you are human'],
    elements: [{ tag: 'input', attributes: { type: 'checkbox', 'aria-label': "I'm not a robot" } }],
  };

  it('are never clicked, and the user is asked about them once', async () => {
    const { h, sent } = await run(
      [blocked],
      [
        click(0),
        askHuman('Please complete the CAPTCHA in the browser, then answer done.'),
        askHuman('The CAPTCHA is still there. Could you solve the captcha again?'),
        click(0),
        done('The site blocks automated access', false),
      ],
      ['done'],
    );

    expect(h.browser.actions).toEqual([]);
    expect(h.events.filter(event => event.state === ExecutionState.ACT_ASK_HUMAN)).toHaveLength(1);
    const text = sent();
    expect(text).toContain('[0] is part of a verification challenge (CAPTCHA or bot check). Do not interact with verification challenges');
    expect(text).toContain('Not asked: the user was already asked about the verification challenge in this task.');
    expect(text).toContain('[0] is part of a verification challenge, and the user was already asked to complete it.');
  });
});

describe('Questions to the user', () => {
  it('are not asked again once answered', async () => {
    const { h, sent } = await run(
      [{ url: 'https://shop.test/', title: 'Shop' }],
      [askHuman('Which colour do you want?'), askHuman('Which colour do you want?'), done('Blue')],
      ['blue'],
    );

    expect(h.events.filter(event => event.state === ExecutionState.ACT_ASK_HUMAN)).toHaveLength(1);
    expect(sent()).toContain('Not asked: the user already answered this: blue');
  });
});

describe('An element the cached read has lost', () => {
  it('is looked up once in a fresh read and acted on, instead of being refused as stale', async () => {
    const url = 'https://filters.test/';
    const pages: PageSpec[] = [{ url, title: 'Filters', elements: [{ tag: 'button', text: 'Apply', attributes: { 'aria-label': 'Apply' } }] }];
    const h = createHarness({ task: 'Apply the filter', pages, planner: keepPlanning, navigator: [[click(0)], done('Applied')] });
    // The model is shown the button, then the read cached for the action loop catches the page mid-re-render and has
    // lost it; a read taken now has it again. Without the retry the model is told its index is gone and has to
    // re-observe, which is what cost 135 steps in the benchmark.
    const cached = h.browser.getCachedState;
    let shown = false;
    h.browser.getCachedState = async (useVision = false) => {
      const state = await cached(useVision);
      if (!shown) {
        shown = true;
        return state;
      }
      return { ...state, selectorMap: new Map() };
    };

    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);

    expect(h.browser.actions.map(action => action.type)).toContain('click');
    expect(h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n')).not.toContain('is no longer on the page');
  });
});

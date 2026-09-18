import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { call, createHarness, done, plan, settle, stubChrome, textOf, until, type PageSpec } from '../../../__tests__/fakes';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const form: PageSpec = {
  url: 'https://app.test/signup',
  title: 'Sign up',
  elements: [
    { tag: 'input', attributes: { type: 'text', name: 'first' }, text: 'First name' },
    { tag: 'input', attributes: { type: 'text', name: 'last' }, text: 'Last name' },
    { tag: 'input', attributes: { type: 'text', name: 'city' }, text: 'City' },
  ],
};

/** Runs one fill_form call and returns the browser actions it caused and what the navigator was told. */
async function fillOn(args: Record<string, unknown>) {
  const h = createHarness({
    task: 'Fill in the sign-up form',
    pages: [form],
    planner: Array(6).fill(plan()),
    navigator: [call('fill_form', args), done('Filled')],
  });
  const execution = h.executor.execute();
  await until(() => h.llm.remaining('navigator') === 0);
  await h.executor.cancel();
  await settle(execution);
  return { actions: h.browser.actions, said: h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n') };
}

describe('fill_form', () => {
  it('fills every field in one step and one page read', async () => {
    const { actions, said } = await fillOn({
      fields: [
        { index: 0, value: 'Ada' },
        { index: 1, value: 'Lovelace' },
      ],
    });
    expect(actions.filter(action => action.type === 'input')).toEqual([
      { type: 'input', index: 0, text: 'Ada' },
      { type: 'input', index: 1, text: 'Lovelace' },
    ]);
    expect(said).toContain('You filled [0] "Ada", [1] "Lovelace"');
  });

  it('presses Enter in the last field only when asked', async () => {
    const withSubmit = await fillOn({ fields: [{ index: 0, value: 'Ada' }], submit: true });
    expect(withSubmit.actions.some(action => action.type === 'send_keys' && action.text === 'Enter')).toBe(true);

    const without = await fillOn({ fields: [{ index: 0, value: 'Ada' }] });
    expect(without.actions.some(action => action.type === 'send_keys')).toBe(false);
  });

  it('types nothing when one index is not on the page', async () => {
    const { actions, said } = await fillOn({
      fields: [
        { index: 0, value: 'Ada' },
        { index: 9, value: 'Lovelace' },
      ],
    });
    expect(actions.filter(action => action.type === 'input')).toEqual([]);
    expect(said).toContain('[9] is not in the element list you were given');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { call, createHarness, done, plan, settle, stubChrome, textOf, until } from '../../../__tests__/fakes';
import { findWholeText } from '../navigation';
import { upgradeLegacyAction } from '../../../agents/navigator/replay';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs one action on a page whose content is `content` and returns what the navigator was told. */
async function waitOn(content: string, name: string, args: Record<string, unknown>): Promise<string> {
  const h = createHarness({
    pages: [{ url: 'https://app.test/', title: 'App', content }],
    planner: Array(6).fill(plan()),
    navigator: [call(name, args), done('Loaded')],
  });
  const execution = h.executor.execute();
  await until(() => h.llm.remaining('navigator') === 0);
  await h.executor.cancel();
  await settle(execution);
  return h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n');
}

describe('wait_for', () => {
  it('matches a text as whole words and returns the passage around it', () => {
    expect(findWholeText('Status: loadingComplete', 'loading')).toBeNull();
    expect(findWholeText('Status: Loading\n results', 'loading results')).toBe('Status: Loading results');
    expect(findWholeText('Total:$5.00 due', '$5.00')).toBe('Total:$5.00 due');
    expect(findWholeText('anything', '  ')).toBeNull();
  });

  it('reports a condition that was already true instead of calling it a wait', async () => {
    expect(await waitOn('Status: loadingComplete', 'wait_for', { condition: 'text_gone', text: 'loading', seconds: 2 })).toContain(
      'was already gone before the wait began, so nothing was waited for and this proves nothing',
    );
  });

  it('for a text to go reports the passage that still holds it', async () => {
    expect(await waitOn('Please wait, loading results', 'wait_for', { condition: 'text_gone', text: 'loading', seconds: 1 })).toContain(
      '"loading" is still on the page after 1 s, in: "Please wait, loading results".',
    );
  });

  it('waits for a text to appear and says when it never did', async () => {
    expect(await waitOn('Nothing here yet', 'wait_for', { condition: 'text', text: 'Order confirmed', seconds: 1 })).toContain(
      '"Order confirmed" did not appear on the page after 1 s.',
    );
  });

  it('needs the text it waits for, and an index for element_gone', async () => {
    expect(await waitOn('anything', 'wait_for', { condition: 'text', seconds: 1 })).toContain('Not waited: text needs the text to wait for.');
    expect(await waitOn('anything', 'wait_for', { condition: 'element_gone', seconds: 1 })).toContain(
      'Not waited: element_gone needs the index of the element to wait for.',
    );
  });
});

describe('wait', () => {
  it('waits blindly and points at wait_for', async () => {
    expect(await waitOn('anything', 'wait', { seconds: 1 })).toContain('Nothing was checked: wait_for names what you are waiting for');
  });

  it('replays a saved conditional wait as the wait_for that replaced it', () => {
    expect(upgradeLegacyAction({ wait: { text_gone: 'Loading', seconds: 5 } })).toEqual({
      wait_for: { condition: 'text_gone', text: 'Loading', seconds: 5 },
    });
    expect(upgradeLegacyAction({ wait: { seconds: 3 } })).toEqual({ wait: { seconds: 3 } });
  });
});

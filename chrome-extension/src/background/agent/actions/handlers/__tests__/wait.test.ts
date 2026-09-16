import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { call, createHarness, done, plan, settle, stubChrome, textOf, until } from '../../../__tests__/fakes';
import { findWholeText } from '../navigation';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs one wait on a page whose content is `content` and returns what the navigator was told. */
async function waitOn(content: string, args: Record<string, unknown>): Promise<string> {
  const h = createHarness({
    pages: [{ url: 'https://app.test/', title: 'App', content }],
    planner: Array(6).fill(plan()),
    navigator: [call('wait', args), done('Loaded')],
  });
  const execution = h.executor.execute();
  await until(() => h.llm.remaining('navigator') === 0);
  await h.executor.cancel();
  await settle(execution);
  return h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n');
}

describe('wait', () => {
  it('matches a text as whole words and returns the passage around it', () => {
    expect(findWholeText('Status: loadingComplete', 'loading')).toBeNull();
    expect(findWholeText('Status: Loading\n results', 'loading results')).toBe('Status: Loading results');
    expect(findWholeText('Total:$5.00 due', '$5.00')).toBe('Total:$5.00 due');
    expect(findWholeText('anything', '  ')).toBeNull();
  });

  it('for a text to go ignores longer words that contain it', async () => {
    expect(await waitOn('Status: loadingComplete', { text_gone: 'loading', seconds: 2 })).toContain('"loading" is gone from the page');
  });

  it('for a text to go reports the passage that still holds it', async () => {
    expect(await waitOn('Please wait, loading results', { text_gone: 'loading', seconds: 1 })).toContain(
      '"loading" is still on the page after 1 s, in: "Please wait, loading results".',
    );
  });
});

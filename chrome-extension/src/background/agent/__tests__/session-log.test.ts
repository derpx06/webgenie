import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

const records = vi.hoisted(() => [] as Array<{ kind: string; msg: string; data?: unknown }>);
vi.mock('@src/background/trace', async importOriginal => ({
  ...(await importOriginal<typeof import('@src/background/trace')>()),
  record: (entry: { kind: string; msg: string; data?: unknown }) => {
    records.push(entry);
  },
}));

import { createHarness, done, plan, planDone, settle, stubChrome, typeText } from './fakes';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
  records.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Session logs', () => {
  const shop = { url: 'https://shop.test/', title: 'Shop', text: ['Welcome to the garden shop'], elements: [{ tag: 'input', attributes: { 'aria-label': 'Search' } }] };

  const run = async (captureSessions: boolean) => {
    const h = createHarness({
      task: 'Search the shop for garden gloves',
      pages: [shop],
      planner: [plan({ macro_objective: 'SEARCH', next_goal: 'Search for garden gloves' }), planDone('Searched for garden gloves')],
      navigator: [typeText(0, 'garden gloves'), done('Searched for garden gloves')],
      extraArgs: { agentOptions: { captureSessions } },
    });
    await settle(h.executor.execute());
    return records.filter(entry => entry.kind === 'session');
  };

  it('record each model call with the page state it was sent and its full tool calls when on', async () => {
    const sessions = await run(true);
    const typing = sessions.find(entry => entry.msg.includes('input_text'));

    expect(typing).toBeDefined();
    expect(JSON.stringify(typing!.data)).toContain('garden gloves');
    expect(JSON.stringify(typing!.data)).toContain('Welcome to the garden shop');
    expect(sessions.some(entry => entry.msg.includes('done'))).toBe(true);
  });

  it('record nothing when off', async () => {
    expect(await run(false)).toEqual([]);
  });
});

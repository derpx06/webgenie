import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

const traced = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@src/background/trace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../trace')>();
  return { ...actual, record: (entry: Record<string, unknown>) => void traced.push(entry) };
});

import { createHarness, click, done, plan, settle, stubChrome, until } from '../../__tests__/fakes';
import type { Script } from '../../__tests__/fakes';

beforeEach(() => {
  traced.length = 0;
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const keepPlanning: Script[] = Array(8).fill(plan({ macro_objective: 'EXPLORE_PAGE', next_goal: 'Carry on' }));

describe('Every guard verdict', () => {
  it('is traced with the guard name, the verdict and the reason', async () => {
    const h = createHarness({
      task: 'Search the site',
      pages: [
        {
          url: 'https://site.test/search',
          title: 'Just a moment',
          text: ['Verify you are human'],
          elements: [{ tag: 'input', attributes: { type: 'checkbox', 'aria-label': "I'm not a robot" } }],
        },
      ],
      planner: keepPlanning,
      navigator: [click(0), done('The site blocks automated access', false)],
    });
    const execution = h.executor.execute();
    await until(() => h.llm.remaining('navigator') === 0);
    await h.executor.cancel();
    await settle(execution);

    const guards = traced.filter(entry => entry.component === 'Guard');
    expect(guards.map(entry => (entry.data as { guard: string }).guard)).toContain('challenge-element');
    const refusal = guards.find(entry => (entry.data as { guard: string }).guard === 'challenge-element')!;
    expect(refusal.kind).toBe('span');
    expect(refusal.data).toMatchObject({ verdict: 'refused', action: 'click_element' });
    expect(String((refusal.data as { reason: string }).reason)).toContain('verification challenge');
  });
});

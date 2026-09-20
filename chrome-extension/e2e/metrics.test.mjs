// The harness's pure helpers: what a run records about how it was measured, and what a cold task starts with.
// No browser, no model.
import { describe, expect, it, vi } from 'vitest';
import { measurementIntegrity, memoryMode } from './metrics.mjs';
import { Harness } from './run.mjs';

describe('memory mode', () => {
  it('starts every task cold unless the run asks for warm', () => {
    expect(memoryMode({})).toBe('cold');
    expect(memoryMode({ E2E_MEMORY: 'warm' })).toBe('warm');
    expect(memoryMode({ E2E_MEMORY: 'COLD' })).toBe('cold');
    expect(() => memoryMode({ E2E_MEMORY: 'sometimes' })).toThrow(/cold or warm/);
  });
});

describe('the measurement-integrity block', () => {
  const results = [
    { attempt: 'T1', outcome: 'task.ok', pass: true, metrics: { backoffMs: 1_000, failedCallMs: 500 } },
    { attempt: 'T2', outcome: 'task.ok', pass: false, metrics: {} },
    { attempt: 'T3', outcome: 'site_down' },
    { attempt: 'T4', outcome: 'provider_down', provider: { rateLimitWaitMs: 8_500 } },
    { attempt: 'T5', outcome: 'skipped_budget' },
    { attempt: 'T6', outcome: 'harness_error' },
    { attempt: 'T7', outcome: 'limit_time' },
  ];

  it('names the tasks left out, what the harness ended, the provider time lost and how the run was served', () => {
    const integrity = measurementIntegrity(results, {
      model: 'a-model',
      plannerModel: 'a-planner',
      region: 'us-central1',
      lang: 'en-GB',
      timeZone: 'Europe/London',
      memory: 'cold',
    });

    expect(integrity).toMatchObject({
      provider: 'vertex_ai',
      model: 'a-model',
      plannerModel: 'a-planner',
      region: 'us-central1',
      locale: { lang: 'en-GB', timeZone: 'Europe/London' },
      memory: 'cold',
      attempts: 7,
      // The three unmeasurable outcomes are out; harness_error and limit_time still count as attempts of the agent.
      measured: 4,
      passed: 1,
      excluded: { site_down: 1, provider_down: 1, skipped_budget: 1 },
      harnessEnded: 2,
      providerTimeLostMs: 10_000,
    });
    expect(integrity.excludedTasks).toEqual(['T3: site_down', 'T4: provider_down', 'T5: skipped_budget']);
  });

  it('leaves an oracle run out altogether and says nothing it was not told', () => {
    const integrity = measurementIntegrity([{ attempt: 'T1', outcome: 'oracle', pass: true }]);
    expect(integrity).toMatchObject({ attempts: 0, measured: 0, passed: 0, memory: null, region: null, model: null });
  });
});

describe('a cold task', () => {
  it('starts with nothing earlier tasks remembered, and leaves everything else alone', async () => {
    const store = { 'wg_mem:routes': [1], 'wg_mem:site_skills': [2], 'wg_mem:episodes': [3], chat_sessions_meta: [4], 'firewall-settings': {} };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async () => ({ ...store }),
          remove: async keys => [keys].flat().forEach(key => delete store[key]),
        },
      },
    });
    // The harness runs this inside the extension's own page; here it runs against a stand-in for that page's storage.
    const harness = Object.create(Harness.prototype);
    harness.ctl = { evaluate: fn => fn() };

    expect(await harness.clearMemory()).toBe(3);
    expect(Object.keys(store)).toEqual(['chat_sessions_meta', 'firewall-settings']);
    vi.unstubAllGlobals();
  });
});

// The harness's pure helpers: what a run records about how it was measured, and what a cold task starts with.
// No browser, no model.
import { describe, expect, it, vi } from 'vitest';
import { mcnemarP, measurementIntegrity, memoryMode, minDetectableEffect, pairsNeeded } from './metrics.mjs';
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
    { attempt: 'T1', outcome: 'task.ok', pass: true, metrics: { backoffMs: 1_000, pacedMs: 2_000, failedCallMs: 500 } },
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
      // Waiting to stay under the provider's rate is provider time too, not the agent thinking.
      providerTimeLostMs: 12_000,
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

/**
 * The r3 to r4 round moved 52.5% to 55.3% on 217 paired tasks, 21% of which changed verdict, and was read as
 * progress. These pin what such a round can and cannot resolve, so the same misreading shows up in the report itself.
 */
describe('what a paired round can resolve', () => {
  it('cannot see anything under about nine points at 300 tasks, because a third of tasks flip between builds', () => {
    expect(minDetectableEffect(300, 0.3)).toBeCloseTo(0.0886, 3);
    expect(minDetectableEffect(217, 0.3)).toBeCloseTo(0.1042, 3);
  });

  it('says how many paired tasks a five-point change needs', () => {
    expect(pairsNeeded(0.05, 0.3)).toBe(942);
    expect(pairsNeeded(0.03, 0.3)).toBe(2617);
  });

  it('calls a 36 to 30 split noise, and a 50 to 20 split not', () => {
    expect(mcnemarP(36, 30)).toBeGreaterThan(0.4);
    expect(mcnemarP(50, 20)).toBeLessThan(0.001);
    expect(mcnemarP(0, 0)).toBe(1);
  });

  it('does not underflow on a large number of changed tasks', () => {
    expect(mcnemarP(400, 380)).toBeGreaterThan(0.3);
    expect(Number.isFinite(mcnemarP(900, 900))).toBe(true);
  });
});

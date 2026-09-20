import { describe, it, expect } from 'vitest';
import type { TraceRecord } from '../trace';
import { slimRecord, summarizeTask, formatDuration, formatTokens } from '../trace-summary';

const T0 = 1_700_000_000_000;

const rec = (entry: Partial<TraceRecord> & { ts: number; msg: string }): TraceRecord => ({
  level: 'info',
  kind: 'log',
  component: 'Executor',
  ...entry,
});

const llm = (at: number, durationMs: number, extra: Partial<TraceRecord> = {}, msg = 'llm call gemini-2.5-flash') =>
  rec({
    ts: T0 + at,
    kind: 'llm',
    component: 'navigator',
    msg,
    durationMs,
    step: 0,
    data: {
      model: 'gemini-2.5-flash',
      usage: { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 400, reasoningTokens: 50 },
    },
    ...extra,
  });

describe('slimRecord', () => {
  it('keeps the read fields and drops everything else', () => {
    const slim = slimRecord(
      rec({
        ts: T0,
        kind: 'session',
        msg: 'model call: click_element',
        data: { model: 'x', state: 'a'.repeat(200_000), usage: { inputTokens: 5 } },
      }),
    );
    expect(slim.model).toBe('x');
    expect(slim.usage).toEqual({ inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 });
    expect(JSON.stringify(slim).length).toBeLessThan(500);
  });

  it('flattens an error to its message', () => {
    const slim = slimRecord(
      rec({ ts: T0, kind: 'llm', msg: 'llm call failed', data: { error: { message: 'LLM call timed out after 25000ms' } } }),
    );
    expect(slim.error).toContain('timed out');
  });
});

describe('summarizeTask overview', () => {
  const records = [
    rec({ ts: T0, msg: '🚀 Executing task: find the cheapest flight' }),
    rec({ ts: T0 + 10, kind: 'event', component: 'system', msg: 'task.start', step: 0, data: { details: 'abc' } }),
    llm(T0 - T0 + 5_000, 4_000),
    rec({ ts: T0 + 6_000, kind: 'span', component: 'NavigatorAgent', msg: 'action click_element', durationMs: 120, step: 0 }),
    rec({ ts: T0 + 6_100, kind: 'span', component: 'Validation', msg: 'validated click_element: passed', step: 0 }),
    llm(12_000, 3_000, { step: 1, component: 'planner' }),
    rec({
      ts: T0 + 13_000,
      kind: 'event',
      component: 'system',
      msg: 'task.ok',
      step: 1,
      data: { details: 'the cheapest flight is $120' },
    }),
  ];

  it('reads the task text, outcome, steps, calls and tokens', () => {
    const { overview } = summarizeTask('task-1', records.map(slimRecord));
    expect(overview.task).toBe('find the cheapest flight');
    expect(overview.outcome).toBe('ok');
    expect(overview.outcomeDetails).toBe('the cheapest flight is $120');
    expect(overview.steps).toBe(2);
    expect(overview.llmCalls).toBe(2);
    expect(overview.tokens.inputTokens).toBe(2_000);
    expect(overview.tokens.cacheReadTokens).toBe(800);
    expect(overview.cachedShare).toBeCloseTo(0.4);
    expect(overview.models).toEqual(['gemini-2.5-flash']);
    expect(overview.durationMs).toBe(13_000);
  });

  it('is unsorted-input safe', () => {
    const shuffled = [...records].reverse().map(slimRecord);
    expect(summarizeTask('task-1', shuffled).overview).toEqual(summarizeTask('task-1', records.map(slimRecord)).overview);
  });

  it('reports a task with no terminal event as running', () => {
    const { overview } = summarizeTask('task-2', [slimRecord(rec({ ts: T0, msg: 'x', step: 0 }))]);
    expect(overview.outcome).toBe('running');
    expect(overview.cachedShare).toBe(0);
  });

  it('returns zeroes for an empty task rather than throwing', () => {
    const { overview, wallClock } = summarizeTask('empty', []);
    expect(overview.durationMs).toBe(0);
    expect(wallClock.totalMs).toBe(0);
  });
});

describe('summarizeTask wall clock', () => {
  it('charges each millisecond to one bucket, highest priority first', () => {
    // A 4 s model call that overlaps a 3 s getState: the model call owns the overlap.
    const records = [
      rec({ ts: T0, msg: 'start', step: 0 }),
      llm(4_000, 4_000),
      rec({ ts: T0 + 5_000, kind: 'span', component: 'BrowserContext', msg: 'getState', durationMs: 3_000, step: 0 }),
    ].map(slimRecord);
    const { wallClock } = summarizeTask('t', records);
    expect(wallClock.modelOkMs).toBe(4_000);
    // getState ran T0+2000..T0+5000; T0+2000..T0+4000 is already the model call's.
    expect(wallClock.getStateMs).toBe(1_000);
    expect(wallClock.totalMs).toBe(5_000);
    expect(wallClock.otherMs).toBe(0);
  });

  it('turns a rate-limit retry line into forward-looking backoff', () => {
    const records = [
      rec({ ts: T0, msg: 'start', step: 0 }),
      rec({
        ts: T0 + 1_000,
        kind: 'llm',
        level: 'warning',
        component: 'navigator',
        msg: 'rate limited; retrying in 12.5s',
        step: 0,
        data: { model: 'm', attempt: 1 },
      }),
    ].map(slimRecord);
    const { wallClock, health } = summarizeTask('t', records);
    expect(wallClock.backoffMs).toBe(12_500);
    expect(wallClock.totalMs).toBe(13_500);
    expect(health.rateLimited).toBe(1);
  });

  it('separates failed and superseded calls from successful ones', () => {
    const records = [
      rec({ ts: T0, msg: 'start', step: 0 }),
      llm(3_000, 2_000),
      llm(
        30_000,
        25_000,
        { level: 'error', data: { model: 'm', error: { message: 'LLM call timed out after 25000ms' } } },
        'llm call m failed',
      ),
      llm(40_000, 5_000, { data: { model: 'm' } }, 'llm call m superseded'),
    ].map(slimRecord);
    const { wallClock, health } = summarizeTask('t', records);
    expect(wallClock.modelOkMs).toBe(2_000);
    expect(wallClock.modelFailedMs).toBe(25_000);
    expect(wallClock.hedgeMs).toBe(5_000);
    expect(health.failedCalls).toBe(1);
    expect(health.timeouts).toBe(1);
  });

  it('takes the settle window from the [ActionSettle] log line', () => {
    const records = [
      rec({ ts: T0, msg: 'start', step: 0 }),
      rec({ ts: T0 + 3_000, msg: '[ActionSettle] click_element settled=true polls=1 elapsed=900ms total=2100ms', step: 0 }),
    ].map(slimRecord);
    expect(summarizeTask('t', records).wallClock.settleMs).toBe(2_100);
  });

  it('leaves untraced time in otherMs', () => {
    const records = [rec({ ts: T0, msg: 'start', step: 0 }), llm(10_000, 1_000)].map(slimRecord);
    const { wallClock } = summarizeTask('t', records);
    expect(wallClock.otherMs).toBe(9_000);
  });
});

describe('summarizeTask health and steps', () => {
  it('counts the failure and guard records', () => {
    const records = [
      rec({ ts: T0, kind: 'llm', level: 'warning', component: 'navigator', msg: 'slow call; sending a duplicate request' }),
      rec({ ts: T0 + 1, kind: 'llm', level: 'warning', component: 'navigator', msg: 'transient failure; retrying once' }),
      rec({ ts: T0 + 2, kind: 'llm', level: 'warning', component: 'navigator', msg: 'tool call validation failed' }),
      rec({ ts: T0 + 3, kind: 'llm', level: 'error', component: 'navigator', msg: 'no valid tool call after re-asks' }),
      rec({ ts: T0 + 4, kind: 'llm', level: 'warning', component: 'planner', msg: 'provider unreachable; retrying in 2.0s' }),
      rec({ ts: T0 + 5, kind: 'span', component: 'NavigatorAgent', msg: 'intent check' }),
      rec({ ts: T0 + 6, kind: 'span', component: 'Validation', msg: 'validated click_element: failed' }),
    ].map(slimRecord);
    const { health } = summarizeTask('t', records);
    expect(health).toMatchObject({
      hedges: 1,
      transientRetries: 1,
      validationReasks: 1,
      toolCallGiveUps: 1,
      providerUnreachable: 1,
      guardChecks: 1,
      validationsFailed: 1,
      errors: 1,
    });
  });

  it('groups the timeline by step with per-step tokens and latency', () => {
    const records = [
      llm(1_000, 1_000, { step: 0 }),
      rec({ ts: T0 + 1_200, kind: 'span', component: 'NavigatorAgent', msg: 'action click_element', durationMs: 120, step: 0 }),
      rec({ ts: T0 + 1_300, kind: 'span', component: 'Validation', msg: 'validated click_element: passed', step: 0 }),
      llm(5_000, 2_000, { step: 1, component: 'planner' }),
      rec({ ts: T0 + 5_100, level: 'error', msg: 'boom', step: 1 }),
    ].map(slimRecord);
    const steps = summarizeTask('t', records).steps;
    expect(steps.map(step => step.step)).toEqual([0, 1]);
    expect(steps[0].actions).toEqual([{ ts: T0 + 1_200, name: 'click_element', durationMs: 120, error: undefined }]);
    expect(steps[0].validations[0].verdict).toBe('passed');
    expect(steps[0].tokens.inputTokens).toBe(1_000);
    expect(steps[0].modelMs).toBe(1_000);
    expect(steps[1].llmCalls[0].component).toBe('planner');
    expect(steps[1].errors).toHaveLength(1);
  });
});

describe('formatters', () => {
  it('scales units', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(4_500)).toBe('4.5s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1_500)).toBe('1.5k');
    expect(formatTokens(191_000)).toBe('191k');
    expect(formatTokens(2_300_000)).toBe('2.3M');
  });
});

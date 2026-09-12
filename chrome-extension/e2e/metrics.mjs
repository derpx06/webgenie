// Health metrics, failure timelines and the regression ratchet, all computed from trace records
// (IndexedDB `WebGenieTraces`) and the events the side-panel port received.

const median = values => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const recordText = r => `${r.component} ${r.msg} ${r.data === undefined ? '' : JSON.stringify(r.data)}`;
const countOf = (records, pattern) => records.filter(r => pattern.test(recordText(r))).length;

/** Counters where any increase over the baseline is a regression (compared per task attempt). */
export const HEALTH_COUNTERS = [
  'schemaRejections',
  'notAllowedReasks',
  'notAttached',
  'sessionNotFound',
  'orphaned',
  'emptyDom',
  'snapshotExtractor',
  'authBlockerWaits',
  'secretLeaks',
  'unackedDispatches',
  'hung',
  'harnessErrors',
];

export function taskMetrics(records, events, { secret } = {}) {
  const llm = records.filter(r => r.kind === 'llm');
  const calls = llm.filter(r => r.level === 'info' && String(r.msg).startsWith('llm call'));
  const reasks = llm.filter(r => r.msg === 'tool call validation failed');
  const issues = r => JSON.stringify(r.data?.issues ?? {});
  const providerRejections = llm.filter(r => r.level === 'error' && /\b400\b|INVALID_ARGUMENT|schema/i.test(JSON.stringify(r.data ?? {})));
  const spans = records.filter(r => r.kind === 'span');

  const getState = spans.filter(r => r.component === 'BrowserContext' && r.msg === 'getState').map(r => r.durationMs ?? 0);
  const actionDurations = {};
  for (const r of spans.filter(s => s.component === 'NavigatorAgent' && String(s.msg).startsWith('action '))) {
    (actionDurations[r.msg.slice(7)] ??= []).push(r.durationMs ?? 0);
  }
  const validations = {};
  for (const r of spans.filter(s => s.component === 'Validation')) {
    const status = String(r.msg).split(': ').pop();
    validations[status] = (validations[status] ?? 0) + 1;
  }
  const replans = {};
  for (const r of records) {
    const match = /Replan decision: true trigger=(\w+)/.exec(String(r.msg));
    if (match) replans[match[1]] = (replans[match[1]] ?? 0) + 1;
  }
  const dispatches = spans.filter(r => r.msg === 'input dispatch');
  const sum = key => calls.reduce((total, r) => total + (r.data?.usage?.[key] ?? 0), 0);

  // Leaks count only where typed text must never appear: action events and action/validation spans.
  let secretLeaks = 0;
  if (secret) {
    const leakSources = [
      ...events.filter(e => String(e.state ?? '').startsWith('act.')),
      ...spans.filter(r => ['NavigatorAgent', 'Validation', 'Action'].includes(r.component)),
      ...reasks,
    ];
    secretLeaks = leakSources.filter(item => JSON.stringify(item).includes(secret)).length;
  }

  return {
    llmCalls: calls.length,
    plannerCalls: calls.filter(r => r.component === 'planner').length,
    navigatorCalls: calls.filter(r => r.component === 'navigator').length,
    reasks: reasks.length,
    notAllowedReasks: reasks.filter(r => /not allowed by the current plan/.test(issues(r))).length,
    schemaRejections:
      reasks.filter(r => /invalid arguments|unknown tool|not valid JSON/.test(issues(r))).length + providerRejections.length,
    tokens: { input: sum('inputTokens'), output: sum('outputTokens'), cached: sum('cacheReadTokens'), reasoning: sum('reasoningTokens') },
    getStateCount: getState.length,
    getStateMs: getState,
    actionMs: actionDurations,
    validations,
    replans,
    dispatches: dispatches.length,
    unackedDispatches:
      dispatches.filter(r => r.data?.acked === false && !r.data?.dialogOpened).length + countOf(records, /CDP click failed|CDP Click timeout/),
    notAttached: countOf(records, /Debugger is not attached/),
    sessionNotFound: countOf(records, /Session with ID .* not found/),
    orphaned: countOf(records, /orphaned selectorMap/),
    emptyDom: countOf(records, /Empty DOM on attempt/),
    snapshotExtractor: countOf(records, /DOMSnapshotExtractor|native DOM snapshot/i),
    authBlockerWaits: countOf(records, /authentication or permission blocker/i),
    secretLeaks,
  };
}

/** Actions, validations, replans and failures, one line each, for triaging a failed task. */
export function timeline(records, events) {
  const t0 = Math.min(...records.map(r => r.ts), ...events.map(e => e.ts ?? Infinity));
  const lines = [];
  const at = ts => `+${((ts - t0) / 1000).toFixed(1).padStart(6)}s`;
  for (const r of [...records].sort((a, b) => a.ts - b.ts)) {
    const d = r.data ?? {};
    if (r.kind === 'span' && r.component === 'NavigatorAgent' && String(r.msg).startsWith('action ')) {
      const args = { ...(d.args ?? {}) };
      delete args.targetFingerprint;
      delete args.observationId;
      lines.push(`${at(r.ts)} step=${r.step} ${r.msg} ${JSON.stringify(args)} (${r.durationMs}ms)${d.error ? ` ERROR ${d.error}` : ''}`);
    } else if (r.kind === 'span' && r.component === 'Validation') {
      lines.push(`${at(r.ts)} step=${r.step}   ${r.msg}${d.failureReason ? ` — ${d.failureReason}` : ''}`);
    } else if (/Replan decision: true/.test(String(r.msg))) {
      lines.push(`${at(r.ts)} step=${r.step} REPLAN ${String(r.msg).replace(/^.*Replan decision: true /, '')}`);
    } else if (r.kind === 'llm' && r.level !== 'info') {
      lines.push(`${at(r.ts)} step=${r.step} LLM ${r.level} ${r.msg} ${JSON.stringify(d.issues ?? d.error?.message ?? '').slice(0, 300)}`);
    } else if (r.kind === 'llm' && r.component === 'planner') {
      lines.push(`${at(r.ts)} step=${r.step} planner call (${r.durationMs}ms)`);
    } else if (r.level === 'error' && r.kind === 'log') {
      lines.push(`${at(r.ts)} step=${r.step} ERROR ${r.component}: ${String(r.msg).slice(0, 200)}`);
    }
  }
  for (const e of events) {
    if (['act.fail', 'act.ask_human', 'task.ok', 'task.fail', 'task.cancel', 'task.pause'].includes(e.state)) {
      lines.push(`[event t=${(e.t / 1000).toFixed(1)}s] ${e.state} ${String(e.data?.details ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
  return lines.join('\n');
}

/** Per-suite aggregates used by the summary and the ratchet. */
export function suiteHealth(results) {
  const health = {};
  for (const suite of [...new Set(results.map(r => r.suite))]) {
    const rows = results.filter(r => r.suite === suite);
    const all = key => rows.flatMap(r => r.metrics?.[key] ?? []);
    const actions = name => rows.flatMap(r => r.metrics?.actionMs?.[name] ?? []);
    const counters = Object.fromEntries(HEALTH_COUNTERS.map(key => [key, rows.reduce((n, r) => n + (r.metrics?.[key] ?? 0), 0)]));
    counters.hung = rows.filter(r => /limit/.test(r.outcome)).length;
    counters.harnessErrors = rows.filter(r => r.outcome === 'harness_error').length;
    health[suite] = {
      attempts: rows.length,
      passed: rows.filter(r => r.pass).length,
      ...counters,
      getStateMedianMs: median(all('getStateMs')),
      getStateP90Ms: percentile(all('getStateMs'), 90),
      clickMedianMs: median(actions('click_element')),
      inputMedianMs: median(actions('input_text')),
      plannerCalls: rows.reduce((n, r) => n + (r.metrics?.plannerCalls ?? 0), 0),
      navigatorCalls: rows.reduce((n, r) => n + (r.metrics?.navigatorCalls ?? 0), 0),
      inputTokens: rows.reduce((n, r) => n + (r.metrics?.tokens?.input ?? 0), 0),
    };
  }
  return health;
}

export function baselineFrom(results, health) {
  const tasks = {};
  for (const r of results) {
    const key = `${r.suite}:${r.id}`;
    const entry = (tasks[key] ??= { passes: 0, runs: 0, seconds: [], llmCalls: [] });
    entry.runs += 1;
    entry.passes += r.pass ? 1 : 0;
    entry.seconds.push(r.seconds);
    entry.llmCalls.push(r.metrics?.llmCalls ?? 0);
  }
  for (const entry of Object.values(tasks)) {
    entry.seconds = median(entry.seconds);
    entry.llmCalls = median(entry.llmCalls);
  }
  return { updatedAt: new Date().toISOString(), tasks, health };
}

/** Regressions against the committed baseline. Any entry here fails a full run. */
export function compareWithBaseline(results, health, baseline) {
  if (!baseline) return { regressions: [], improvements: ['no baseline yet'] };
  const regressions = [];
  const improvements = [];
  const current = baselineFrom(results, health).tasks;
  for (const [key, now] of Object.entries(current)) {
    const before = baseline.tasks[key];
    if (!before) continue;
    if (before.passes === before.runs && now.passes < now.runs) regressions.push(`${key} passed every run before, now ${now.passes}/${now.runs}`);
    if (before.passes < before.runs && now.passes === now.runs) improvements.push(`${key} now passes every run`);
  }
  for (const [suite, now] of Object.entries(health)) {
    const before = baseline.health?.[suite];
    if (!before) continue;
    const rate = (h, key) => (h[key] ?? 0) / Math.max(1, h.attempts);
    if (rate(now, 'passed') < rate(before, 'passed')) regressions.push(`${suite} pass rate ${now.passed}/${now.attempts} < ${before.passed}/${before.attempts}`);
    for (const key of HEALTH_COUNTERS) {
      if (rate(now, key) > rate(before, key)) regressions.push(`${suite} ${key} ${now[key]} (was ${before[key]} over ${before.attempts} attempts)`);
      else if (rate(now, key) < rate(before, key)) improvements.push(`${suite} ${key} ${before[key]} → ${now[key]}`);
    }
    for (const key of ['clickMedianMs', 'inputMedianMs', 'getStateMedianMs']) {
      if (before[key] && now[key] && now[key] > before[key] * 1.25) regressions.push(`${suite} ${key} ${now[key]} > 1.25 × ${before[key]}`);
      else if (before[key] && now[key] && now[key] < before[key]) improvements.push(`${suite} ${key} ${before[key]} → ${now[key]}`);
    }
  }
  return { regressions, improvements };
}

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

/** Wilson 95% interval for k successes in n trials: how far a pass rate could move from noise alone. */
export function wilson(k, n) {
  if (!n) return null;
  const z = 1.96;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)].map(x => +x.toFixed(3));
}

/** US dollars per million tokens; estimates, override with E2E_PRICE_INPUT / _CACHED / _OUTPUT (gemini-2.5-flash list price). */
const PRICE = {
  input: Number(process.env.E2E_PRICE_INPUT ?? 0.3),
  cached: Number(process.env.E2E_PRICE_CACHED ?? 0.075),
  output: Number(process.env.E2E_PRICE_OUTPUT ?? 2.5),
};
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
  'storageLeaks',
  'unackedDispatches',
  'hung',
  'harnessErrors',
];

/**
 * Extension storage entries that contain a needle. Only the conversation itself is exempt (the chat messages the user
 * keeps, and the session copy of the transcript the agent resumes from): a secret the user typed into a task must not
 * end up in memory, histories, working memory or other records.
 */
export function storageLeaks(dump, needle) {
  if (!needle || !dump) return [];
  return Object.entries(dump)
    .filter(([key, value]) => !/^local:chat_messages_|^session:[^:]+$/.test(key) && JSON.stringify(value).includes(needle))
    .map(([key]) => key);
}

/** Outcomes that say nothing about the agent (its start page or the model provider was unreachable): left out of pass rates. */
export const UNMEASURED = new Set(['site_down', 'provider_down']);

export function taskMetrics(records, events, { secret, taskText = '', storage } = {}) {
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

  // A secret must not appear in any event or trace record (plans and memory notes included), except inside the
  // user's own task text, which the agent logs as given.
  let secretLeaks = 0;
  if (secret) {
    const quotedTask = JSON.stringify(taskText).slice(1, -1);
    const leaks = item => (quotedTask ? JSON.stringify(item).split(quotedTask).join('') : JSON.stringify(item)).includes(secret);
    secretLeaks = [...events, ...records].filter(leaks).length;
  }

  const cachedShare = {};
  for (const agent of [...new Set(calls.map(r => r.component))]) {
    const own = calls.filter(r => r.component === agent);
    const input = own.reduce((n, r) => n + (r.data?.usage?.inputTokens ?? 0), 0);
    cachedShare[agent] = input ? +(own.reduce((n, r) => n + (r.data?.usage?.cacheReadTokens ?? 0), 0) / input).toFixed(2) : 0;
  }

  // Does a long task get slower or costlier as it goes? First third of the navigator calls against the last third.
  const navigatorCalls = calls.filter(r => r.component === 'navigator');
  const average = rows => (rows.length ? Math.round(rows.reduce((n, value) => n + value, 0) / rows.length) : null);
  const third = Math.floor(navigatorCalls.length / 3);
  const trend =
    navigatorCalls.length >= 12
      ? {
          calls: navigatorCalls.length,
          inputTokensFirst: average(navigatorCalls.slice(0, third).map(r => r.data?.usage?.inputTokens ?? 0)),
          inputTokensLast: average(navigatorCalls.slice(-third).map(r => r.data?.usage?.inputTokens ?? 0)),
          latencyFirstMs: average(navigatorCalls.slice(0, third).map(r => r.durationMs ?? 0)),
          latencyLastMs: average(navigatorCalls.slice(-third).map(r => r.durationMs ?? 0)),
          getStateFirstMs: average(getState.slice(0, Math.floor(getState.length / 3))),
          getStateLastMs: average(getState.slice(-Math.floor(getState.length / 3))),
        }
      : null;

  // Done checks the evidence alone would have settled, and those where the planner then disagreed (a skip would be wrong).
  const skippable = records.filter(r => r.msg === 'verify.skippable' && r.data?.skippable);
  // Where time goes besides useful work: waiting out rate limits, and calls that failed.
  const backoffMs = llm
    .map(r => /rate limited; retrying in ([\d.]+)s/.exec(String(r.msg)))
    .filter(Boolean)
    .reduce((n, match) => n + Number(match[1]) * 1000, 0);
  const failedCallMs = llm.filter(r => r.level === 'error').reduce((n, r) => n + (r.durationMs ?? 0), 0);
  const firstAction = records.filter(r => r.kind === 'span' && String(r.msg).startsWith('action ')).map(r => r.ts).sort((a, b) => a - b)[0];
  const firstRecord = records.map(r => r.ts).sort((a, b) => a - b)[0];
  const tokens = { input: sum('inputTokens'), output: sum('outputTokens'), cached: sum('cacheReadTokens'), reasoning: sum('reasoningTokens') };
  const costUsd = +(((tokens.input - tokens.cached) * PRICE.input + tokens.cached * PRICE.cached + (tokens.output + tokens.reasoning) * PRICE.output) / 1e6).toFixed(4);

  return {
    llmCalls: calls.length,
    trend,
    verifySkippable: skippable.length,
    verifySkippableWrong: skippable.filter(r => !r.data?.plannerDone).length,
    backoffMs,
    failedCallMs,
    hedgedCalls: llm.filter(r => r.msg === 'slow call; sending a duplicate request').length,
    screenshots: records.filter(r => r.msg === 'screenshot attached').length,
    firstActionMs: firstAction && firstRecord ? firstAction - firstRecord : null,
    costUsd,
    plannerCalls: calls.filter(r => r.component === 'planner').length,
    navigatorCalls: calls.filter(r => r.component === 'navigator').length,
    cachedShare,
    rateLimited: countOf(llm.filter(r => r.level !== 'info'), /\b429\b|RESOURCE_EXHAUSTED|rate limit/i),
    llmTimeouts: countOf(llm.filter(r => r.level !== 'info'), /timed out|timeout/i),
    reasks: reasks.length,
    notAllowedReasks: reasks.filter(r => /not allowed by the current plan/.test(issues(r))).length,
    schemaRejections:
      reasks.filter(r => /invalid arguments|unknown tool|not valid JSON/.test(issues(r))).length + providerRejections.length,
    tokens,
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
    storageLeaks: storageLeaks(storage, secret).length,
    storageLeakKeys: storageLeaks(storage, secret),
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
    // A site that was down says nothing about the agent.
    const rows = results.filter(r => r.suite === suite && !UNMEASURED.has(r.outcome));
    const all = key => rows.flatMap(r => r.metrics?.[key] ?? []);
    const actions = name => rows.flatMap(r => r.metrics?.actionMs?.[name] ?? []);
    const counters = Object.fromEntries(HEALTH_COUNTERS.map(key => [key, rows.reduce((n, r) => n + (r.metrics?.[key] ?? 0), 0)]));
    counters.hung = rows.filter(r => /limit/.test(r.outcome)).length;
    counters.harnessErrors = rows.filter(r => r.outcome === 'harness_error').length;
    const passed = rows.filter(r => r.pass).length;
    const byTask = Object.values(Object.groupBy(rows, r => r.id));
    const totalSeconds = rows.reduce((n, r) => n + (r.seconds ?? 0), 0);
    health[suite] = {
      attempts: rows.length,
      passed,
      passRateCI: wilson(passed, rows.length),
      /** Share of tasks that passed on every attempt (pass^k): what a user relying on the agent experiences. */
      passedEveryAttempt: +(byTask.filter(attempts => attempts.every(r => r.pass)).length / Math.max(1, byTask.length)).toFixed(3),
      /** Finished as done but the checker disagreed: the agent claimed a result it did not achieve. */
      wrongDone: rows.filter(r => r.outcome === 'task.ok' && !r.pass).length,
      needlessQuestions: rows.reduce((n, r) => n + Math.max(0, (r.questions?.length ?? 0) - (r.questionsExpected ?? 0)), 0),
      missedQuestions: rows.reduce((n, r) => n + Math.max(0, (r.questionsExpected ?? 0) - (r.questions?.length ?? 0)), 0),
      medianSeconds: median(rows.map(r => r.seconds ?? 0)),
      firstActionMedianMs: median(rows.map(r => r.metrics?.firstActionMs).filter(v => typeof v === 'number')),
      backoffShare: +(rows.reduce((n, r) => n + (r.metrics?.backoffMs ?? 0) + (r.metrics?.failedCallMs ?? 0), 0) / 1000 / Math.max(1, totalSeconds)).toFixed(3),
      costUsd: +rows.reduce((n, r) => n + (r.metrics?.costUsd ?? 0), 0).toFixed(3),
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

export function baselineFrom(results, health, repeats = 1) {
  const tasks = {};
  for (const r of results.filter(row => !UNMEASURED.has(row.outcome))) {
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
  return { updatedAt: new Date().toISOString(), repeats, tasks, health: withTaskPassRates(health, tasks) };
}

/** Suite pass counts always come from the task entries, so a merged or re-run entry cannot contradict them. */
function withTaskPassRates(health, tasks) {
  const out = structuredClone(health ?? {});
  for (const suite of Object.keys(out)) {
    const entries = Object.entries(tasks).filter(([key]) => key.startsWith(`${suite}:`)).map(([, entry]) => entry);
    out[suite].passed = entries.reduce((n, entry) => n + entry.passes, 0);
    out[suite].attempts = entries.reduce((n, entry) => n + entry.runs, 0);
  }
  return out;
}

/** A subset run re-measures some tasks: replace their entries, keep the rest, recompute suite pass rates. */
export function mergeBaseline(baseline, results, repeats = 1) {
  const fresh = baselineFrom(results, {}, repeats);
  const tasks = { ...baseline.tasks, ...fresh.tasks };
  return { ...baseline, updatedAt: fresh.updatedAt, tasks, health: withTaskPassRates(baseline.health, tasks) };
}

/**
 * Regressions against the committed baseline; any entry fails a full run. Latency changes are only
 * regressions when both runs repeated every task: single-attempt medians move with the network.
 */
export function compareWithBaseline(results, health, baseline, repeats = 1) {
  if (!baseline) return { regressions: [], warnings: [], improvements: ['no baseline yet'] };
  const regressions = [];
  const warnings = [];
  const improvements = [];
  const current = baselineFrom(results, health, repeats);
  for (const [key, now] of Object.entries(current.tasks)) {
    const before = baseline.tasks[key];
    if (!before) continue;
    if (before.passes === before.runs && now.passes < now.runs) regressions.push(`${key} passed every run before, now ${now.passes}/${now.runs}`);
    if (before.passes < before.runs && now.passes === now.runs) improvements.push(`${key} now passes every run`);
  }
  const beforeHealth = withTaskPassRates(baseline.health, baseline.tasks);
  const latency = repeats >= 2 && (baseline.repeats ?? 1) >= 2 ? regressions : warnings;
  for (const [suite, now] of Object.entries(current.health)) {
    const before = beforeHealth[suite];
    if (!before) continue;
    const rate = (h, key) => (h[key] ?? 0) / Math.max(1, h.attempts);
    if (rate(now, 'passed') < rate(before, 'passed')) regressions.push(`${suite} pass rate ${now.passed}/${now.attempts} < ${before.passed}/${before.attempts}`);
    for (const key of HEALTH_COUNTERS) {
      if (rate(now, key) > rate(before, key)) regressions.push(`${suite} ${key} ${now[key]} (was ${before[key] ?? 0} over ${before.attempts} attempts)`);
      else if (rate(now, key) < rate(before, key)) improvements.push(`${suite} ${key} ${before[key]} → ${now[key]}`);
    }
    for (const key of ['clickMedianMs', 'inputMedianMs', 'getStateMedianMs']) {
      if (before[key] && now[key] && now[key] > before[key] * 1.25) latency.push(`${suite} ${key} ${now[key]} > 1.25 × ${before[key]}`);
      else if (before[key] && now[key] && now[key] < before[key]) improvements.push(`${suite} ${key} ${before[key]} → ${now[key]}`);
    }
  }
  return { regressions, warnings, improvements };
}

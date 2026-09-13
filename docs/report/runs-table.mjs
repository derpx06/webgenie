// Every e2e run as one row (build, scope, pass rate with Wilson interval, tokens, cost, time), for the report.
// Usage: node docs/report/runs-table.mjs [results dir] > docs/report/runs.json
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../../chrome-extension/e2e/metrics.mjs';

const dir = process.argv[2] ?? path.resolve(import.meta.dirname, '../../chrome-extension/e2e/results');
const median = values => {
  const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

const rows = [];
for (const name of fs.readdirSync(dir).sort()) {
  const file = path.join(dir, name, 'summary.json');
  if (!fs.existsSync(file)) continue;
  const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
  const counted = summary.results.filter(r => !['site_down', 'provider_down', 'oracle', 'skipped_budget'].includes(r.outcome));
  if (counted.length === 0) continue;
  const passed = counted.filter(r => r.pass).length;
  const metric = key => counted.reduce((n, r) => n + (r.metrics?.[key] ?? 0), 0);
  rows.push({
    run: summary.runId ?? name,
    git: summary.gitSha,
    dirty: summary.gitDirty,
    scope: summary.suite,
    repeats: summary.repeats ?? 1,
    attempts: counted.length,
    passed,
    passRate: +(passed / counted.length).toFixed(3),
    ci: wilson(passed, counted.length),
    inputTokens: counted.reduce((n, r) => n + (r.metrics?.tokens?.input ?? 0), 0),
    cachedTokens: counted.reduce((n, r) => n + (r.metrics?.tokens?.cached ?? 0), 0),
    llmCalls: metric('llmCalls'),
    plannerCalls: metric('plannerCalls'),
    navigatorCalls: metric('navigatorCalls'),
    costUsd: +metric('costUsd').toFixed(3),
    medianSeconds: median(counted.map(r => r.seconds)),
    totalSeconds: Math.round(counted.reduce((n, r) => n + (r.seconds ?? 0), 0)),
    failures: counted.filter(r => !r.pass).map(r => ({ id: r.attempt, outcome: r.outcome, detail: String(r.detail ?? '').slice(0, 160) })),
    suites: Object.fromEntries(Object.entries(summary.health ?? {}).map(([suite, h]) => [suite, { passed: h.passed, attempts: h.attempts }])),
  });
}
process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);

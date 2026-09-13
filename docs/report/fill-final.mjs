// Fills the final-run section of docs/report/index.html from a run's summary.json.
// Usage: node docs/report/fill-final.mjs chrome-extension/e2e/results/<run>
// Attempts skipped at the token cap, whose site or model provider was unreachable, or whose access token expired
// mid-task are unmeasured and left out of pass rates.
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../../chrome-extension/e2e/metrics.mjs';

const HERE = import.meta.dirname;
const PAGE = path.join(HERE, 'index.html');
const MARK = '<!--FINAL:final-run-->';
const SUITES = [
  ['core', 'Core'],
  ['complex', 'Complex'],
  ['hitl', 'Human in the loop'],
  ['security', 'Security'],
  ['breadth', 'Breadth'],
  ['endurance', 'Endurance'],
  ['resilience', 'Resilience'],
  ['memory', 'Memory'],
  ['files', 'Files'],
  ['vision', 'Vision'],
  ['panel', 'Side panel'],
];

const summary = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'summary.json'), 'utf8'));
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const unmeasured = r => ['site_down', 'provider_down', 'skipped_budget'].includes(r.outcome) || /invalid authentication credentials/.test(String(r.answer));
const measured = summary.results.filter(r => !unmeasured(r));
const passed = measured.filter(r => r.pass).length;
const ci = wilson(passed, measured.length);
const pct = value => `${(value * 100).toFixed(1)}%`;

const tasks = new Map();
for (const r of summary.results) {
  const task = tasks.get(r.id) ?? { suite: r.suite, title: r.title, runs: [] };
  task.runs.push(unmeasured(r) ? 'not run' : r.pass ? 'pass' : 'fail');
  tasks.set(r.id, task);
}
const chipClass = runs => {
  const counted = runs.filter(run => run !== 'not run');
  if (counted.length === 0) return 'skip';
  if (counted.every(run => run === 'pass')) return 'pass';
  return counted.every(run => run === 'fail') ? 'fail' : 'half';
};

const suiteRows = SUITES.map(([key, label]) => {
  const rows = measured.filter(r => r.suite === key);
  const ok = rows.filter(r => r.pass).length;
  const [low, high] = wilson(ok, rows.length);
  const everyTask = [...tasks.values()].filter(task => task.suite === key);
  const always = everyTask.filter(task => chipClass(task.runs) === 'pass').length;
  return `<tr><td>${label}</td><td class="num">${ok} / ${rows.length}</td><td class="num">${low.toFixed(2)}–${high.toFixed(2)}</td><td class="num">${always} / ${everyTask.length}</td></tr>`;
}).join('\n        ');

const grids = SUITES.map(([key, label]) => {
  const chips = [...tasks.entries()]
    .filter(([, task]) => task.suite === key)
    .map(([id, task]) => `<div class="chip ${chipClass(task.runs)}" title="${escape(task.title)}: ${task.runs.join(', ')}">${id}</div>`)
    .join('');
  return `<div class="suite-label">${label}</div><div class="grid">${chips}</div>`;
}).join('\n    ');

const sum = key => summary.results.reduce((total, r) => total + (r.metrics?.[key] ?? 0), 0);
const tokens = summary.results.reduce((total, r) => total + (r.metrics?.tokens?.input ?? 0), 0);
const taskSeconds = summary.results.reduce((total, r) => total + (r.seconds ?? 0), 0);
const medianSeconds = measured.map(r => r.seconds).sort((a, b) => a - b)[Math.floor(measured.length / 2)];

const section = `<section>
    <div class="eyebrow">Final full run · build ${escape(summary.gitSha)} · every task twice</div>
    <h2>${measured.length} measured attempts across 106 tasks</h2>
    <div class="verdict"><div><b>${passed} / ${measured.length}</b><span>attempts passed (${pct(passed / measured.length)})</span></div><div><b>${ci[0].toFixed(2)}–${ci[1].toFixed(2)}</b><span>95% Wilson interval</span></div><div><b>${sum('secretLeaks')}</b><span>secrets in logs or events</span></div><div><b>${medianSeconds} s</b><span>median task</span></div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Suite</th><th>Attempts passed</th><th>95% CI</th><th>Tasks passing every attempt</th></tr></thead>
      <tbody>
        ${suiteRows}
      </tbody>
    </table></div>
    ${grids}
    <div class="legend"><span><span class="pill pass">pass</span> every attempt that ran</span><span><span class="pill warn">split</span> one attempt of two</span><span><span class="pill fail">fail</span> every attempt</span></div>
    <p>${summary.results.length - measured.length} attempts were not measured: ${summary.results.filter(r => r.outcome === 'skipped_budget').length} repeats were skipped when the run reached its ${(8).toString()}M-token cap, and one ended when the harness's access token expired. The run used ${(tokens / 1e6).toFixed(2)}M input tokens and ${sum('llmCalls').toLocaleString('en')} model calls (estimated $${sum('costUsd').toFixed(2)}); ${Math.round((sum('backoffMs') / 1000 / taskSeconds) * 100)}% of task time went to waiting out ${sum('rateLimited')} rate-limit errors.</p>
  </section>`;

const page = fs.readFileSync(PAGE, 'utf8');
if (!page.includes(MARK)) throw new Error(`${MARK} not found in ${PAGE}`);
fs.writeFileSync(PAGE, page.replace(MARK, section));
console.log(`final-run section filled: ${passed}/${measured.length}, CI ${ci.join('–')}`);

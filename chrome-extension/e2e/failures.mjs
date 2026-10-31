// What a round is lacking, read from its own files: for every task that did not pass, why.
//
//   node e2e/failures.mjs [resultsDir]        # default: the newest folder in e2e/results
//
// Prints one block per failed task (outcome, the checker's detail, the answer, how far it got, the guards that refused
// it, and the last failure messages the model was handed), then the patterns across all of them: which guard refused
// most, which failure message recurred, which tool was the last thing tried. The patterns are the point. One failed task
// is an anecdote; the same message in six of them is a lead.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RESULTS = path.join(HERE, 'results');
const dir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(RESULTS, fs.readdirSync(RESULTS).filter(n => fs.existsSync(path.join(RESULTS, n, 'summary.json'))).sort().at(-1) ?? '');
const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));

const norm = text => String(text).replace(/\[\d+\]/g, '[N]').replace(/\d+/g, 'N').replace(/https?:\/\/\S+/g, 'URL').replace(/"[^"]{0,60}"/g, '"…"').trim().slice(0, 110);
const lines = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);

const failed = summary.results.filter(r => !r.pass && !['site_down', 'site_blocked', 'provider_down', 'skipped_budget'].includes(r.outcome));
const counts = { messages: {}, guards: {}, lastTool: {} };
const bump = (map, key, task) => ((map[key] ??= new Set()).add(task), map);

console.log(`${path.basename(dir)}  ${summary.model}  ${summary.results.length} attempts, ${summary.results.filter(r => r.pass).length} passed, ${failed.length} failed\n`);

for (const r of failed) {
  const events = lines(path.join(dir, `${r.attempt}.events.jsonl`));
  const trace = lines(path.join(dir, `${r.attempt}.trace.jsonl`));
  const fails = events.filter(e => e.state === 'act.fail' && e.data?.details).map(e => String(e.data.details));
  const guards = {};
  for (const t of trace.filter(t => t.component === 'Guard' && t.data?.verdict === 'refused')) guards[t.data.guard] = (guards[t.data.guard] ?? 0) + 1;
  const actions = trace.filter(t => t.component === 'NavigatorAgent' && String(t.msg).startsWith('action ')).map(t => String(t.msg).slice(7));

  for (const m of new Set(fails.map(norm))) bump(counts.messages, m, r.id);
  for (const g of Object.keys(guards)) bump(counts.guards, g, r.id);
  if (actions.length) bump(counts.lastTool, actions.at(-1), r.id);

  console.log(`── ${r.id}  ${r.title}`);
  console.log(`   outcome ${r.outcome}, ${r.steps ?? '?'} steps, ${r.seconds ?? '?'}s, ${r.metrics?.llmCalls ?? '?'} model calls`);
  console.log(`   check   ${String(r.detail ?? '').slice(0, 200)}`);
  if (r.answer) console.log(`   answer  ${String(r.answer).replace(/\s+/g, ' ').slice(0, 200)}`);
  if (Object.keys(guards).length) console.log(`   guards  ${Object.entries(guards).map(([g, n]) => `${g}×${n}`).join(', ')}`);
  for (const f of fails.slice(-3)) console.log(`   failed  ${f.replace(/\s+/g, ' ').slice(0, 170)}`);
  console.log('');
}

const table = (title, map) => {
  const rows = Object.entries(map).sort((a, b) => b[1].size - a[1].size).slice(0, 8);
  if (!rows.length) return;
  console.log(`${title}`);
  for (const [k, tasks] of rows) console.log(`  ${String(tasks.size).padStart(3)} tasks  ${k}   [${[...tasks].slice(0, 6).join(' ')}]`);
  console.log('');
};
console.log('════ patterns across the failed tasks ════\n');
table('failure messages the model was handed, by tasks affected', counts.messages);
table('guards that refused, by tasks affected', counts.guards);
table('the last tool tried before the task ended', counts.lastTool);

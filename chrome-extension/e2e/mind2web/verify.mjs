// Checks that an Online-Mind2Web run folder is complete end to end; safe to run while the run is going:
//   node e2e/mind2web/verify.mjs <runDir>
// Every task has a final result; every task the agent ran has its events, a trace with model-call sessions, a timeline,
// screenshots and the provider's numbers; every final result is judged with the outcome it has now. Exits 1 while
// anything is missing, listing what and for which tasks.
import fs from 'node:fs';
import path from 'node:path';

const runDir = path.resolve(process.argv[2] ?? '.');
const tasks = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'Online_Mind2Web.json'), 'utf8'));
let judgments = {};
try {
  judgments = JSON.parse(fs.readFileSync(path.join(runDir, 'judgments.json'), 'utf8')).tasks;
} catch {
  // not judged yet
}
const NOT_RUN = new Set(['site_down', 'site_blocked']);
const AGAIN = new Set(['harness_error', 'provider_down']);
const size = file => (fs.existsSync(file) ? fs.statSync(file).size : 0);
const problems = {};
const add = (kind, id) => (problems[kind] ??= []).push(id.slice(0, 8));

let final = 0;
for (const { task_id: id } of tasks) {
  const dir = path.join(runDir, id);
  let result;
  try {
    result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  } catch {
    add('no final result yet', id);
    continue;
  }
  if (AGAIN.has(result.outcome)) {
    add(`runs again (${result.outcome})`, id);
    continue;
  }
  final++;
  // A site that refused access while the agent worked still has the agent's logs.
  if (!NOT_RUN.has(result.outcome) || result.agentOutcome) {
    if (!size(path.join(dir, 'events.jsonl'))) add('no events.jsonl', id);
    const trace = size(path.join(dir, 'trace.jsonl')) ? fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8') : '';
    if (!trace) add('no trace.jsonl', id);
    else if (!trace.includes('"kind":"session"')) add('trace without model-call sessions', id);
    if (!size(path.join(dir, 'timeline.txt'))) add('no timeline.txt', id);
    if ((result.steps ?? 0) > 0 && !(result.screenshots ?? []).length) add('steps but no screenshots', id);
    if (!result.provider) add('no provider numbers', id);
  }
  const judged = judgments[id];
  if (!judged || judged.error) add('not judged yet', id);
  else if ((judged.excluded ?? judged.agentOutcome) !== result.outcome) add('judged before its outcome changed', id);
}

console.log(`${final}/${tasks.length} tasks with a final result`);
for (const [kind, ids] of Object.entries(problems)) console.log(`${kind}: ${ids.length}${ids.length <= 15 ? ` (${ids.join(', ')})` : ''}`);
if (Object.keys(problems).length === 0) console.log('complete: every task final, logged and judged');
process.exitCode = Object.keys(problems).length ? 1 : 0;

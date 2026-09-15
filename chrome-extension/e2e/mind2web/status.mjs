// A short status of an Online-Mind2Web run folder, safe to run while it is going:
//   node e2e/mind2web/status.mjs <runDir>
// Tasks with a result, outcomes, what the model provider returned, retries, tasks in progress, judged so far, and an ETA.
import fs from 'node:fs';
import path from 'node:path';

const runDir = path.resolve(process.argv[2] ?? '.');
const tasks = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'Online_Mind2Web.json'), 'utf8'));
const read = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const outcomes = {};
const vertex = { calls: 0, failed: 0, rateLimited: 0, serverError: 0, network: 0, auth: 0, rateLimitWaitMs: 0 };
const running = [];
let done = 0;
for (const task of tasks) {
  const dir = path.join(runDir, task.task_id);
  const result = read(path.join(dir, 'result.json'));
  if (!result) {
    // A folder untouched for longer than a task may run was left by a stopped worker; it runs again later.
    const idle = fs.existsSync(dir) ? Math.round((Date.now() - fs.statSync(path.join(dir, 'trajectory')).mtimeMs) / 1000) : Infinity;
    if (idle < 1500) running.push(`${task.task_id.slice(0, 8)} ${idle}s since last screenshot`);
    continue;
  }
  outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
  if (!['harness_error', 'provider_down'].includes(result.outcome)) done++;
  for (const key of Object.keys(vertex)) vertex[key] += result.provider?.[key] ?? 0;
}

const attempts = (fs.existsSync(path.join(runDir, 'attempts.jsonl')) ? fs.readFileSync(path.join(runDir, 'attempts.jsonl'), 'utf8') : '')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line));
const retried = attempts.filter(a => ['harness_error', 'provider_down'].includes(a.outcome)).length;
const judged = Object.keys(read(path.join(runDir, 'judgments.json'))?.tasks ?? {}).length;

let eta = '';
if (attempts.length >= 5) {
  const first = Date.parse(attempts[0].at);
  const last = Date.parse(attempts.at(-1).at);
  const perTask = (last - first) / (attempts.length - 1);
  if (perTask > 0) eta = `, about ${Math.round(((tasks.length - done) * perTask) / 60_000)} min left at the recent pace`;
}

console.log(`${new Date().toISOString()} ${done}/${tasks.length} tasks final${eta}`);
console.log(`outcomes ${JSON.stringify(outcomes)}`);
console.log(
  `vertex: ${vertex.calls} calls, ${vertex.failed} failed (429 ${vertex.rateLimited}, 5xx ${vertex.serverError}, network ${vertex.network}, auth ${vertex.auth}), rate-limit wait ${Math.round(vertex.rateLimitWaitMs / 1000)}s; ${attempts.length} attempts, ${retried} to run again`,
);
console.log(`judged ${judged}; in progress: ${running.join('; ') || 'none'}`);

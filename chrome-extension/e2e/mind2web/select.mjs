// Picks the tasks a fix round re-runs, from a judged and analyzed baseline folder (run analyze.mjs on it first):
//   node e2e/mind2web/select.mjs <baselineDir> [--successes 10] [--seed 1]
// Prints comma-separated task ids for ONLY=... and a summary on stderr:
// - every task the agent did not finish, and every finished task judged a failure;
// - mediocre successes: repeated the same action 3+ times, or took more than twice the median steps;
// - a seeded random sample of the remaining successes, so a round also shows whether anything that worked broke.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: opts, positionals } = parseArgs({ allowPositionals: true, options: { successes: { type: 'string', default: '10' }, seed: { type: 'string', default: '1' } } });
const runDir = path.resolve(positionals[0] ?? '');
const analysis = JSON.parse(fs.readFileSync(path.join(runDir, 'analysis.json'), 'utf8'));
const rows = analysis.rows;

const medianSteps = analysis.medians?.steps || 0;
const failed = rows.filter(row => row.status === 'agent did not finish' || row.status === 'finished, judged a failure');
const successes = rows.filter(row => row.status === 'success');
const mediocre = successes.filter(row => (row.repeatedActions ?? []).length > 0 || (medianSteps && row.steps > 2 * medianSteps));
const clean = successes.filter(row => !mediocre.includes(row));

// Mulberry32: a small seeded generator, so a round's sample can be drawn again.
let state = Number(opts.seed) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const sample = [...clean]
  .map(row => ({ row, key: random() }))
  .sort((a, b) => a.key - b.key)
  .slice(0, Number(opts.successes))
  .map(({ row }) => row);

const picked = [...failed, ...mediocre, ...sample];
console.error(`${path.basename(runDir)}: ${failed.length} failed, ${mediocre.length} mediocre successes, ${sample.length} of ${clean.length} clean successes (seed ${opts.seed}) -> ${picked.length} tasks`);
console.log(picked.map(row => row.task_id).join(','));

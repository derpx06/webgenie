// Draws the stratified Online-Mind2Web slice (slice.json) from the dataset file.
//
//   node e2e/mind2web/make-slice.mjs [--in e2e/mind2web/Online_Mind2Web.json] [--out e2e/mind2web/slice.json]
//
// Fixed seed and quotas: the same input file always gives the same slice. Tasks are sorted by task_id before the
// seeded shuffle, so the file's row order does not matter; a dataset update that replaces tasks can change the draw,
// which is why the input's sha256 is recorded in the output.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const SEED = 20260913;
// 60 tasks, roughly the dataset's easy/medium/hard proportions. The scarcest level draws first, so it gets first pick
// of websites under the one-task-per-website rule.
const QUOTA = { hard: 14, easy: 17, medium: 29 };

const HERE = import.meta.dirname;
const { values: opts } = parseArgs({
  options: {
    in: { type: 'string', default: path.join(HERE, 'Online_Mind2Web.json') },
    out: { type: 'string', default: path.join(HERE, 'slice.json') },
  },
});

/** mulberry32: a small seeded PRNG, uniform on [0, 1). */
function prng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const raw = fs.readFileSync(opts.in);
const tasks = JSON.parse(raw);
for (const t of tasks) {
  for (const field of ['task_id', 'confirmed_task', 'website', 'level']) {
    if (!t[field]) throw new Error(`task ${t.task_id ?? '?'} has no ${field}; is ${opts.in} the Online-Mind2Web dataset file?`);
  }
}

const pool = [...tasks].sort((a, b) => a.task_id.localeCompare(b.task_id));
const random = prng(SEED);
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}

const site = t => new URL(t.website).hostname.toLowerCase().replace(/^www\./, '');
const usedSites = new Set();
const slice = [];
for (const [level, quota] of Object.entries(QUOTA)) {
  let taken = 0;
  for (const t of pool) {
    if (taken === quota) break;
    if (t.level !== level || usedSites.has(site(t))) continue;
    usedSites.add(site(t));
    slice.push({ task_id: t.task_id, website: t.website, confirmed_task: t.confirmed_task, level: t.level, reference_length: t.reference_length ?? null });
    taken++;
  }
  if (taken < quota) throw new Error(`only ${taken} ${level} tasks on unused websites (need ${quota})`);
}

const counts = Object.fromEntries(Object.keys(QUOTA).map(level => [level, slice.filter(t => t.level === level).length]));
const out = {
  source: 'osunlp/Online-Mind2Web (Hugging Face), CC-BY 4.0',
  sourceFile: path.basename(opts.in),
  sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  sourceTasks: tasks.length,
  seed: SEED,
  counts,
  websites: usedSites.size,
  tasks: slice,
};
fs.writeFileSync(opts.out, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${slice.length} tasks (${Object.entries(counts).map(([l, n]) => `${l} ${n}`).join(', ')}) on ${usedSites.size} websites -> ${opts.out}`);

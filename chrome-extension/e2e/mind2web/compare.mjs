// Compares an Online-Mind2Web round against its baseline, task by task, so a fix is kept only when the agent improves
// and nothing that worked before breaks:
//   node e2e/mind2web/compare.mjs <baselineDir> <roundDir>
// For every task with a result in the round folder: the judged verdict before and after (success, failure, or not
// comparable: not measurable, runs again, not judged), steps and input tokens. Prints improvements, regressions and
// totals over tasks judged in both folders, and the median steps and tokens of tasks that succeeded in both.
// Exit code 1 when any task regressed (succeeded in the baseline, judged a failure in the round).
import fs from 'node:fs';
import path from 'node:path';

const [baseDir, roundDir] = process.argv.slice(2).map(dir => path.resolve(dir));
if (!baseDir || !roundDir) {
  console.error('usage: node e2e/mind2web/compare.mjs <baselineDir> <roundDir>');
  process.exit(2);
}
const read = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const judgmentsOf = dir => read(path.join(dir, 'judgments.json'))?.tasks ?? {};
const judged = { base: judgmentsOf(baseDir), round: judgmentsOf(roundDir) };
// Verdicts from different judges are not comparable: refuse rather than report changes the judge made.
const judgeOf = dir => {
  const file = read(path.join(dir, 'judgments.json'));
  return file ? `${file.judgeModel} / ${file.imageModel ?? file.judgeModel} / threshold ${file.threshold}` : null;
};
if (judgeOf(baseDir) && judgeOf(roundDir) && judgeOf(baseDir) !== judgeOf(roundDir)) {
  console.error(`different judges: baseline ${judgeOf(baseDir)}, round ${judgeOf(roundDir)}; judge both the same way first`);
  process.exit(2);
}

/** A task's result in a folder: 1 judged success, 0 judged failure, null not comparable; with the numbers behind it. */
function stateOf(dir, judgments, id) {
  const result = read(path.join(dir, id, 'result.json'));
  if (!result) return null;
  const verdict = judgments[id];
  const score =
    ['site_down', 'site_blocked', 'provider_down', 'harness_error'].includes(result.outcome) || !verdict || verdict.error || verdict.excluded
      ? null
      : verdict.success
        ? 1
        : 0;
  return { score, outcome: result.outcome, steps: result.steps ?? 0, tokens: result.metrics?.tokens?.input ?? 0, build: result.build ?? null };
}

const label = state => (!state ? 'no result' : state.score === 1 ? 'success' : state.score === 0 ? `failure (${state.outcome})` : `not comparable (${state.outcome})`);
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

const ids = fs
  .readdirSync(roundDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(roundDir, entry.name, 'result.json')))
  .map(entry => entry.name)
  .sort();

const improved = [];
const regressed = [];
const bothOk = [];
let comparable = 0;
let baseSuccess = 0;
let roundSuccess = 0;
for (const id of ids) {
  const before = stateOf(baseDir, judged.base, id);
  const after = stateOf(roundDir, judged.round, id);
  if (before?.score == null || after?.score == null) continue;
  comparable++;
  baseSuccess += before.score;
  roundSuccess += after.score;
  const line = `${id.slice(0, 12)}: ${label(before)} -> ${label(after)} (steps ${before.steps} -> ${after.steps}, tokens ${before.tokens} -> ${after.tokens})`;
  if (after.score > before.score) improved.push(line);
  if (after.score < before.score) regressed.push(line);
  if (before.score === 1 && after.score === 1) bothOk.push({ before, after });
}

const builds = [...new Set(ids.map(id => stateOf(roundDir, judged.round, id)?.build).filter(Boolean))];
console.log(`round ${path.basename(roundDir)} (build ${builds.join(', ') || 'unknown'}) against ${path.basename(baseDir)}`);
console.log(`${ids.length} tasks in the round, ${comparable} judged in both: ${baseSuccess} -> ${roundSuccess} successes (${roundSuccess - baseSuccess >= 0 ? '+' : ''}${roundSuccess - baseSuccess})`);
console.log(`improved ${improved.length}, regressed ${regressed.length}, not comparable ${ids.length - comparable}`);
if (bothOk.length) {
  console.log(
    `tasks that succeeded in both (${bothOk.length}): median steps ${median(bothOk.map(t => t.before.steps))} -> ${median(bothOk.map(t => t.after.steps))}, median input tokens ${median(bothOk.map(t => t.before.tokens))} -> ${median(bothOk.map(t => t.after.tokens))}`,
  );
}
if (improved.length) console.log(`\nimproved:\n${improved.join('\n')}`);
if (regressed.length) console.log(`\nREGRESSED:\n${regressed.join('\n')}`);
process.exitCode = regressed.length ? 1 : 0;

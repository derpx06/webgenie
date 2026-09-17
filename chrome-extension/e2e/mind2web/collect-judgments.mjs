// Collects per-task judgments written by a reading judge into <runDir>/judgments.json, the file compare.mjs,
// analyze.mjs and verify.mjs read:
//
//   node e2e/mind2web/collect-judgments.mjs <runDir> [--judge "<name of the judge>"]
//
// Input: <runDir>/<task_id>/judgment-claude.json, written by a judge that read the task's result.json, timeline.txt and
// the screenshots in trajectory/ and applied the WebJudge rules (chrome-extension/e2e/mind2web/JUDGING.md):
//   { task_id, key_points: [...], success, blocked, reasoning, evidence: [...], confidence }
// Tasks whose site refused access (blocked), and the outcomes judge.mjs leaves out, are excluded from the rate, as in
// judge.mjs, so a folder judged this way and one judged by judge.mjs carry the same shape and the same exclusions.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { wilson } from '../metrics.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { judge: { type: 'string', default: 'reading judge (traces and screenshots)' } },
});
const runDir = path.resolve(positionals[0] ?? '');
if (!positionals[0] || !fs.existsSync(runDir)) {
  console.error('usage: node e2e/mind2web/collect-judgments.mjs <runDir> [--judge name]');
  process.exit(2);
}

const EXCLUDED_OUTCOMES = new Set(['site_down', 'site_blocked', 'harness_error', 'provider_down']);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const tasks = {};
const missing = [];
for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(runDir, entry.name);
  const resultFile = path.join(dir, 'result.json');
  if (!fs.existsSync(resultFile)) continue;
  const result = read(resultFile);
  if (EXCLUDED_OUTCOMES.has(result.outcome)) {
    tasks[entry.name] = { level: result.level, excluded: result.outcome };
    continue;
  }
  const judgmentFile = path.join(dir, 'judgment-claude.json');
  if (!fs.existsSync(judgmentFile)) {
    missing.push(entry.name);
    continue;
  }
  const judgment = read(judgmentFile);
  tasks[entry.name] = judgment.blocked
    ? { level: result.level, agentOutcome: result.outcome, excluded: 'site_blocked', reasoning: judgment.reasoning }
    : {
        level: result.level,
        agentOutcome: result.outcome,
        success: judgment.success === true,
        keyPoints: (judgment.key_points ?? []).join('\n'),
        reasoning: judgment.reasoning ?? '',
        evidence: judgment.evidence ?? [],
        confidence: judgment.confidence ?? null,
      };
}

const rows = Object.entries(tasks).map(([task_id, task]) => ({ task_id, ...task }));
const judged = rows.filter(task => !task.excluded);
const stats = list => {
  const won = list.filter(task => task.success).length;
  return { n: list.length, success: won, rate: list.length ? +(won / list.length).toFixed(3) : null, ci95: wilson(won, list.length) };
};
const summary = {
  overall: stats(judged),
  byLevel: Object.fromEntries(['easy', 'medium', 'hard'].map(level => [level, stats(judged.filter(task => task.level === level))])),
  excluded: rows.filter(task => task.excluded).map(task => `${task.task_id} (${task.excluded})`),
  errors: [],
};

fs.writeFileSync(
  path.join(runDir, 'judgments.json'),
  `${JSON.stringify(
    {
      indicative: true,
      note: 'Judged by reading each task’s trace and screenshots against the WebJudge rules, not by the paper’s o4-mini; rates are not comparable to the leaderboard. Every round compared must be judged the same way.',
      judgeModel: opts.judge,
      imageModel: opts.judge,
      threshold: null,
      judgedAt: new Date().toISOString(),
      summary,
      tasks,
    },
    null,
    2,
  )}\n`,
);

console.table({ overall: summary.overall, ...summary.byLevel });
if (summary.excluded.length) console.log(`excluded: ${summary.excluded.join(', ')}`);
if (missing.length) console.log(`no judgment yet (${missing.length}): ${missing.join(', ')}`);
console.log(`${path.join(runDir, 'judgments.json')}`);

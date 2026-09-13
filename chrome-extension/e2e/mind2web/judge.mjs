// WebJudge (Online-Mind2Web, Xue et al. 2025) in Node, over Vertex AI Gemini. Results are INDICATIVE: the benchmark's
// judge is o4-mini, so success rates from a Gemini judge are not comparable to the leaderboard.
//
//   node e2e/mind2web/judge.mjs <runDir> [--model gemini-2.5-pro] [--fallback-model gemini-2.5-flash]
//        [--limit N] [--concurrency 2] [--threshold 3] [--project <id>] [--location us-central1] [--dry-run]
//
// Input: <runDir>/<task_id>/result.json ({ task, level, outcome, action_history, screenshots }) and the screenshots in
// <runDir>/<task_id>/trajectory/. Output: <runDir>/judgments.json, written after every task; a re-run judges only the
// tasks not judged yet (or that errored). --dry-run makes no API call and needs no credentials: it prints each
// request's payload size, answers with canned text, and writes judgments.dry-run.json.
//
// The three stages and their prompts follow src/methods/webjudge_online_mind2web.py in OSU-NLP-Group/Online-Mind2Web:
// key points from the task text, a 1-5 relevance score per screenshot, then an outcome call with the action history
// and the screenshots that scored >= threshold (at most 50). The agent's final answer is not shown to the judge,
// as upstream (it may be hallucinated).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { wilson } from '../metrics.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: 'string', default: 'gemini-2.5-pro' },
    'fallback-model': { type: 'string', default: 'gemini-2.5-flash' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    threshold: { type: 'string', default: '3' },
    project: { type: 'string', default: process.env.E2E_PROJECT },
    location: { type: 'string', default: process.env.E2E_LOCATION ?? 'global' },
    // Vertex AI rejects oversized requests; the outcome call drops its lowest-scored screenshots to stay under this.
    'max-request-mb': { type: 'string', default: '18' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const runDir = positionals[0];
if (!runDir || !fs.existsSync(runDir)) {
  console.error('usage: node e2e/mind2web/judge.mjs <runDir> [--model m] [--limit n] [--concurrency 2] [--dry-run]');
  process.exit(2);
}
const DRY = opts['dry-run'];
const CONCURRENCY = Math.max(1, Number(opts.concurrency));
const THRESHOLD = Number(opts.threshold);
const MAX_IMAGE = 50;
const EXCLUDED_OUTCOMES = new Set(['site_down', 'harness_error']);

const KEY_POINTS_SYSTEM = `You are an expert tasked with analyzing a given task to identify the key points explicitly stated in the task description.

**Objective**: Carefully analyze the task description and extract the critical elements explicitly mentioned in the task for achieving its goal.

**Instructions**:
1. Read the task description carefully.
2. Identify and extract **key points** directly stated in the task description.
   - A **key point** is a critical element, condition, or step explicitly mentioned in the task description.
   - Do not infer or add any unstated elements.
   - Words such as "best," "highest," "cheapest," "latest," "most recent," "lowest," "closest," "highest-rated," "largest," and "newest" must go through the sort function(e.g., the key point should be "Filter by highest").

**Respond with**:
- **Key Points**: A numbered list of the explicit key points for completing this task, one per line, without explanations or additional details.`;

const IMAGE_SYSTEM = `You are an expert evaluator tasked with determining whether an image contains information about the necessary steps to complete a task.

**Objective**: Analyze the provided image and decide if it shows essential steps or evidence required for completing the task. Use your reasoning to explain your decision before assigning a score.

**Instructions**:
1. Provide a detailed description of the image, including its contents, visible elements, text (if any), and any notable features.

2. Carefully examine the image and evaluate whether it contains necessary steps or evidence crucial to task completion:
- Identify key points that could be relevant to task completion, such as actions, progress indicators, tool usage, applied filters, or step-by-step instructions.
- Does the image show actions, progress indicators, or critical information directly related to completing the task?
- Is this information indispensable for understanding or ensuring task success?
- If the image contains partial but relevant information, consider its usefulness rather than dismissing it outright.

3. Provide your response in the following format:
- **Reasoning**: Explain your thought process and observations. Mention specific elements in the image that indicate necessary steps, evidence, or lack thereof.
- **Score**: Assign a score based on the reasoning, using the following scale:
    - **1**: The image does not contain any necessary steps or relevant information.
    - **2**: The image contains minimal or ambiguous information, unlikely to be essential.
    - **3**: The image includes some relevant steps or hints but lacks clarity or completeness.
    - **4**: The image contains important steps or evidence that are highly relevant but not fully comprehensive.
    - **5**: The image clearly displays necessary steps or evidence crucial for completing the task.

Respond with:
1. **Reasoning**: [Your explanation]
2. **Score**: [1-5]`;

const OUTCOME_SYSTEM = `You are an expert in evaluating the performance of a web navigation agent. The agent is designed to help a human user navigate a website to complete a task. Given the user's task, the agent's action history, key points for task completion, some potentially important web pages in the agent's trajectory and their reasons, your goal is to determine whether the agent has completed the task and achieved all requirements.

Your response must strictly follow the following evaluation criteria!
*Important Evaluation Criteria*:
1: The filtered results must be displayed correctly. If filters were not properly applied (i.e., missing selection, missing confirmation, or no visible effect in results), the task is not considered successful.
2: You must carefully check whether these snapshots and action history meet these key points. Ensure that specific filter conditions, such as "best," "highest," "cheapest," "latest," "most recent," "lowest," "closest," "highest-rated," "largest," and "newest" are correctly applied using the filter function(e.g., sort function).
3: Certain key points or requirements should be applied by the filter. Otherwise, a search with all requirements as input will be deemed a failure since it cannot guarantee that all results meet the requirements!
4: If the task requires filtering by a specific range of money, years, or the number of beds and bathrooms, the applied filter must exactly match the given requirement. Any deviation results in failure. To ensure the task is successful, the applied filter must precisely match the specified range without being too broad or too narrow.
Examples of Failure Cases:
- If the requirement is less than $50, but the applied filter is less than $25, it is a failure.
- If the requirement is $1500-$2500, but the applied filter is $2000-$2500, it is a failure.
- If the requirement is $25-$200, but the applied filter is $0-$200, it is a failure.
- If the required years are 2004-2012, but the filter applied is 2001-2012, it is a failure.
- If the required years are before 2015, but the applied filter is 2000-2014, it is a failure.
- If the task requires exactly 2 beds, but the filter applied is 2+ beds, it is a failure.
5: Some tasks require a submission action or a display of results to be considered successful.
6: If the retrieved information is invalid or empty(e.g., No match was found), but the agent has correctly performed the required action, it should still be considered successful.
7: If the current page already displays all available items, then applying a filter is not necessary. As long as the agent selects items that meet the requirements (e.g., the cheapest or lowest price), the task is still considered successful.

*IMPORTANT*
Format your response into two lines as shown below:

Thoughts: <your thoughts and reasoning process based on double-checking each key points and the evaluation criteria>
Status: "success" or "failure"
`;

const CANNED = {
  key_points: '**Key Points**:\n1. dry-run key point',
  image: '**Reasoning**: dry-run description.\n\n**Score**: 4',
  outcome: 'Thoughts: dry-run.\nStatus: "failure"',
};

// Parsing mirrors the upstream Python, quirks included.
function parseKeyPoints(response) {
  const text = response.replaceAll('\n\n', '\n');
  const list = text.includes('**Key Points**:') ? text.split('**Key Points**:')[1] : text.split('Key Points:').at(-1);
  return list
    .split('\n')
    .map(line => line.trimStart())
    .join('\n');
}

function parseImage(response) {
  const scoreText = response.split('Score')[1];
  const digit = scoreText === undefined ? null : /[1-5]/.exec(scoreText);
  if (!digit) return { score: 0, thought: '' };
  const thought = response.split('**Reasoning**:').at(-1).trim().split('\n\n')[0].replaceAll('\n', ' ');
  return { score: Number(digit[0]), thought };
}

const parseOutcome = response => (response.toLowerCase().split('status:')[1] ?? '').includes('success');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const gcloud = (...args) => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let model = opts.model;
let project = opts.project;
let token = null;
let tokenAt = 0;
/** The bearer token lives only in memory: never printed, logged or written. */
function accessToken(refresh = false) {
  if (refresh || !token || Date.now() - tokenAt > 45 * 60_000) {
    token = gcloud('auth', 'print-access-token');
    tokenAt = Date.now();
  }
  return token;
}

let active = 0;
const waiting = [];
async function limited(fn) {
  while (active >= CONCURRENCY) await new Promise(resolve => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** One generateContent call; the body is built inside the concurrency slot so pending calls hold no image data. */
function generate(stage, system, text, images = []) {
  return limited(async () => {
    const parts = [{ text }];
    for (const file of images) {
      parts.push({ inlineData: { mimeType: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });
    }
    const body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { temperature: 0 } });
    if (DRY) {
      console.log(`  [dry-run] ${stage}: ${images.length} image(s), payload ${(Buffer.byteLength(body) / 1e6).toFixed(3)} MB`);
      return CANNED[stage];
    }
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const host = opts.location === 'global' ? 'aiplatform.googleapis.com' : `${opts.location}-aiplatform.googleapis.com`;
      const url = `https://${host}/v1/projects/${project}/locations/${opts.location}/publishers/google/models/${model}:generateContent`;
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken()}`, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(300_000),
        });
      } catch (error) {
        if (attempt >= 5) throw error;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        const json = await response.json();
        return (json.candidates?.[0]?.content?.parts ?? [])
          .filter(part => !part.thought)
          .map(part => part.text ?? '')
          .join('');
      }
      const detail = (await response.text()).slice(0, 300);
      if (response.status === 404 && model !== opts['fallback-model']) {
        console.log(`judge model ${model} unavailable (404); falling back to ${opts['fallback-model']}`);
        model = opts['fallback-model'];
        continue;
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        accessToken(true);
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 8) {
        const wait = Number(response.headers.get('retry-after')) * 1000 || Math.min(60_000, 2000 * 2 ** attempt) * (0.5 + Math.random());
        console.log(`  ${response.status} on ${stage}; retrying in ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        continue;
      }
      throw new Error(`Vertex AI ${response.status} on ${stage}: ${detail}`);
    }
  });
}

async function judgeTask(taskId) {
  const dir = path.join(runDir, taskId);
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  if (EXCLUDED_OUTCOMES.has(result.outcome)) return { level: result.level, excluded: result.outcome };
  const shotDir = path.join(dir, 'trajectory');
  const names = result.screenshots?.length
    ? result.screenshots
    : fs.existsSync(shotDir)
      ? fs
          .readdirSync(shotDir)
          .filter(name => /\.(png|jpe?g)$/i.test(name))
          .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))
      : [];
  const shots = names.map(name => path.join(shotDir, name));

  const keyPoints = parseKeyPoints(await generate('key_points', KEY_POINTS_SYSTEM, `Task: ${result.task}`));
  const imagePrompt = `**Task**: ${result.task}\n\n**Key Points for Task Completion**: ${keyPoints}\n\nThe snapshot of the web page is shown in the image.`;
  const scored = await Promise.all(shots.map(async file => ({ file, ...parseImage(await generate('image', IMAGE_SYSTEM, imagePrompt, [file])) })));

  const kept = scored.filter(image => image.score >= THRESHOLD).slice(0, MAX_IMAGE);
  // Not upstream: a request over the size budget would be rejected, so drop the lowest-scored (earliest on ties) first.
  const budget = Number(opts['max-request-mb']) * 1e6;
  const size = rows => rows.reduce((n, image) => n + (fs.statSync(image.file).size * 4) / 3, 0);
  const droppedForSize = [];
  while (kept.length && size(kept) > budget) {
    const worst = kept.reduce((a, b) => (b.score < a.score ? b : a));
    kept.splice(kept.indexOf(worst), 1);
    droppedForSize.push(path.basename(worst.file));
  }

  const actions = (result.action_history ?? []).map((step, i) => `${i + 1}. ${typeof step === 'string' ? step : step.action}`).join('\n');
  let text = `User Task: ${result.task}\n\nKey Points: ${keyPoints}\n\nAction History:\n${actions}`;
  if (kept.length) {
    const thoughts = kept.map(image => image.thought).filter(Boolean);
    text += `\n\nThe potentially important snapshots of the webpage in the agent's trajectory and their reasons:\n${thoughts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
  }
  const response = await generate(
    'outcome',
    OUTCOME_SYSTEM,
    text,
    kept.map(image => image.file),
  );
  return {
    level: result.level,
    agentOutcome: result.outcome,
    success: parseOutcome(response),
    keyPoints,
    reasoning: response,
    imageScores: scored.map(image => ({ screenshot: path.basename(image.file), score: image.score, thought: image.thought })),
    imagesSent: kept.length,
    droppedForSize,
  };
}

function summarize(tasks) {
  const rows = Object.entries(tasks).map(([task_id, t]) => ({ task_id, ...t }));
  const judged = rows.filter(t => !t.excluded && !t.error);
  const stats = list => {
    const k = list.filter(t => t.success).length;
    return { n: list.length, success: k, rate: list.length ? +(k / list.length).toFixed(3) : null, ci95: wilson(k, list.length) };
  };
  return {
    overall: stats(judged),
    byLevel: Object.fromEntries(['easy', 'medium', 'hard'].map(level => [level, stats(judged.filter(t => t.level === level))])),
    excluded: rows.filter(t => t.excluded).map(t => `${t.task_id} (${t.excluded})`),
    errors: rows.filter(t => t.error).map(t => t.task_id),
  };
}

async function main() {
  if (!DRY) project ??= gcloud('config', 'get-value', 'project');
  const outFile = path.join(runDir, DRY ? 'judgments.dry-run.json' : 'judgments.json');
  const tasks = !DRY && fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')).tasks : {};
  const ids = fs
    .readdirSync(runDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(runDir, entry.name, 'result.json')))
    .map(entry => entry.name)
    .sort();
  const todo = ids.filter(id => !tasks[id] || tasks[id].error).slice(0, opts.limit ? Number(opts.limit) : undefined);
  console.log(`judging ${todo.length} of ${ids.length} tasks with ${model} (concurrency ${CONCURRENCY}, threshold ${THRESHOLD})${DRY ? ' [dry-run]' : ''}`);

  const save = () =>
    fs.writeFileSync(
      outFile,
      `${JSON.stringify(
        {
          indicative: true,
          note: 'WebJudge re-implemented with a Gemini judge; Online-Mind2Web reports WebJudge with o4-mini, so these rates are not comparable to the leaderboard.',
          judgeModel: model,
          requestedModel: opts.model,
          threshold: THRESHOLD,
          judgedAt: new Date().toISOString(),
          summary: summarize(tasks),
          tasks,
        },
        null,
        2,
      )}\n`,
    );

  await Promise.all(
    todo.map(async id => {
      try {
        tasks[id] = await judgeTask(id);
        console.log(`${id}: ${tasks[id].excluded ? `excluded (${tasks[id].excluded})` : tasks[id].success ? 'success' : 'failure'}`);
      } catch (error) {
        tasks[id] = { error: error.message };
        console.log(`${id}: judge error: ${error.message}`);
      }
      save();
    }),
  );
  save();

  const summary = summarize(tasks);
  console.table({ overall: summary.overall, ...summary.byLevel });
  if (summary.excluded.length) console.log(`excluded: ${summary.excluded.join(', ')}`);
  if (summary.errors.length) console.log(`judge errors (re-run to retry): ${summary.errors.join(', ')}`);
  console.log(`INDICATIVE (judge ${model}, not the paper's o4-mini). ${outFile}`);
}

main().catch(error => {
  console.error(`JUDGE FAILED: ${error.message}`);
  process.exitCode = 1;
});

// Runs Online-Mind2Web tasks on the live e2e harness (../run.mjs) and writes each task in WebJudge's input format.
// Scoring is a separate step: node e2e/mind2web/judge.mjs <runDir>.
//
//   pnpm build && node e2e/mind2web/run.mjs [--all] [--limit N] [--only <task_id>,<task_id>] [--level easy|medium|hard]
//   node e2e/mind2web/run.mjs --all --resume e2e/results/mind2web-<timestamp>   (continue an interrupted run)
//   Environment as for ../run.mjs: E2E_MODEL, E2E_PLANNER_MODEL, E2E_PROJECT, E2E_LOCATION, E2E_HEADLESS, CHROMIUM_PATH
//
// Tasks: the 60-task slice (slice.json) by default; --all runs every task in Online_Mind2Web.json. --resume reuses a run
// folder and skips tasks that already have a result, except harness errors and provider outages, which run again.
// Rules: the firewall denies common search engines, so the agent works from the task's website (the benchmark's rule);
// an order/payment confirmation is answered "No, stop here"; any other question is answered "Proceed with any
// reasonable choice." and counted; each task is capped at 25 steps, 600 s and 150k input tokens. After navigator actions
// (act.ok/act.fail) the newest web tab is screenshotted into <task_id>/trajectory/NN.png, at most 40 per task.
// A task that ended because the model provider was unreachable or the access token expired is recorded as provider_down.
// Results: e2e/results/mind2web-<timestamp>/<task_id>/{result.json,trajectory/,events.jsonl,trace.jsonl,timeline.txt}.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { closeSession, launchSession } from '../run.mjs';
import { taskMetrics, timeline } from '../metrics.mjs';

const HERE = import.meta.dirname;
const DIST = path.resolve(HERE, '../../../dist');
const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com', 'search.yahoo.com'];
// 400k input tokens: on real sites a model call reads 7-12k tokens, so 150k stopped tasks near step 13 of 25.
const LIMITS = { maxSteps: 25, maxMs: 600_000, maxInputTokens: 400_000 };
const MAX_SHOTS = 40;
const TASKS_PER_BROWSER = 10;
const DECLINE = 'No, stop here';
const PROCEED = 'Proceed with any reasonable choice.';
/** Outcomes that say nothing about the agent; a resumed run tries these tasks again. */
const RETRY_ON_RESUME = new Set(['harness_error', 'provider_down']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/** true once the promise settles successfully within ms, false on timeout or error. */
const within = (promise, ms) => Promise.race([promise.then(() => true), sleep(ms).then(() => false)]).catch(() => false);

/** The system's own commit confirmation, or a question that asks to confirm an order or a payment. */
const isOrderConfirmation = question =>
  /^Confirm before I continue:/.test(question) ||
  (/\b(confirm|should I|shall I|do you want|proceed)\b/i.test(question) && /\b(order|pay|payment|purchase|checkout|buy|book|reserve|subscribe)/i.test(question));

/** drive() answers scripted questions in order and tests each script's `expect` first; recording the question there
 *  lets one script pick its answer by question. */
function responder() {
  const script = {
    question: '',
    expect: { test: question => ((script.question = question), true) },
    get answer() {
      return isOrderConfirmation(script.question) ? DECLINE : PROCEED;
    },
  };
  return script;
}

/** Page actions only, as WebJudge asks: the done action's text is the agent's answer, not an action. */
function actionHistory(events) {
  const history = [];
  let started = '';
  for (const e of events) {
    if (e.state === 'act.start') started = String(e.data?.details ?? '');
    if (started === 'done') continue;
    if (e.state === 'act.ok') history.push(String(e.data?.details || started));
    if (e.state === 'act.fail') history.push(`${started} -> FAILED: ${e.data?.details ?? ''}`);
  }
  return history;
}

function writeResult(runDir, task, fields) {
  const dir = path.join(runDir, task.task_id);
  fs.mkdirSync(dir, { recursive: true });
  const result = {
    task_id: task.task_id,
    task: task.confirmed_task,
    website: task.website,
    level: task.level,
    reference_length: task.reference_length,
    final_result_response: '',
    action_history: [],
    screenshots: [],
    ...fields,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/** A task's saved result, or null when it has none. */
function savedResult(runDir, task) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, task.task_id, 'result.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function runTask(harness, task, runId, runDir) {
  const taskId = `${runId}-${task.task_id}`;
  const dir = path.join(runDir, task.task_id);
  fs.rmSync(dir, { recursive: true, force: true }); // a retry starts clean
  fs.mkdirSync(path.join(dir, 'trajectory'), { recursive: true });

  await harness.ensureControl();
  const host = new URL(task.website).hostname;
  await harness.clearOrigins([new URL(task.website).origin]);
  await harness.configure(taskId, task.confirmed_task.slice(0, 60), {
    // A task whose own website is on a search engine's domain keeps that domain reachable.
    'firewall-settings': { enabled: true, allowList: [], denyList: SEARCH_ENGINES.filter(domain => host !== domain && !host.endsWith(`.${domain}`)) },
  });
  // Count navigator actions beside drive()'s own listener; a new control page or port gets its own hook.
  await harness.ctl.evaluate(() => {
    window.__acts = 0;
    if (window.__actsPort === window.__port) return;
    window.__actsPort = window.__port;
    window.__port.onMessage.addListener(message => {
      if (message.state === 'act.ok' || message.state === 'act.fail') window.__acts++;
    });
  });

  const web = await harness.browser.newPage();
  const nav = await web.goto(task.website, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(error => error);
  // ponytail: one navigation decides site_down (network error or 5xx); a bot wall that answers 5xx is counted as down too.
  const down = nav instanceof Error ? (/net::ERR_/.test(nav.message) ? nav.message : null) : nav && nav.status() >= 500 ? `HTTP ${nav.status()}` : null;
  if (down) {
    await web.close().catch(() => {});
    return writeResult(runDir, task, { outcome: 'site_down', detail: down });
  }
  await web.bringToFront();
  const tabId = await harness.ctl.evaluate(async href => (await chrome.tabs.query({})).filter(t => t.url === href).at(-1)?.id, web.url());
  if (!tabId) throw new Error(`no tab found for ${web.url()}`);

  const screenshots = [];
  let driving = true;
  const shooter = (async () => {
    let seen = 0;
    for (;;) {
      await sleep(500);
      const stopping = !driving;
      const acts = await harness.ctl.evaluate(() => window.__acts).catch(() => seen);
      if (acts > seen) {
        seen = acts;
        const name = `${String(screenshots.length).padStart(2, '0')}.png`;
        const page = (await harness.webPages()).at(-1);
        if (page && (await within(page.screenshot({ path: path.join(dir, 'trajectory', name) }), 10_000))) screenshots.push(name);
      }
      if (stopping || screenshots.length >= MAX_SHOTS) break;
    }
  })().catch(() => {});

  let run;
  try {
    run = await harness.drive({ taskId, tabId, task: task.confirmed_task, ...LIMITS, allowHuman: false, human: Array(50).fill(responder()), page: web });
  } finally {
    driving = false;
  }
  await shooter;
  await sleep(900); // the trace sink flushes every 500 ms

  const records = await harness.readTraces(taskId).catch(() => []);
  const metrics = taskMetrics(records, run.events, { taskText: task.confirmed_task });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), run.events.map(e => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), records.map(r => JSON.stringify(r)).join('\n'));
  fs.writeFileSync(path.join(dir, 'timeline.txt'), timeline(records, run.events));
  for (const page of await harness.webPages()) await page.close().catch(() => {});

  // The model provider could not be reached, or the access token expired mid-task: not a verdict on the agent.
  const lastCall = records.filter(r => r.kind === 'llm').at(-1);
  const providerDown =
    run.outcome !== 'task.ok' && lastCall && /Failed to fetch|provider unreachable|invalid authentication credentials/i.test(`${lastCall.msg} ${JSON.stringify(lastCall.data?.error ?? '')}`);

  const declined = run.questions.filter(isOrderConfirmation).length;
  return writeResult(runDir, task, {
    final_result_response: run.answer,
    action_history: actionHistory(run.events),
    screenshots,
    outcome: providerDown ? 'provider_down' : run.outcome,
    steps: run.maxStep,
    seconds: run.seconds,
    questions: run.questions,
    questionsDeclined: declined,
    questionsOther: run.questions.length - declined,
    metrics,
  });
}

/** --self-check: the question rules and the action history, without a browser or a model. */
function selfCheck() {
  const assert = (ok, label) => {
    if (!ok) throw new Error(`self-check failed: ${label}`);
  };
  const system = 'Confirm before I continue: "Place order" on shop.example/checkout (amount shown: $40.00). This may place an order, make a payment, or change an account or your data. Should I do it?';
  assert(isOrderConfirmation(system), 'system confirmation');
  assert(isOrderConfirmation('Should I proceed to checkout and pay $12?'), 'navigator payment confirmation');
  assert(!isOrderConfirmation('Which size do you want, M or L?'), 'plain question');
  assert(!isOrderConfirmation('Please provide your username and password to log in.'), 'login question');
  const script = Array(50).fill(responder());
  assert(script[0].expect.test(system) && script[0].answer === DECLINE, 'declines an order');
  assert(script[1].expect.test('Which colour?') && script[1].answer === PROCEED, 'proceeds otherwise');
  const events = [
    { state: 'act.start', data: { details: 'Click element with index 6' } },
    { state: 'act.ok', data: { details: 'Clicked button with index 6: Search' } },
    { state: 'act.start', data: { details: 'Input text into index 3' } },
    { state: 'act.fail', data: { details: 'Input read-back did not match requested text.' } },
    { state: 'act.start', data: { details: 'done' } },
    { state: 'act.ok', data: { details: 'The cheapest is $19.' } },
  ];
  const history = actionHistory(events);
  assert(history.length === 2 && history[0] === 'Clicked button with index 6: Search' && history[1].startsWith('Input text into index 3 -> FAILED'), `history ${JSON.stringify(history)}`);
  console.log('self-check ok');
}

async function main() {
  const { values: opts } = parseArgs({
    options: { all: { type: 'boolean' }, resume: { type: 'string' }, limit: { type: 'string' }, only: { type: 'string' }, level: { type: 'string' }, 'self-check': { type: 'boolean' } },
  });
  if (opts['self-check']) return selfCheck();
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error(`No build at ${DIST}; run pnpm build first`);
  const sourcePath = path.join(HERE, opts.all ? 'Online_Mind2Web.json' : 'slice.json');
  if (!fs.existsSync(sourcePath)) throw new Error(`No ${sourcePath}; see README.md for getting the data`);
  const raw = fs.readFileSync(sourcePath);
  const parsed = JSON.parse(raw.toString('utf8'));
  const pool = opts.all ? parsed : parsed.tasks;
  const source = opts.all
    ? { file: 'Online_Mind2Web.json', sha256: createHash('sha256').update(raw).digest('hex'), tasks: pool.length }
    : { seed: parsed.seed, sourceSha256: parsed.sourceSha256 };
  const only = opts.only?.split(',').map(id => id.trim()).filter(Boolean);
  const tasks = pool
    .filter(t => (!only || only.includes(t.task_id)) && (!opts.level || t.level === opts.level))
    .slice(0, opts.limit ? Number(opts.limit) : undefined);
  if (tasks.length === 0) throw new Error('no tasks selected');

  const runDir = opts.resume ? path.resolve(opts.resume) : path.join(HERE, '..', 'results', `mind2web-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const runId = path.basename(runDir);
  fs.mkdirSync(runDir, { recursive: true });
  const todo = tasks.filter(task => {
    const saved = savedResult(runDir, task);
    return !saved || RETRY_ON_RESUME.has(saved.outcome);
  });
  console.log(`${tasks.length} tasks selected, ${tasks.length - todo.length} already done, ${todo.length} to run -> ${runDir}`);

  let session = await launchSession(null);
  let inSession = 0;
  try {
    for (const [n, task] of todo.entries()) {
      if (inSession >= TASKS_PER_BROWSER) {
        await closeSession(session);
        session = await launchSession(null);
        inSession = 0;
      }
      process.stdout.write(`[${n + 1}/${todo.length}] ${task.task_id} [${task.level}] ${task.confirmed_task.slice(0, 70)} ... `);
      // A harness error usually means a wedged browser: start a new one and give the task one more try.
      let result;
      for (let tries = 1; ; tries++) {
        try {
          result = await runTask(session.harness, task, runId, runDir);
          break;
        } catch (error) {
          console.log(`HARNESS ERROR (try ${tries}): ${error.message}`);
          await closeSession(session);
          session = await launchSession(null);
          inSession = 0;
          if (tries === 2) {
            result = writeResult(runDir, task, { outcome: 'harness_error', detail: error.message });
            break;
          }
        }
      }
      inSession++;
      console.log(`${result.outcome} (${result.seconds ?? 0}s, ${result.steps ?? 0} steps, ${result.metrics?.tokens.input ?? 0} input tokens, ${result.screenshots.length} shots)`);
    }
  } finally {
    await closeSession(session);
  }

  // The summary covers every selected task with a result in the folder, including those from earlier, resumed sessions.
  const results = tasks.map(task => savedResult(runDir, task)).filter(Boolean);
  const model = process.env.E2E_MODEL ?? 'gemini-2.5-flash';
  const rows = results.map(r => ({
    task_id: r.task_id,
    level: r.level,
    outcome: r.outcome,
    steps: r.steps,
    seconds: r.seconds,
    inputTokens: r.metrics?.tokens.input,
    llmCalls: r.metrics?.llmCalls,
    costUsd: r.metrics?.costUsd,
    questionsOther: r.questionsOther,
    questionsDeclined: r.questionsDeclined,
    screenshots: r.screenshots.length,
    answer: String(r.final_result_response || r.detail || '').slice(0, 300),
  }));
  fs.writeFileSync(
    path.join(runDir, 'summary.json'),
    `${JSON.stringify({ runId, model, plannerModel: process.env.E2E_PLANNER_MODEL ?? model, source, limits: LIMITS, results: rows }, null, 2)}\n`,
  );
  const outcomes = {};
  for (const row of rows) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  const cost = rows.reduce((n, r) => n + (r.costUsd ?? 0), 0);
  const tokens = rows.reduce((n, r) => n + (r.inputTokens ?? 0), 0);
  console.log(`${rows.length} of ${tasks.length} tasks have results ${JSON.stringify(outcomes)}, ${tokens} input tokens, estimated cost $${cost.toFixed(2)}. Not scored yet.`);
  console.log(`Results: ${runDir}\nJudge:   node e2e/mind2web/judge.mjs ${runDir}`);
}

main().catch(error => {
  console.error(`MIND2WEB RUN FAILED: ${error.message}`);
  process.exitCode = 1;
});

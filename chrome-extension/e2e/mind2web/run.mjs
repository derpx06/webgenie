// Runs the Online-Mind2Web slice (slice.json) on the live e2e harness (../run.mjs) and writes each task in WebJudge's
// input format. Scoring is a separate step: node e2e/mind2web/judge.mjs <runDir>.
//
//   pnpm build && node e2e/mind2web/run.mjs [--limit N] [--only <task_id>,<task_id>] [--level easy|medium|hard]
//   Environment as for ../run.mjs: E2E_MODEL, E2E_PLANNER_MODEL, E2E_PROJECT, E2E_LOCATION, E2E_HEADLESS, CHROMIUM_PATH
//
// Rules: the firewall denies common search engines, so the agent works from the task's website (the benchmark's rule);
// an order/payment confirmation is answered "No, stop here"; any other question is answered "Proceed with any
// reasonable choice." and counted; each task is capped at 25 steps, 600 s and 150k input tokens. After navigator actions
// (act.ok/act.fail) the newest web tab is screenshotted into <task_id>/trajectory/NN.png, at most 40 per task.
// Results: e2e/results/mind2web-<timestamp>/<task_id>/{result.json,trajectory/,events.jsonl,trace.jsonl,timeline.txt}.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { closeSession, launchSession } from '../run.mjs';
import { taskMetrics, timeline } from '../metrics.mjs';

const HERE = import.meta.dirname;
const DIST = path.resolve(HERE, '../../../dist');
const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com', 'search.yahoo.com'];
const LIMITS = { maxSteps: 25, maxMs: 600_000, maxInputTokens: 150_000 };
const MAX_SHOTS = 40;
const TASKS_PER_BROWSER = 10;
const DECLINE = 'No, stop here';
const PROCEED = 'Proceed with any reasonable choice.';

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

  const declined = run.questions.filter(isOrderConfirmation).length;
  return writeResult(runDir, task, {
    final_result_response: run.answer,
    action_history: actionHistory(run.events),
    screenshots,
    outcome: run.outcome,
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
  const { values: opts } = parseArgs({ options: { limit: { type: 'string' }, only: { type: 'string' }, level: { type: 'string' }, 'self-check': { type: 'boolean' } } });
  if (opts['self-check']) return selfCheck();
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error(`No build at ${DIST}; run pnpm build first`);
  const slicePath = path.join(HERE, 'slice.json');
  if (!fs.existsSync(slicePath)) throw new Error(`No ${slicePath}; build it with make-slice.mjs (see README.md)`);
  const slice = JSON.parse(fs.readFileSync(slicePath, 'utf8'));
  const only = opts.only?.split(',').map(id => id.trim()).filter(Boolean);
  const tasks = slice.tasks
    .filter(t => (!only || only.includes(t.task_id)) && (!opts.level || t.level === opts.level))
    .slice(0, opts.limit ? Number(opts.limit) : undefined);
  if (tasks.length === 0) throw new Error('no tasks selected');

  const runId = `mind2web-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(HERE, '..', 'results', runId);
  fs.mkdirSync(runDir, { recursive: true });

  const results = [];
  let session = await launchSession(null);
  let inSession = 0;
  try {
    for (const task of tasks) {
      if (inSession >= TASKS_PER_BROWSER) {
        await closeSession(session);
        session = await launchSession(null);
        inSession = 0;
      }
      process.stdout.write(`${task.task_id} [${task.level}] ${task.confirmed_task.slice(0, 70)} ... `);
      // A harness error usually means a wedged browser: start a new one and give the task one more try.
      for (let tries = 1; ; tries++) {
        try {
          results.push(await runTask(session.harness, task, runId, runDir));
          break;
        } catch (error) {
          console.log(`HARNESS ERROR (try ${tries}): ${error.message}`);
          await closeSession(session);
          session = await launchSession(null);
          inSession = 0;
          if (tries === 2) {
            results.push(writeResult(runDir, task, { outcome: 'harness_error', detail: error.message }));
            break;
          }
        }
      }
      inSession++;
      const r = results.at(-1);
      console.log(`${r.outcome} (${r.seconds ?? 0}s, ${r.steps ?? 0} steps, ${r.metrics?.tokens.input ?? 0} input tokens, ${r.screenshots.length} shots)`);
    }
  } finally {
    await closeSession(session);
  }

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
    `${JSON.stringify({ runId, model, plannerModel: process.env.E2E_PLANNER_MODEL ?? model, slice: { seed: slice.seed, sourceSha256: slice.sourceSha256 }, limits: LIMITS, results: rows }, null, 2)}\n`,
  );
  console.table(rows.map(({ task_id, answer, costUsd, ...row }) => ({ task: task_id.slice(0, 10), ...row, answer: answer.slice(0, 40) })));
  const cost = rows.reduce((n, r) => n + (r.costUsd ?? 0), 0);
  const tokens = rows.reduce((n, r) => n + (r.inputTokens ?? 0), 0);
  console.log(`${rows.length} tasks, ${tokens} input tokens, estimated cost $${cost.toFixed(2)}. Not scored yet.`);
  console.log(`Results: ${runDir}\nJudge:   node e2e/mind2web/judge.mjs ${runDir}`);
}

main().catch(error => {
  console.error(`MIND2WEB RUN FAILED: ${error.message}`);
  process.exitCode = 1;
});

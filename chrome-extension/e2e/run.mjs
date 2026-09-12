// Live end-to-end suites: drives the built extension (../../dist) in Chromium against real websites and
// local fixtures, with Vertex AI credentials from your gcloud login. Nothing here runs in `pnpm test`.
//
//   pnpm -F chrome-extension e2e
//   E2E_SUITE=core|complex|all (default core)   E2E_ONLY=T1,C13   E2E_REPEAT=2   E2E_HEADLESS=1
//   E2E_MODEL=gemini-2.5-flash  E2E_LOCATION=us-central1  E2E_PROJECT=<id>  CHROMIUM_PATH=/usr/bin/chromium
//   E2E_MAX_INPUT_TOKENS=4000000 (whole run)   E2E_TASK_MAX_INPUT_TOKENS=400000
//   E2E_UPDATE_BASELINE=1 (rewrite e2e/baseline.json after a full run with no regression)
//
// Results land in e2e/results/<run>/: summary.json, and per task events, trace, timeline (failures) and a
// screenshot. A full-suite run exits 1 on any regression against e2e/baseline.json; a subset run exits 1
// unless every task passes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { TASKS } from './tasks.mjs';
import { startFixtures } from './fixtures.mjs';
import { baselineFrom, compareWithBaseline, suiteHealth, taskMetrics, timeline } from './metrics.mjs';

const HERE = import.meta.dirname;
const DIST = path.resolve(HERE, '../../dist');
const BASELINE = path.join(HERE, 'baseline.json');
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const MODEL = process.env.E2E_MODEL ?? 'gemini-2.5-flash';
const LOCATION = process.env.E2E_LOCATION ?? 'us-central1';
const RUN_TOKEN_CAP = Number(process.env.E2E_MAX_INPUT_TOKENS ?? 4_000_000);
const TASK_TOKEN_CAP = Number(process.env.E2E_TASK_MAX_INPUT_TOKENS ?? 400_000);
const TERMINAL = new Set(['task.ok', 'task.fail', 'task.cancel', 'task.pause']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);
// Output is captured and never printed: it may be an access token.
const gcloud = (...args) => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
};

let project;
function vertexProvider() {
  project ??= process.env.E2E_PROJECT ?? gcloud('config', 'get-value', 'project');
  const token = gcloud('auth', 'print-access-token');
  if (!token.startsWith('ya29.')) throw new Error('gcloud auth print-access-token did not return an access token');
  return {
    type: 'vertex_ai',
    name: 'Google Vertex AI',
    apiKey: token,
    baseUrl: `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${project}/locations/${LOCATION}`,
    modelNames: [MODEL],
    createdAt: Date.now(),
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 WebGenie-e2e-checker' } });
  if (!response.ok) throw new Error(`fetch ${url} returned ${response.status}`);
  return response.text();
}

class Harness {
  constructor(browser, extensionId, fixtures) {
    this.browser = browser;
    this.extensionId = extensionId;
    this.fixtures = fixtures;
    this.ctl = null;
  }

  /** The control page: the background only accepts ports from the exact side-panel URL. */
  async ensureControl() {
    const alive = this.ctl && !this.ctl.isClosed() && (await this.ctl.evaluate(() => window.__portAlive === true).catch(() => false));
    if (alive) return;
    if (this.ctl && !this.ctl.isClosed()) await this.ctl.close().catch(() => {});
    this.ctl = await this.browser.newPage();
    await this.ctl.goto(`chrome-extension://${this.extensionId}/side-panel/index.html`);
    // Connect after the page's own UI connected, so the background's current port is ours.
    await sleep(2000);
    await this.ctl.evaluate(() => {
      window.__ev = [];
      window.__portAlive = true;
      const port = chrome.runtime.connect({ name: 'side-panel-connection' });
      port.onMessage.addListener(message => {
        if (message.screenshot) message.screenshot = '[omitted]';
        window.__ev.push(message);
      });
      port.onDisconnect.addListener(() => {
        window.__portAlive = false;
        window.__ev.push({ type: 'port_disconnected' });
      });
      window.__port = port;
    });
  }

  /** Provider, models, trace capture, and a chat session like the side panel creates. */
  async configure(taskId, title) {
    await this.ctl.evaluate(
      async ({ provider, model, taskId, title }) => {
        const now = Date.now();
        const sessions = (await chrome.storage.local.get('chat_sessions_meta')).chat_sessions_meta ?? [];
        sessions.push({ id: taskId, title, createdAt: now, updatedAt: now, messageCount: 0 });
        await chrome.storage.local.set({
          'llm-api-keys': { providers: { vertex_ai: provider } },
          'agent-models': {
            agents: {
              navigator: { provider: 'vertex_ai', modelName: model, parameters: { temperature: 0.3, topP: 0.85 } },
              planner: { provider: 'vertex_ai', modelName: model, parameters: { temperature: 0.7, topP: 0.9 } },
            },
          },
          'advanced-settings': { enableDeveloperOptions: true, captureTraces: true, logDOMSnapshot: false },
          chat_sessions_meta: sessions,
        });
      },
      { provider: vertexProvider(), model: MODEL, taskId, title },
    );
  }

  async clearOrigins(origins) {
    const client = await this.ctl.createCDPSession();
    try {
      for (const origin of origins) {
        await client.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {});
      }
    } finally {
      await client.detach().catch(() => {});
    }
  }

  async webPages() {
    return (await this.browser.pages()).filter(page => !page.url().startsWith('chrome-extension://') && !page.isClosed());
  }

  async evalOn(urlPart, fn, ...args) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const page = (await this.webPages()).filter(p => p.url().includes(urlPart)).at(-1);
        if (!page) return undefined;
        return await withTimeout(page.evaluate(fn, ...args), 10_000, 'evalOn');
      } catch (error) {
        if (attempt === 1) throw error;
        await sleep(500);
      }
    }
  }

  async evalFrame(pageUrlPart, frameUrlPart, fn, ...args) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const page = (await this.webPages()).filter(p => p.url().includes(pageUrlPart)).at(-1);
        const frame = page?.frames().find(f => f.url().includes(frameUrlPart));
        if (!frame) return undefined;
        return await withTimeout(frame.evaluate(fn, ...args), 10_000, 'evalFrame');
      } catch (error) {
        if (attempt === 1) throw error;
        await sleep(500);
      }
    }
  }

  tabUrls() {
    return this.ctl.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.url).filter(url => !url.startsWith('chrome-extension://')));
  }

  activeTabUrl() {
    return this.ctl.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url);
  }

  async readTraces(taskId) {
    return this.ctl.evaluate(
      id =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('WebGenieTraces');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('records')) {
              db.close();
              resolve([]);
              return;
            }
            // Only this task's records, removed once read: loading the whole store every task grew the
            // control page's memory until Chromium stopped responding.
            const tx = db.transaction('records', 'readwrite');
            const cursor = tx.objectStore('records').index('taskId').openCursor(IDBKeyRange.only(id));
            const records = [];
            cursor.onsuccess = () => {
              const current = cursor.result;
              if (!current) return;
              records.push(current.value);
              current.delete();
              current.continue();
            };
            tx.oncomplete = () => {
              db.close();
              resolve(records);
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      taskId,
    );
  }

  /** Runs the task over the port until a terminal state, a human request, or a limit. */
  async drive({ taskId, tabId, task, maxMs, maxSteps, allowHuman, human = [], type = 'new_task' }) {
    await this.ctl.evaluate(
      ({ type, task, taskId, tabId }) => {
        window.__ev = [];
        window.__port.postMessage({ type, task, taskId, tabId });
      },
      { type, task, taskId, tabId },
    );

    const started = Date.now();
    const events = [];
    let outcome = null;
    let answer = '';
    let maxStep = 0;
    let inputTokens = 0;
    let stopReason = null;
    let stopAt = 0;
    // Every question the agent asks; scripted answers are given in order, anything else stops the task.
    const questions = [];
    let answered = 0;
    const stop = async reason => {
      stopReason = reason;
      stopAt = Date.now();
      await this.ctl.evaluate(() => window.__port.postMessage({ type: 'cancel_task' })).catch(() => {});
    };

    while (!outcome) {
      await sleep(1000);
      const batch = await this.ctl.evaluate(() => window.__ev.splice(0));
      for (const e of batch) {
        events.push({ t: Date.now() - started, ts: Date.now(), ...e });
        if (e.type === 'error' || e.type === 'port_disconnected') {
          outcome = e.type;
          answer = String(e.error ?? '');
          continue;
        }
        if (!e.state) continue;
        maxStep = Math.max(maxStep, e.data?.step ?? 0);
        inputTokens = Math.max(inputTokens, e.data?.usage?.inputTokens ?? 0);
        if (e.state === 'act.ask_human' && !stopReason) {
          let question = String(e.data?.details ?? '');
          try {
            question = JSON.parse(question).question ?? question;
          } catch {
            // plain-text question
          }
          questions.push(question);
          const script = human[answered];
          if (script && (!script.expect || script.expect.test(question))) {
            answered++;
            await this.ctl.evaluate(
              (response, secrets) => window.__port.postMessage({ type: 'human_response', response, secrets }),
              script.answer,
              script.secrets ?? [],
            );
          } else if (!allowHuman) {
            answer = question;
            await stop('asked_human');
          }
        }
        if (TERMINAL.has(e.state)) {
          outcome = stopReason ?? e.state;
          answer = stopReason === 'asked_human' ? answer : String(e.data?.details ?? '');
        }
      }
      if (!outcome && !stopReason) {
        if (Date.now() - started > maxMs) await stop('limit_time');
        else if (maxStep >= maxSteps) await stop('limit_steps');
        else if (inputTokens > TASK_TOKEN_CAP) await stop('limit_tokens');
      }
      if (!outcome && stopReason && Date.now() - stopAt > 15_000) outcome = stopReason;
    }
    return { outcome, answer, maxStep, events, questions, seconds: +((Date.now() - started) / 1000).toFixed(1) };
  }

  async runTask(task, runId, repeat, outDir) {
    const attempt = repeat > 0 ? `${task.id}-r${repeat + 1}` : task.id;
    const taskId = `${runId}-${attempt}`;
    const url = typeof task.url === 'function' ? task.url(this.fixtures) : task.url;

    await this.ensureControl();
    await this.clearOrigins([new URL(url).origin, ...(task.origins ?? [])]);
    await this.configure(taskId, task.title);

    const web = await this.browser.newPage();
    await web.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await web.bringToFront();
    const tabId = await this.ctl.evaluate(async href => (await chrome.tabs.query({})).filter(t => t.url === href).at(-1)?.id, web.url());
    if (!tabId) throw new Error(`no tab found for ${web.url()}`);

    process.stdout.write(`${attempt} ${task.title} ... `);
    const limits = { taskId, tabId, maxMs: (task.maxSeconds ?? 180) * 1000, maxSteps: task.maxSteps ?? 25, allowHuman: task.allowHuman };
    let run = await this.drive({ ...limits, task: typeof task.task === 'function' ? task.task(this.fixtures) : task.task, human: task.human });
    // Follow-up messages in the same conversation, each sent after the previous one finished.
    const answers = [run.answer];
    for (const followUp of task.followUps ?? []) {
      if (run.outcome !== 'task.ok') break;
      const next = await this.drive({ ...limits, task: followUp, type: 'follow_up_task' });
      run = { ...next, events: [...run.events, ...next.events], questions: [...run.questions, ...next.questions], seconds: +(run.seconds + next.seconds).toFixed(1) };
      answers.push(next.answer);
    }
    await sleep(2000); // let the trace sink flush its last batch

    const records = await this.readTraces(taskId).catch(() => []);
    const pages = await this.webPages();
    await withTimeout(pages.at(-1)?.screenshot({ path: path.join(outDir, `${attempt}.png`) }) ?? Promise.resolve(), 10_000, 'screenshot').catch(() => {});

    let check;
    try {
      const verdict = await task.check({
        answer: run.answer,
        answers,
        outcome: run.outcome,
        evalOn: (...args) => this.evalOn(...args),
        evalFrame: (...args) => this.evalFrame(...args),
        tabUrls: () => this.tabUrls(),
        activeTabUrl: () => this.activeTabUrl(),
        fetchText,
        fixtures: this.fixtures,
        questions: run.questions,
      });
      check = typeof verdict === 'boolean' ? { pass: verdict, detail: '' } : verdict;
    } catch (error) {
      check = { pass: false, detail: `checker error: ${error.message}` };
    }

    const metrics = taskMetrics(records, run.events, { secret: task.secret, taskText: typeof task.task === 'function' ? task.task(this.fixtures) : task.task });
    const pass = run.outcome === 'task.ok' && check.pass && metrics.secretLeaks === 0;
    fs.writeFileSync(path.join(outDir, `${attempt}.events.jsonl`), run.events.map(e => JSON.stringify(e)).join('\n'));
    fs.writeFileSync(path.join(outDir, `${attempt}.trace.jsonl`), records.map(r => JSON.stringify(r)).join('\n'));
    if (!pass) fs.writeFileSync(path.join(outDir, `${attempt}.timeline.txt`), timeline(records, run.events));
    for (const page of pages) await page.close().catch(() => {});

    console.log(`${pass ? 'PASS' : 'FAIL'} (${run.outcome}, ${run.seconds}s, ${metrics.llmCalls} calls${check.pass || !check.detail ? '' : `, ${check.detail.slice(0, 120)}`})`);
    return {
      id: task.id,
      attempt,
      suite: task.suite,
      kind: task.kind,
      title: task.title,
      pass,
      outcome: run.outcome,
      answer: run.answer.slice(0, 400),
      detail: check.detail,
      steps: run.maxStep,
      seconds: run.seconds,
      questions: run.questions,
      metrics,
    };
  }
}

/** Every browser gets a fresh profile: Chromium keeps a cached service-worker script for a reused one. */
async function launchSession(fixtures) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'webgenie-e2e-'));
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: process.env.E2E_HEADLESS ? true : false,
    userDataDir: profile,
    defaultViewport: null,
    // A hung page call fails in a minute instead of the default three.
    protocolTimeout: 60_000,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-first-run', '--no-default-browser-check', '--window-size=1400,900'],
  });
  try {
    const worker = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 30_000 });
    return { browser, profile, harness: new Harness(browser, new URL(worker.url()).host, fixtures) };
  } catch (error) {
    await browser.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}

async function closeSession(session) {
  await session.browser.close().catch(() => {});
  fs.rmSync(session.profile, { recursive: true, force: true });
}

/** Tasks per browser: a long run in one Chromium accumulates memory on a machine that is already swapping. */
const TASKS_PER_BROWSER = Math.max(1, Number(process.env.E2E_TASKS_PER_BROWSER ?? 10));

async function main() {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error(`No build at ${DIST}; run pnpm build first`);
  const suite = process.env.E2E_SUITE ?? 'core';
  const only = process.env.E2E_ONLY?.split(',').map(id => id.trim()).filter(Boolean);
  const repeats = Math.max(1, Number(process.env.E2E_REPEAT ?? 1));
  const tasks = TASKS.filter(task => (only ? only.includes(task.id) : suite === 'all' || task.suite === suite));
  if (tasks.length === 0) throw new Error('no tasks selected');

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(HERE, 'results', runId);
  fs.mkdirSync(outDir, { recursive: true });

  const fixtures = await startFixtures();
  const results = [];
  let session = await launchSession(fixtures);
  let tasksInSession = 0;
  try {
    let spentInputTokens = 0;
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (const task of tasks) {
        const base = { id: task.id, attempt: repeat > 0 ? `${task.id}-r${repeat + 1}` : task.id, suite: task.suite, kind: task.kind, title: task.title, pass: false };
        if (spentInputTokens >= RUN_TOKEN_CAP) {
          results.push({ ...base, outcome: 'skipped_budget', detail: `run token cap ${RUN_TOKEN_CAP} reached` });
          continue;
        }
        if (tasksInSession >= TASKS_PER_BROWSER) {
          await closeSession(session);
          session = await launchSession(fixtures);
          tasksInSession = 0;
        }
        // A harness error usually means a wedged or dead browser, which would fail every later task too:
        // start a new browser and give the task one more try.
        for (let tries = 1; ; tries++) {
          try {
            const result = await session.harness.runTask(task, runId, repeat, outDir);
            spentInputTokens += result.metrics.tokens.input;
            results.push(result);
            break;
          } catch (error) {
            console.log(`HARNESS ERROR (try ${tries}): ${error.message}`);
            await closeSession(session);
            session = await launchSession(fixtures);
            tasksInSession = 0;
            if (tries === 2) {
              results.push({ ...base, outcome: 'harness_error', detail: error.message });
              break;
            }
          }
        }
        tasksInSession++;
      }
    }
  } finally {
    await closeSession(session);
    await fixtures.close();
  }

  const health = suiteHealth(results);
  const fullRun = !only;
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch {
    // no baseline yet
  }
  const comparison = fullRun ? compareWithBaseline(results, health, baseline) : { regressions: [], improvements: [] };
  const summary = {
    runId,
    model: MODEL,
    gitSha: git('rev-parse', '--short', 'HEAD'),
    gitDirty: git('status', '--porcelain') !== '',
    distBuiltAt: fs.statSync(path.join(DIST, 'manifest.json')).mtime.toISOString(),
    suite: only ? `only:${only.join(',')}` : suite,
    repeats,
    health,
    comparison,
    results,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.table(
    results.map(r => ({
      id: r.attempt,
      pass: r.pass,
      outcome: r.outcome,
      steps: r.steps,
      s: r.seconds,
      calls: r.metrics?.llmCalls,
      plan: r.metrics?.plannerCalls,
      reask: r.metrics?.reasks,
      getState: r.metrics?.getStateCount,
      detail: r.pass ? '' : String(r.detail || r.answer || '').slice(0, 70),
    })),
  );
  for (const [name, h] of Object.entries(health)) console.log(`${name}: ${JSON.stringify(h)}`);
  if (comparison.improvements.length) console.log(`Improvements:\n  ${comparison.improvements.join('\n  ')}`);
  if (comparison.regressions.length) console.log(`REGRESSIONS:\n  ${comparison.regressions.join('\n  ')}`);
  console.log(`Results: ${outDir}`);

  const allPassed = results.every(r => r.pass);
  if (fullRun && process.env.E2E_UPDATE_BASELINE && (comparison.regressions.length === 0 || !baseline)) {
    fs.writeFileSync(BASELINE, `${JSON.stringify(baselineFrom(results, health), null, 2)}\n`);
    console.log(`Baseline updated: ${BASELINE}`);
  }
  process.exitCode = fullRun ? (comparison.regressions.length ? 1 : 0) : allPassed ? 0 : 1;
}

main().catch(error => {
  console.error(`E2E FAILED: ${error.message}`);
  process.exitCode = 1;
});

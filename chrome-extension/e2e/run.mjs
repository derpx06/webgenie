// Live end-to-end suites: drives the built extension (../../dist) in Chromium against real websites and
// local fixtures, with Vertex AI credentials from your gcloud login. Nothing here runs in `pnpm test`.
//
//   pnpm -F chrome-extension e2e
//   E2E_SUITE=core|complex|hitl|security|breadth|all (default core)   E2E_ONLY=T1,C13   E2E_REPEAT=2   E2E_HEADLESS=1
//   E2E_MODEL=gemini-2.5-flash  E2E_PLANNER_MODEL=<model>  E2E_LOCATION=us-central1  E2E_PROJECT=<id>  CHROMIUM_PATH=/usr/bin/chromium
//   E2E_MAX_INPUT_TOKENS=4000000 (whole run)   E2E_TASK_MAX_INPUT_TOKENS=400000
//   E2E_UPDATE_BASELINE=1 (full run with no regression: rewrite e2e/baseline.json; subset run: merge its entries)
//   E2E_ORACLE=1 (no model calls: each fixture task's checker must pass with its scripted oracle and fail with no action)
//
// Results land in e2e/results/<run>/: summary.json, and per task events, trace, timeline (failures) and a
// screenshot. A full-suite run exits 1 on any regression against e2e/baseline.json; a subset run exits 1
// unless every task passes. A start page that is down (network error or 5xx) records site_down, which
// counts neither as a pass nor as a failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { TASKS } from './tasks.mjs';
import { startFixtures } from './fixtures.mjs';
import { baselineFrom, compareWithBaseline, mergeBaseline, suiteHealth, taskMetrics, timeline, wilson } from './metrics.mjs';

const HERE = import.meta.dirname;
const DIST = path.resolve(HERE, '../../dist');
const BASELINE = path.join(HERE, 'baseline.json');
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const MODEL = process.env.E2E_MODEL ?? 'gemini-2.5-flash';
const PLANNER_MODEL = process.env.E2E_PLANNER_MODEL ?? MODEL;
const ORACLE = !!process.env.E2E_ORACLE;
// global spreads requests across regions: in live runs us-central1 returned 429 on about 1 in 7 model calls.
const LOCATION = process.env.E2E_LOCATION ?? 'global';
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
    // The global location has no region prefix on its host; it spreads requests across regions (fewer 429s).
    baseUrl: `https://${LOCATION === 'global' ? '' : `${LOCATION}-`}aiplatform.googleapis.com/v1/projects/${project}/locations/${LOCATION}`,
    modelNames: [...new Set([MODEL, PLANNER_MODEL])],
    createdAt: Date.now(),
  };
}

const UA = { 'user-agent': 'Mozilla/5.0 WebGenie-e2e-checker' };

async function fetchText(url) {
  const response = await fetch(url, { headers: UA });
  if (!response.ok) throw new Error(`fetch ${url} returned ${response.status}`);
  return response.text();
}

/** Why a public start page is unusable (network error or 5xx on two tries), or null when it is up. */
async function siteDown(url) {
  let reason = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (response.status < 500) return null;
      reason = `HTTP ${response.status}`;
    } catch (error) {
      reason = error.cause?.code ?? error.message;
    }
    await sleep(5000);
  }
  return reason;
}

export class Harness {
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
    });
    await this.connectPort();
  }

  /** A port like the side panel's; a new one after a worker restart wakes the worker and becomes the current port. */
  async connectPort() {
    await this.ctl.evaluate(() => {
      window.__ev ??= [];
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

  post(message) {
    return this.ctl.evaluate(m => window.__port.postMessage(m), message);
  }

  /** Provider, models, trace capture, and a chat session like the side panel creates. */
  async configure(taskId, title, settings = {}) {
    await this.ctl.evaluate(
      async ({ provider, model, plannerModel, taskId, title, settings }) => {
        const now = Date.now();
        const sessions = (await chrome.storage.local.get('chat_sessions_meta')).chat_sessions_meta ?? [];
        sessions.push({ id: taskId, title, createdAt: now, updatedAt: now, messageCount: 0 });
        await chrome.storage.local.set({
          'llm-api-keys': { providers: { vertex_ai: provider } },
          'agent-models': {
            agents: {
              navigator: { provider: 'vertex_ai', modelName: model, parameters: { temperature: 0.3, topP: 0.85 } },
              planner: { provider: 'vertex_ai', modelName: plannerModel, parameters: { temperature: 0.7, topP: 0.9 } },
            },
          },
          'advanced-settings': { enableDeveloperOptions: true, captureTraces: true, logDOMSnapshot: false },
          'firewall-settings': { enabled: true, allowList: [], denyList: [] },
          'general-settings': {},
          chat_sessions_meta: sessions,
          ...settings,
        });
      },
      { provider: vertexProvider(), model: MODEL, plannerModel: PLANNER_MODEL, taskId, title, settings },
    );
  }

  /** Everything the extension persisted outside the trace store, keyed `local:`, `session:` or `idb:<db>:<store>`. */
  async dumpStorage() {
    return this.ctl.evaluate(async () => {
      const out = {};
      const areas = [
        ['local', await chrome.storage.local.get(null)],
        ['session', await chrome.storage.session.get(null).catch(() => ({}))],
      ];
      for (const [area, items] of areas) for (const [key, value] of Object.entries(items)) out[`${area}:${key}`] = value;
      for (const { name } of await indexedDB.databases()) {
        if (!name || name === 'WebGenieTraces') continue;
        const db = await new Promise((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        for (const store of db.objectStoreNames) {
          out[`idb:${name}:${store}`] = await new Promise(resolve => {
            const request = db.transaction(store).objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
          });
        }
        db.close();
      }
      return out;
    });
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
  /**
   * `during` ({ when(event), run(ctx) }) acts once mid-task: ctx can stop the service worker, close the agent's tab, pause
   * and resume, or start another task. `reconnect` reattaches after the port drops; `lateAnswer` answers once the task
   * paused waiting for an answer.
   */
  async drive({ taskId, tabId, task, maxMs, maxSteps, maxInputTokens = TASK_TOKEN_CAP, allowHuman, human = [], type = 'new_task', page, during, reconnect, lateAnswer }) {
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
    const questionTimes = [];
    let answered = 0;
    const marks = {};
    const extraTaskIds = [];
    let duringDone = false;
    /** Pause events the harness itself caused; they may arrive after ctx.resume() has already run. */
    let harnessPauses = 0;
    let lateAnswered = false;
    let reconnects = 0;
    /** After ctx.startNewTask, terminal events belong to the first task until the second one has started. */
    let secondTaskId = null;
    let secondStarted = false;
    const ctx = {
      taskId,
      tabId,
      sleep,
      mark: name => {
        marks[name] = Date.now();
      },
      killWorker: async () => {
        marks.interruptAt = Date.now();
        const client = await this.ctl.createCDPSession();
        try {
          await client.send('ServiceWorker.enable');
          await client.send('ServiceWorker.stopAllWorkers');
        } finally {
          await client.detach().catch(() => {});
        }
      },
      closeAgentTab: async () => {
        marks.interruptAt = Date.now();
        await page?.close();
      },
      pause: async () => {
        harnessPauses++;
        marks.pauseAt = Date.now();
        await this.post({ type: 'pause_task' });
      },
      resume: async () => {
        marks.resumeAt = Date.now();
        await this.post({ type: 'resume_task' });
      },
      startNewTask: async text => {
        secondTaskId = `${taskId}-b`;
        extraTaskIds.push(secondTaskId);
        marks.secondSentAt = Date.now();
        await this.configure(secondTaskId, 'second task');
        await this.post({ type: 'new_task', task: text, taskId: secondTaskId, tabId });
      },
    };
    const stop = async reason => {
      stopReason = reason;
      stopAt = Date.now();
      await this.ctl.evaluate(() => window.__port.postMessage({ type: 'cancel_task' })).catch(() => {});
    };

    while (!outcome) {
      await sleep(300);
      const batch = await this.ctl.evaluate(() => window.__ev.splice(0));
      for (const e of batch) {
        events.push({ t: Date.now() - started, ts: Date.now(), ...e });
        if (e.type === 'port_disconnected' && reconnect && reconnects < 3) {
          // The worker went away (restarted): connect again, which wakes it, and ask it to pick the task up.
          reconnects++;
          await sleep(1000);
          await this.connectPort();
          await this.post({ type: 'reattach', taskId, tabId });
          continue;
        }
        if (e.type === 'error' || e.type === 'port_disconnected') {
          outcome = e.type;
          answer = String(e.error ?? '');
          continue;
        }
        if (!e.state) continue;
        if (during && !duringDone && during.when(e)) {
          duringDone = true;
          await during.run(ctx);
        }
        if (e.state === 'task.start' && secondTaskId && e.data?.details === secondTaskId) {
          secondStarted = true;
          marks.secondStartedAt = Date.now();
        }
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
          questionTimes.push(Date.now());
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
        if (e.state === 'task.pause' && harnessPauses > 0) {
          harnessPauses--;
          continue;
        }
        if (e.state === 'task.pause' && lateAnswer && !lateAnswered) {
          // The task gave up waiting and saved itself: an answer now must resume it.
          lateAnswered = true;
          marks.lateAnswerAt = Date.now();
          await this.post({ type: 'human_response', response: lateAnswer, taskId, tabId });
          continue;
        }
        if (TERMINAL.has(e.state) && (!secondTaskId || secondStarted)) {
          outcome = stopReason ?? e.state;
          answer = stopReason === 'asked_human' ? answer : String(e.data?.details ?? '');
        }
      }
      if (!outcome && !stopReason) {
        if (Date.now() - started > maxMs) await stop('limit_time');
        else if (maxStep >= maxSteps) await stop('limit_steps');
        else if (inputTokens > maxInputTokens) await stop('limit_tokens');
      }
      if (!outcome && stopReason && Date.now() - stopAt > 15_000) outcome = stopReason;
    }
    return { outcome, answer, maxStep, events, questions, questionTimes, marks, extraTaskIds, seconds: +((Date.now() - started) / 1000).toFixed(1) };
  }

  async check(task, run, answers, extra = {}) {
    try {
      const verdict = await task.check({
        ...extra,
        events: run.events ?? [],
        marks: run.marks ?? {},
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
        questionTimes: run.questionTimes,
      });
      return typeof verdict === 'boolean' ? { pass: verdict, detail: '' } : verdict;
    } catch (error) {
      return { pass: false, detail: `checker error: ${error.message}` };
    }
  }

  /** Proves a checker without the model: it must fail when nothing is done and pass with the scripted solution. */
  async runOracle(task, url) {
    await this.ensureControl();
    const verdicts = {};
    for (const mode of ['nothing', 'oracle']) {
      await this.clearOrigins([new URL(url).origin]);
      this.fixtures.resetHits();
      const page = await this.browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      const run = { outcome: 'task.ok', answer: '', answers: [''], questions: [], questionTimes: [] };
      if (mode === 'oracle') {
        const ask = question => {
          run.questions.push(question);
          run.questionTimes.push(Date.now());
        };
        const solved = await task.oracle({ page, fixtures: this.fixtures, ask });
        run.answer = solved.answer;
        run.answers = solved.answers ?? [solved.answer];
      }
      verdicts[mode] = await this.check(task, run, run.answers);
      for (const open of await this.webPages()) await open.close().catch(() => {});
    }
    const pass = !verdicts.nothing.pass && verdicts.oracle.pass;
    console.log(`${task.id} oracle ${pass ? 'PASS' : 'FAIL'} (nothing: ${verdicts.nothing.pass}, oracle: ${verdicts.oracle.pass} ${verdicts.oracle.detail ?? ''})`);
    return { id: task.id, attempt: task.id, suite: task.suite, kind: task.kind, title: task.title, pass, outcome: 'oracle', detail: JSON.stringify(verdicts), seconds: 0 };
  }

  async runTask(task, runId, repeat, outDir) {
    const attempt = repeat > 0 ? `${task.id}-r${repeat + 1}` : task.id;
    const taskId = `${runId}-${attempt}`;
    const url = typeof task.url === 'function' ? task.url(this.fixtures) : task.url;
    if (ORACLE) return this.runOracle(task, url);

    const isFixture = [this.fixtures.hostOrigin, this.fixtures.editorOrigin].some(origin => url.startsWith(origin));
    const down = isFixture ? null : await siteDown(url);
    if (down) {
      console.log(`${attempt} ${task.title} ... SITE DOWN (${down})`);
      return { id: task.id, attempt, suite: task.suite, kind: task.kind, title: task.title, pass: false, outcome: 'site_down', detail: down, seconds: 0 };
    }

    await this.ensureControl();
    await this.clearOrigins([new URL(url).origin, ...(task.origins ?? [])]);
    await this.configure(taskId, task.title, task.settings);
    this.fixtures.resetHits();

    const web = await this.browser.newPage();
    await web.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await web.bringToFront();
    const tabId = await this.ctl.evaluate(async href => (await chrome.tabs.query({})).filter(t => t.url === href).at(-1)?.id, web.url());
    if (!tabId) throw new Error(`no tab found for ${web.url()}`);

    process.stdout.write(`${attempt} ${task.title} ... `);
    const limits = {
      taskId,
      tabId,
      maxMs: (task.maxSeconds ?? 180) * 1000,
      maxSteps: task.maxSteps ?? 25,
      maxInputTokens: task.maxInputTokens ?? TASK_TOKEN_CAP,
      allowHuman: task.allowHuman,
    };
    let run = await this.drive({
      ...limits,
      task: typeof task.task === 'function' ? task.task(this.fixtures) : task.task,
      human: task.human,
      page: web,
      during: task.during,
      reconnect: task.reconnect,
      lateAnswer: task.lateAnswer,
    });
    const taskIds = [taskId, ...run.extraTaskIds];
    // Follow-up messages in the same conversation, each sent after the previous one finished.
    const answers = [run.answer];
    for (const followUp of task.followUps ?? []) {
      if (run.outcome !== 'task.ok') break;
      const next = await this.drive({ ...limits, task: followUp, type: 'follow_up_task' });
      run = {
        ...next,
        events: [...run.events, ...next.events],
        questions: [...run.questions, ...next.questions],
        questionTimes: [...run.questionTimes, ...next.questionTimes],
        seconds: +(run.seconds + next.seconds).toFixed(1),
      };
      answers.push(next.answer);
    }
    // Later tasks in new conversations, each on its own start page, in the same browser (memory across tasks).
    for (const [n, next] of (task.sequence ?? []).entries()) {
      if (run.outcome !== 'task.ok') break;
      const seqId = `${taskId}-s${n + 2}`;
      const seqUrl = typeof next.url === 'function' ? next.url(this.fixtures) : next.url;
      await this.configure(seqId, task.title, task.settings);
      const seqPage = await this.browser.newPage();
      await seqPage.goto(seqUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await seqPage.bringToFront();
      const seqTab = await this.ctl.evaluate(async href => (await chrome.tabs.query({})).filter(t => t.url === href).at(-1)?.id, seqPage.url());
      const out = await this.drive({ ...limits, taskId: seqId, tabId: seqTab, task: next.task, page: seqPage });
      run = { ...out, events: [...run.events, ...out.events], questions: [...run.questions, ...out.questions], questionTimes: [...run.questionTimes, ...out.questionTimes], seconds: +(run.seconds + out.seconds).toFixed(1) };
      taskIds.push(seqId);
      answers.push(out.answer);
    }
    await sleep(900); // the trace sink flushes every 500 ms

    const records = [];
    for (const id of taskIds) records.push(...(await this.readTraces(id).catch(() => [])));
    const storage = await this.dumpStorage().catch(() => null);
    const pages = await this.webPages();
    await withTimeout(pages.at(-1)?.screenshot({ path: path.join(outDir, `${attempt}.png`) }) ?? Promise.resolve(), 10_000, 'screenshot').catch(() => {});

    const check = await this.check(task, run, answers, { records, storage, taskId });
    const metrics = taskMetrics(records, run.events, { secret: task.secret, taskText: typeof task.task === 'function' ? task.task(this.fixtures) : task.task, storage });
    const pass = (task.outcomes ?? ['task.ok']).includes(run.outcome) && check.pass && metrics.secretLeaks === 0 && metrics.storageLeaks === 0;
    if (metrics.secretLeaks || metrics.storageLeaks) {
      check.detail = `${check.detail ?? ''} secretLeaks=${metrics.secretLeaks} storage keys with the secret: ${metrics.storageLeakKeys.join(', ') || 'none'}`.trim();
    }
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
      /** Questions the task wants asked (scripted answers); more is needless, fewer is missed. */
      questionsExpected: (task.human ?? []).filter(script => !script.optional).length + (task.lateAnswer ? 1 : 0),
      metrics,
    };
  }
}

/** Every browser gets a fresh profile: Chromium keeps a cached service-worker script for a reused one. */
export async function launchSession(fixtures) {
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

export async function closeSession(session) {
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
  const tasks = TASKS.filter(task => (only ? only.includes(task.id) : suite === 'all' || task.suite === suite)).filter(task => !ORACLE || task.oracle);
  if (tasks.length === 0) throw new Error('no tasks selected');

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  // The code under test is what was checked out when the run began; commits made during a long run must not relabel it.
  const gitAtStart = { sha: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
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
            spentInputTokens += result.metrics?.tokens.input ?? 0;
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
  const fullRun = !only && !ORACLE;
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch {
    // no baseline yet
  }
  const comparison = fullRun ? compareWithBaseline(results, health, baseline, repeats) : { regressions: [], warnings: [], improvements: [] };
  const summary = {
    runId,
    model: MODEL,
    plannerModel: PLANNER_MODEL,
    gitSha: gitAtStart.sha,
    gitDirty: gitAtStart.dirty,
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
  const counted = results.filter(r => r.outcome !== 'site_down' && r.outcome !== 'oracle');
  if (counted.length) {
    const passedAll = counted.filter(r => r.pass).length;
    const cost = counted.reduce((n, r) => n + (r.metrics?.costUsd ?? 0), 0);
    console.log(`overall: ${passedAll}/${counted.length} passed, 95% CI ${JSON.stringify(wilson(passedAll, counted.length))}, estimated cost $${cost.toFixed(2)}`);
  }
  for (const r of results.filter(row => row.metrics?.trend)) {
    const t = r.metrics.trend;
    console.log(`trend ${r.attempt}: ${t.calls} navigator calls; input tokens ${t.inputTokensFirst} → ${t.inputTokensLast}; latency ${t.latencyFirstMs} → ${t.latencyLastMs} ms; page read ${t.getStateFirstMs} → ${t.getStateLastMs} ms`);
  }
  if (comparison.improvements.length) console.log(`Improvements:\n  ${comparison.improvements.join('\n  ')}`);
  if (comparison.warnings.length) console.log(`Warnings (latency, single-attempt runs):\n  ${comparison.warnings.join('\n  ')}`);
  if (comparison.regressions.length) console.log(`REGRESSIONS:\n  ${comparison.regressions.join('\n  ')}`);
  console.log(`Results: ${outDir}`);

  const allPassed = results.every(r => r.pass || r.outcome === 'site_down');
  if (process.env.E2E_UPDATE_BASELINE && !ORACLE) {
    if (fullRun && (comparison.regressions.length === 0 || !baseline)) {
      fs.writeFileSync(BASELINE, `${JSON.stringify(baselineFrom(results, health, repeats), null, 2)}\n`);
      console.log(`Baseline updated: ${BASELINE}`);
    } else if (!fullRun && baseline) {
      fs.writeFileSync(BASELINE, `${JSON.stringify(mergeBaseline(baseline, results, repeats), null, 2)}\n`);
      console.log(`Baseline entries merged for ${[...new Set(results.map(r => r.id))].join(', ')}: ${BASELINE}`);
    }
  }
  process.exitCode = fullRun ? (comparison.regressions.length ? 1 : 0) : allPassed ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`E2E FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

// Live end-to-end suite: drives the built extension (../../dist) in Chromium against real websites,
// with Vertex AI credentials from your gcloud login. Nothing here runs in `pnpm test`.
//
//   pnpm -F chrome-extension e2e
//   E2E_ONLY=T1,T12  E2E_HEADLESS=1  E2E_MODEL=gemini-2.5-flash  E2E_LOCATION=us-central1  E2E_PROJECT=<id>
//   CHROMIUM_PATH=/usr/bin/chromium  E2E_MIN_PASS=17
//
// Results land in e2e/results/<run>/: summary.json plus events, trace and a screenshot per task.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { TASKS } from './tasks.mjs';

const HERE = import.meta.dirname;
const DIST = path.resolve(HERE, '../../dist');
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const MODEL = process.env.E2E_MODEL ?? 'gemini-2.5-flash';
const LOCATION = process.env.E2E_LOCATION ?? 'us-central1';
const MAX_MS = 180_000;
const MAX_STEPS = 25;
const TERMINAL = new Set(['task.ok', 'task.fail', 'task.cancel', 'task.pause']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Output is captured and never printed: it may be an access token.
const gcloud = (...args) => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

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

/** Writes provider, models and trace capture straight into extension storage; the token is refreshed per task. */
async function configure(ctl) {
  await ctl.evaluate(
    async ({ provider, model }) => {
      await chrome.storage.local.set({
        'llm-api-keys': { providers: { vertex_ai: provider } },
        'agent-models': {
          agents: {
            navigator: { provider: 'vertex_ai', modelName: model, parameters: { temperature: 0.3, topP: 0.85 } },
            planner: { provider: 'vertex_ai', modelName: model, parameters: { temperature: 0.7, topP: 0.9 } },
          },
        },
        'advanced-settings': { enableDeveloperOptions: true, captureTraces: true, logDOMSnapshot: false },
      });
    },
    { provider: vertexProvider(), model: MODEL },
  );
}

/** Starts the task over the side-panel port and collects events until a terminal state or a limit. */
async function drive(ctl, { taskId, tabId, task }) {
  await ctl.evaluate(
    ({ task, taskId, tabId }) => {
      window.__ev = [];
      window.__port.postMessage({ type: 'new_task', task, taskId, tabId });
    },
    { task, taskId, tabId },
  );

  const started = Date.now();
  const events = [];
  let outcome = null;
  let answer = '';
  let maxStep = 0;
  let cancelledAt = 0;
  while (!outcome) {
    await sleep(1000);
    for (const e of await ctl.evaluate(() => window.__ev.splice(0))) {
      events.push({ t: Date.now() - started, ...e });
      if (e.type === 'error' || e.type === 'port_disconnected') {
        outcome = e.type;
        answer = String(e.error ?? '');
        continue;
      }
      if (!e.state) continue;
      maxStep = Math.max(maxStep, e.data?.step ?? 0);
      if (TERMINAL.has(e.state)) {
        outcome = cancelledAt ? `${e.state} (limit)` : e.state;
        answer = String(e.data?.details ?? '');
      }
    }
    if (!outcome && !cancelledAt && (Date.now() - started > MAX_MS || maxStep >= MAX_STEPS)) {
      cancelledAt = Date.now();
      await ctl.evaluate(() => window.__port.postMessage({ type: 'cancel_task' }));
    }
    if (!outcome && cancelledAt && Date.now() - cancelledAt > 15_000) outcome = 'limit (no cancel event)';
  }
  return { outcome, answer, maxStep, events, seconds: +((Date.now() - started) / 1000).toFixed(1) };
}

async function readTraces(ctl, taskId) {
  return ctl.evaluate(
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
          const request = db.transaction('records').objectStore('records').getAll();
          request.onsuccess = () => {
            db.close();
            resolve(request.result.filter(record => record.taskId === id));
          };
          request.onerror = () => reject(request.error);
        };
      }),
    taskId,
  );
}

/** True usage and tool-call health from `kind: 'llm'` trace records. */
function traceMetrics(records) {
  const llm = records.filter(r => r.kind === 'llm');
  const calls = llm.filter(r => r.level === 'info' && String(r.msg).startsWith('llm call'));
  const reasks = llm.filter(r => r.msg === 'tool call validation failed');
  const argumentIssue = /invalid arguments|unknown tool|not valid JSON/;
  const providerRejections = llm.filter(
    r => r.level === 'error' && /\b400\b|INVALID_ARGUMENT|schema/i.test(JSON.stringify(r.data ?? {})),
  );
  const sum = key => calls.reduce((total, r) => total + (r.data?.usage?.[key] ?? 0), 0);
  return {
    llmCalls: calls.length,
    reasks: reasks.length,
    schemaRejections:
      reasks.filter(r => argumentIssue.test(JSON.stringify(r.data?.issues ?? {}))).length + providerRejections.length,
    tokens: { input: sum('inputTokens'), output: sum('outputTokens'), cached: sum('cacheReadTokens'), reasoning: sum('reasoningTokens') },
  };
}

async function runTask(browser, ctl, task, runId, outDir) {
  const taskId = `${runId}-${task.id}`;
  await configure(ctl);

  const web = await browser.newPage();
  await web.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  await web.bringToFront();
  const tabId = await ctl.evaluate(async href => (await chrome.tabs.query({})).filter(t => t.url === href).at(-1)?.id, web.url());
  if (!tabId) throw new Error(`${task.id}: no tab found for ${web.url()}`);

  process.stdout.write(`${task.id} ${task.title} ... `);
  const run = await drive(ctl, { taskId, tabId, task: task.task });
  await sleep(2000); // let the trace sink flush its last batch

  const records = await readTraces(ctl, taskId);
  const pages = (await browser.pages()).filter(p => !p.url().startsWith('chrome-extension://'));
  await pages.at(-1)?.screenshot({ path: path.join(outDir, `${task.id}.png`) }).catch(() => {});

  const evalOn = async (urlPart, fn, ...args) => {
    const page = (await browser.pages()).filter(p => p.url().includes(urlPart)).at(-1);
    return page ? page.evaluate(fn, ...args) : undefined;
  };
  const activeTabUrl = () => ctl.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url);
  let check;
  try {
    const verdict = await task.check({ answer: run.answer, outcome: run.outcome, evalOn, activeTabUrl });
    check = typeof verdict === 'boolean' ? { pass: verdict, detail: '' } : verdict;
  } catch (error) {
    check = { pass: false, detail: `checker error: ${error.message}` };
  }

  fs.writeFileSync(path.join(outDir, `${task.id}.events.jsonl`), run.events.map(e => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(outDir, `${task.id}.trace.jsonl`), records.map(r => JSON.stringify(r)).join('\n'));
  for (const page of pages) await page.close().catch(() => {});

  const result = {
    id: task.id,
    title: task.title,
    pass: run.outcome === 'task.ok' && check.pass,
    outcome: run.outcome,
    answer: run.answer.slice(0, 400),
    detail: check.detail,
    steps: run.maxStep,
    seconds: run.seconds,
    ...traceMetrics(records),
  };
  console.log(`${result.pass ? 'PASS' : 'FAIL'} (${result.outcome}, ${result.seconds}s, ${result.llmCalls} calls)`);
  return result;
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error(`No build at ${DIST}; run pnpm build first`);
  const only = process.env.E2E_ONLY?.split(',').map(id => id.trim()).filter(Boolean);
  const tasks = only ? TASKS.filter(task => only.includes(task.id)) : TASKS;
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(HERE, 'results', runId);
  fs.mkdirSync(outDir, { recursive: true });

  // A fresh profile per run: Chromium keeps a cached service-worker script for a reused profile.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'webgenie-e2e-'));
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: process.env.E2E_HEADLESS ? true : false,
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1400,900',
    ],
  });

  try {
    const worker = await browser.waitForTarget(
      t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
      { timeout: 30_000 },
    );
    const extensionId = new URL(worker.url()).host;

    // The background only accepts ports from the exact side-panel URL. Connect after the page's own UI has
    // connected, so the background's current port is ours.
    const ctl = await browser.newPage();
    await ctl.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
    await sleep(2000);
    await ctl.evaluate(() => {
      window.__ev = [];
      const port = chrome.runtime.connect({ name: 'side-panel-connection' });
      port.onMessage.addListener(message => {
        if (message.screenshot) message.screenshot = '[omitted]';
        window.__ev.push(message);
      });
      port.onDisconnect.addListener(() => window.__ev.push({ type: 'port_disconnected' }));
      window.__port = port;
    });

    const results = [];
    for (const task of tasks) results.push(await runTask(browser, ctl, task, runId, outDir));

    const passed = results.filter(r => r.pass).length;
    const schemaRejections = results.reduce((n, r) => n + r.schemaRejections, 0);
    const totals = results.reduce(
      (t, r) => ({ input: t.input + r.tokens.input, output: t.output + r.tokens.output, cached: t.cached + r.tokens.cached }),
      { input: 0, output: 0, cached: 0 },
    );
    const minPass = only ? tasks.length : Number(process.env.E2E_MIN_PASS ?? 17);
    const summary = { runId, model: MODEL, passed, total: results.length, minPass, schemaRejections, tokens: totals, results };
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

    console.table(
      results.map(r => ({
        id: r.id,
        pass: r.pass,
        outcome: r.outcome,
        steps: r.steps,
        seconds: r.seconds,
        calls: r.llmCalls,
        reasks: r.reasks,
        rejections: r.schemaRejections,
        inputTokens: r.tokens.input,
        detail: r.pass ? '' : (r.detail || r.answer).slice(0, 80),
      })),
    );
    console.log(`${passed}/${results.length} passed (need ${minPass}); schema rejections: ${schemaRejections}; tokens in=${totals.input} out=${totals.output} cached=${totals.cached}`);
    console.log(`Results: ${outDir}`);
    process.exitCode = passed >= minPass && schemaRejections === 0 ? 0 : 1;
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`E2E FAILED: ${error.message}`);
  process.exitCode = 1;
});

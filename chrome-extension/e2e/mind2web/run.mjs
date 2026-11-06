// Runs Online-Mind2Web tasks on the live e2e harness (../run.mjs) and writes each task in WebJudge's input format.
// Scoring is a separate step: node e2e/mind2web/judge.mjs <runDir>.
//
//   pnpm build && node e2e/mind2web/run.mjs [--all] [--limit N] [--only <task_id>,<task_id>] [--level easy|medium|hard]
//   node e2e/mind2web/run.mjs --all --resume e2e/results/mind2web-<timestamp>   (continue an interrupted run)
//   Environment as for ../run.mjs: E2E_MODEL, E2E_PLANNER_MODEL, E2E_PROJECT, E2E_LOCATION, E2E_HEADLESS, CHROMIUM_PATH,
//   E2E_MEMORY=cold|warm (default cold: every task starts with no memory of earlier tasks)
//
// Tasks: the 60-task slice (slice.json) by default; --all runs every task in Online_Mind2Web.json. --resume reuses a run
// folder and skips tasks that already have a result, except harness errors and provider outages, which run again.
// Rules: the firewall denies common search engines, so the agent works from the task's website (the benchmark's rule);
// an order/payment confirmation is answered "No, stop here"; a request for personal details or a sign-in is answered that none are given; any other question is answered "Proceed with any
// reasonable choice." and counted; each task is capped at 50 steps, 2400 s and 500k input tokens. After navigator actions
// (act.ok/act.fail), once the page has loaded (at most 5 s) plus 1 s, and once more when the task ends, the tab the agent works in is screenshotted into <task_id>/trajectory/NN.png, at most 40 per task.
// Every task records what the model provider returned (calls, 429s, server and network errors, rate-limit waits). A task
// the provider ended (its last call failed on the provider's side, the agent paused for rate limits, or it ran out of
// time after two minutes or more of rate-limit waits) is recorded as provider_down and runs again on resume, at most
// three provider-ended attempts per task; step and token limits are always the agent's own outcome.
// A site that refuses this network is site_blocked and not scored: its start page answers 401/403/451 or shows a
// standard refusal page and still does 8 s later, or the task ends on a refusal page of its own site.
// --shard i/n runs every n-th selected task (from i), so n processes, each with its own browser, share one run folder.
// Results: e2e/results/mind2web-<timestamp>/<task_id>/{result.json,trajectory/,events.jsonl,trace.jsonl,timeline.txt};
// attempts.jsonl in the run folder keeps one line per attempt, including those a retry replaced.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { closeSession, launchSession, shootPage } from '../run.mjs';
import { measurementIntegrity, memoryMode, taskMetrics, timeline } from '../metrics.mjs';

const HERE = import.meta.dirname;
// E2E_DIST runs a saved copy of a build (e2e/builds/<commit>), so rounds on different builds do not disturb each other.
const DIST = path.resolve(process.env.E2E_DIST ?? path.join(HERE, '../../../dist'));
/** The commit the build was made from (dist/BUILD, written after pnpm build), recorded with every result. */
const BUILD = (() => {
  try {
    return fs.readFileSync(path.join(DIST, 'BUILD'), 'utf8').trim();
  } catch {
    return null;
  }
})();
const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com', 'search.yahoo.com'];
// 500k input tokens: on real sites a model call reads 7-15k tokens, so 150k stopped tasks near step 13 of 25.
// 1200 s: under project-wide Vertex rate limits (about half of all calls answered 429 with five workers) tasks spent most
// of 600 s waiting; steps and tokens bound the agent's effort, the clock only has to stop a hung task.
// 50 steps: at 25, most step-limit endings were still working (a whole run of 25 showed where the agent lacks only up to
// there); the 500k input-token cap stays. 2400 s so the extra steps fit under rate-limit waits.
/** The last commit that changed the harness, recorded with every result next to the build. */
const HARNESS_COMMIT = (() => {
  try {
    return (
      execFileSync('git', ['-C', HERE, 'log', '-1', '--format=%h', '--', '.', '../run.mjs', '../metrics.mjs'], {
        encoding: 'utf8',
      }).trim() || null
    );
  } catch {
    return null;
  }
})();
const LIMITS = { maxSteps: 50, maxMs: 2_400_000, maxInputTokens: 500_000 };
// Memory the agent carries from task to task: cold (the default) starts every task with none, warm keeps it.
const MEMORY = memoryMode();
/** Provider-ended attempts after which a task keeps the agent's own outcome (flagged providerAffected) instead of running again. */
const MAX_PROVIDER_ATTEMPTS = 3;
const MAX_SHOTS = 40;
// 5: a browser that has served several heavy sites holds on to renderer memory; a fresh one gives it back.
const TASKS_PER_BROWSER = 5;
const DECLINE = 'No, stop here';
const PROCEED = 'Proceed with any reasonable choice.';
const NO_PERSONAL_DATA =
  "I can't give personal or account details. Don't enter any or make them up: go as far as the task allows without them, then finish and say what is left.";
/** Outcomes that say nothing about the agent; a resumed run tries these tasks again. */
const RETRY_ON_RESUME = new Set(['harness_error', 'provider_down']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/** true once the promise settles successfully within ms, false on timeout or error. */
const within = (promise, ms) =>
  Promise.race([promise.then(() => true), sleep(ms).then(() => false)]).catch(() => false);

/** Whether this machine reaches the internet at all: a tiny always-up endpoint, or the model provider's host. */
async function online() {
  for (const url of ['https://www.gstatic.com/generate_204', 'https://aiplatform.googleapis.com/']) {
    try {
      await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      return true;
    } catch {
      // try the next one
    }
  }
  return false;
}

/** Waits before a task while the machine is offline (a laptop's network dropped for twenty minutes during a round). */
async function waitForNetwork() {
  for (let waited = 0; !(await online()); waited += 30) {
    if (waited % 600 === 0) console.log('(waiting for the network before the next task)');
    await sleep(30_000);
  }
}

/**
 * True when the network dropped at any moment since the last call. A task that ran through an outage says nothing about the
 * agent (its pages failed to load, its model calls timed out), so the loop records it as harness_error and runs it again
 * on resume instead of scoring it.
 */
let droppedSince = false;
let failedProbes = 0;
setInterval(async () => {
  // One failed probe is a busy machine or a slow reply; two in a row is an outage.
  failedProbes = (await online()) ? 0 : failedProbes + 1;
  if (failedProbes >= 2) droppedSince = true;
}, 15_000).unref();
const networkDropped = () => {
  const dropped = droppedSince;
  droppedSince = false;
  return dropped;
};

/** RAM available and swap free in MB, from /proc/meminfo; null where it does not exist. */
function freeMemoryMb() {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const mb = key => Math.round(Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(info)?.[1] ?? 0) / 1024);
    return { available: mb('MemAvailable'), swapFree: mb('SwapFree') };
  } catch {
    return null;
  }
}

/** Too little memory to start a browser task: little RAM left, or swap nearly full while RAM is not plentiful. */
const memoryShort = free => free.available < 1500 || (free.swapFree < 800 && free.available < 4000);

/**
 * Waits before a task while the machine is short of memory. Other programs grow during a long run (an Android emulator
 * and a Flutter build took about 6 GB): starting another heavy page then drove swap to 73 MB, and the kernel would have
 * killed the largest process, the user's emulator.
 */
async function waitForMemory() {
  for (let waited = 0; ; waited += 60) {
    const free = freeMemoryMb();
    if (!free || !memoryShort(free)) return;
    if (waited % 600 === 0)
      console.log(
        `(waiting for memory before the next task: ${free.available} MB available, ${free.swapFree} MB swap free)`,
      );
    await sleep(60_000);
  }
}

/** The system's own commit confirmation, or a question that asks to confirm an order or a payment. */
const isOrderConfirmation = question =>
  /^Confirm before I continue:/.test(question) ||
  (/\b(confirm|should I|shall I|do you want|proceed)\b/i.test(question) &&
    /\b(order|pay|payment|purchase|checkout|buy|book|reserve|subscribe)/i.test(question));

/** A question asking for the user's own details or credentials, which the benchmark never provides. */
const asksPersonalData = question =>
  /\b(your|my|the user's)\b[^?.]{0,60}\b(name|e-?mail|phone|mobile|address|zip|postcode|postal code|date of birth|birthday|card|password|username|login|account|passport|credentials)\b|\b(log ?in|sign ?in|password|credentials|contact details|personal (?:details|information))\b/i.test(
    question,
  );

/** drive() answers scripted questions in order and tests each script's `expect` first; recording the question there
 *  lets one script pick its answer by question. */
function responder() {
  const script = {
    question: '',
    expect: { test: question => ((script.question = question), true) },
    get answer() {
      return isOrderConfirmation(script.question)
        ? DECLINE
        : asksPersonalData(script.question)
          ? NO_PERSONAL_DATA
          : PROCEED;
    },
  };
  return script;
}

/**
 * Page actions in order, then the agent's answer the way Online-Mind2Web v1 agents record it ("TASK_COMPLETE -> ANSWER:"
 * as the last action), which is where WebJudge reads it. Without it a correct answer to an information task was judged a
 * failure for "not displaying" what the agent had reported.
 */
function actionHistory(events) {
  const history = [];
  let started = '';
  let answer = '';
  for (const e of events) {
    if (e.state === 'act.start') started = String(e.data?.details ?? '');
    if (started === 'done') {
      if (e.state === 'act.ok') answer = String(e.data?.details ?? '');
      continue;
    }
    if (e.state === 'act.ok') history.push(String(e.data?.details || started));
    if (e.state === 'act.fail') history.push(`${started} -> FAILED: ${e.data?.details ?? ''}`);
  }
  if (answer) history.push(`TASK_COMPLETE -> ANSWER: ${answer}`);
  return history;
}

/** What the model provider returned during a task, from the trace's llm records. */
function providerStats(records) {
  const stats = {
    calls: 0,
    failed: 0,
    rateLimited: 0,
    serverError: 0,
    timeout: 0,
    network: 0,
    auth: 0,
    other: 0,
    rateLimitWaitMs: 0,
    lastCallFailedOnProvider: false,
  };
  for (const r of records) {
    if (r.kind !== 'llm') continue;
    const wait = /rate limited; retrying in ([\d.]+)s/.exec(r.msg ?? '');
    if (wait) stats.rateLimitWaitMs += Math.round(Number(wait[1]) * 1000);
    if (!/^llm call/.test(r.msg ?? '') || /superseded/.test(r.msg)) continue;
    stats.calls++;
    if (!r.data?.error) {
      stats.lastCallFailedOnProvider = false;
      continue;
    }
    stats.failed++;
    // The message only: a stack trace's line numbers (":512:") read as 5xx statuses and inflated server errors.
    const error = r.data.error;
    const text = `${r.msg} ${typeof error === 'string' ? error : (error.message ?? JSON.stringify(error))}`;
    const kind = /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(text)
      ? 'rateLimited'
      : /timed out|timeout|DEADLINE_EXCEEDED/i.test(text)
        ? 'timeout'
        : /Failed to fetch|unreachable|network|ERR_|ECONN/i.test(text)
          ? 'network'
          : /\b401\b|invalid authentication|UNAUTHENTICATED/i.test(text)
            ? 'auth'
            : /status code 5\d\d|\b50[0-4]\b|UNAVAILABLE|INTERNAL|overloaded/i.test(text)
              ? 'serverError'
              : 'other';
    stats[kind]++;
    stats.lastCallFailedOnProvider = kind !== 'other';
  }
  return stats;
}

/**
 * The provider ended the task: its last call failed on the provider's side, the agent paused itself for rate limits or an
 * unreachable provider, or it ran out of time after two minutes or more of rate-limit waits. Not a verdict on the agent.
 * Step and token limits and the agent's own failure are verdicts however long it waited: waiting spends neither.
 */
const heldBackByProvider = (outcome, provider, events) =>
  outcome !== 'task.ok' &&
  outcome !== 'limit_steps' &&
  outcome !== 'limit_tokens' &&
  (provider.lastCallFailedOnProvider ||
    events.some(e => e.state === 'task.pause' && /model provider/i.test(String(e.data?.details ?? ''))) ||
    (outcome === 'limit_time' && provider.rateLimitWaitMs >= 120_000));

/** Standard refusal pages: a CDN's "Access Denied", a bot check that has not cleared, a country block. */
const REFUSAL_TEXT =
  /access denied|you don't have permission to access|performing security verification|(?:verif(?:y|ies)|confirm) (?:that )?you(?: are|'re) (?:not a (?:ro)?bot|(?:a )?human)|just a moment\.\.\.|not available in your (?:area|country|region)|coming from a country|the request could not be satisfied|unusual traffic|i'?m not a robot|press (?:&|and) hold|complete the captcha|captcha to continue/i;

/** The refusal a short page shows, or null; a normal page that mentions such words is longer. */
function refusalText(title, text) {
  if (text.length >= 3000) return null;
  return REFUSAL_TEXT.exec(`${title}\n${text}`)?.[0] ?? null;
}

/** Two hosts of one site (www.ign.com and in.ign.com). ponytail: last two labels, too broad for co.uk-style domains. */
const sameSite = (a, b) => a.split('.').slice(-2).join('.') === b.split('.').slice(-2).join('.');

/** A refusal page of the task's own site in this tab, as `host "text" (title)`, or null. */
async function refusalPage(page, siteHost) {
  const read = page.evaluate(() => ({
    href: location.href,
    title: document.title,
    text: (document.body?.innerText ?? '').slice(0, 4000),
  }));
  const info = await Promise.race([read, sleep(5000).then(() => null)]).catch(() => null);
  if (!info) return null;
  let pageHost;
  try {
    pageHost = new URL(info.href).hostname;
  } catch {
    return null;
  }
  const refusal = sameSite(pageHost, siteHost) ? refusalText(info.title, info.text) : null;
  return refusal ? `${pageHost} "${refusal}"${info.title ? ` (${info.title.slice(0, 60)})` : ''}` : null;
}

/** Statuses a site answers when it refuses this network rather than being down. */
const isRefusal = status => status === 401 || status === 403 || status === 451;

/** Attempts of a task the provider ended so far, from attempts.jsonl. */
function providerAttempts(runDir, taskId) {
  try {
    return fs
      .readFileSync(path.join(runDir, 'attempts.jsonl'), 'utf8')
      .split('\n')
      .filter(line => line.includes(`"task_id":"${taskId}"`) && line.includes('"outcome":"provider_down"')).length;
  } catch {
    return 0;
  }
}

/**
 * A saved provider_down result the current rule does not blame on the provider, or that already had its
 * MAX_PROVIDER_ATTEMPTS, keeps the agent's own outcome. (An earlier rule also re-ran failures that had merely waited a
 * minute on rate limits, including tasks that reached the step limit.)
 */
function reclassified(runDir, task, saved) {
  if (saved?.outcome !== 'provider_down' || !saved.agentOutcome || !saved.provider) return saved;
  let events = [];
  try {
    events = fs
      .readFileSync(path.join(runDir, task.task_id, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    // no events: judged on the provider numbers alone
  }
  const blamed = heldBackByProvider(saved.agentOutcome, saved.provider, events);
  if (blamed && providerAttempts(runDir, task.task_id) < MAX_PROVIDER_ATTEMPTS) return saved;
  const { agentOutcome, detail: _detail, ...rest } = saved;
  return writeResult(runDir, task, {
    ...rest,
    outcome: agentOutcome,
    reclassifiedFrom: 'provider_down',
    ...(blamed ? { providerAffected: true } : {}),
  });
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
    build: BUILD,
    harness: {
      commit: HARNESS_COMMIT,
      limits: LIMITS,
      model: process.env.E2E_MODEL ?? 'gemini-2.5-flash',
      plannerModel: process.env.E2E_PLANNER_MODEL ?? process.env.E2E_MODEL ?? 'gemini-2.5-flash',
      location: process.env.E2E_LOCATION ?? 'global',
      lang: process.env.E2E_LANG ?? null,
      timeZone: process.env.E2E_TZ ?? null,
      memory: MEMORY,
    },
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

/**
 * The tab the agent works in: the agent makes its tab active when it opens or switches to one, while the newest tab can
 * be one a link opened in the background (a task's screenshots showed a privacy-policy tab for 14 steps).
 */
async function agentPage(harness) {
  const pages = await harness.webPages();
  // The tab the agent drives is the one it has the debugger attached to. Asking which tab is *active* instead put a
  // task's whole trajectory on the page the agent had left: it worked in a second tab and every screenshot showed the
  // first. Activity is the fallback, for the moment before the debugger attaches.
  const url = await harness.ctl
    .evaluate(async () => {
      const targets = await new Promise(resolve => chrome.debugger.getTargets(resolve));
      const attached = targets.filter(target => target.attached && target.type === 'page' && target.tabId !== undefined);
      if (attached.length > 0) return attached.at(-1).url;
      return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url;
    })
    .catch(() => null);
  return pages.filter(page => page.url() === url).at(-1) ?? pages.at(-1);
}

async function runTask(harness, task, runId, runDir) {
  const taskId = `${runId}-${task.task_id}`;
  const dir = path.join(runDir, task.task_id);
  // A retry starts clean; the earlier attempt's logs move to .attempts/<task_id>/<time> instead of being deleted.
  if (fs.existsSync(dir)) {
    const archive = path.join(runDir, '.attempts', task.task_id);
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(dir, path.join(archive, new Date().toISOString().replace(/[:.]/g, '-')));
  }
  fs.mkdirSync(path.join(dir, 'trajectory'), { recursive: true });

  await harness.ensureControl();
  // A cold task starts with an empty memory store: what one task learns must not decide the next one's score.
  if (MEMORY === 'cold') await harness.clearMemory();
  const host = new URL(task.website).hostname;
  await harness.clearOrigins([new URL(task.website).origin]);
  await harness.configure(taskId, task.confirmed_task.slice(0, 60), {
    // A task whose own website is on a search engine's domain keeps that domain reachable.
    'firewall-settings': {
      enabled: true,
      allowList: [],
      denyList: SEARCH_ENGINES.filter(domain => host !== domain && !host.endsWith(`.${domain}`)),
    },
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
  let nav = await web.goto(task.website, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(error => error);
  // ponytail: one navigation decides site_down (network error or 5xx); a bot wall that answers 5xx is counted as down too.
  const down =
    nav instanceof Error
      ? /net::ERR_/.test(nav.message)
        ? nav.message
        : null
      : nav && nav.status() >= 500
        ? `HTTP ${nav.status()}`
        : null;
  if (down) {
    await web.close().catch(() => {});
    // Offline is this machine, not the site: round 1 recorded 61 tasks site_down with ERR_INTERNET_DISCONNECTED while the
    // laptop's network was gone. Such a task is a harness error and runs again.
    if (!(await online())) return writeResult(runDir, task, { outcome: 'harness_error', detail: `offline: ${down}` });
    return writeResult(runDir, task, { outcome: 'site_down', detail: down });
  }
  // The navigation "succeeded" into the browser's own error page (the site refused or reset the connection): there is no
  // site to work on, and looking up the tab by that address failed as a harness error on every retry.
  if (web.url().startsWith('chrome-error://')) {
    await web.close().catch(() => {});
    if (!(await online()))
      return writeResult(runDir, task, {
        outcome: 'harness_error',
        detail: 'offline: the start page showed the browser error page',
      });
    return writeResult(runDir, task, {
      outcome: 'site_down',
      detail: 'the start page showed the browser error page (the site refused or reset the connection)',
    });
  }
  // A site that refuses this network on its own start page ("Access Denied", a country block, a bot check) cannot be
  // measured from here: 7 of 23 judged "successes" were honest reports of such a block, scored as failures. A check that
  // clears by itself in a real browser gets a few seconds and a reload first.
  const startStatus = nav instanceof Error ? null : (nav?.status() ?? null);
  if (isRefusal(startStatus)) {
    await sleep(8000);
    nav = await web.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(error => error);
    const again = nav instanceof Error ? null : (nav?.status() ?? null);
    if (isRefusal(again)) {
      const title = await web.title().catch(() => '');
      await web.close().catch(() => {});
      return writeResult(runDir, task, {
        outcome: 'site_blocked',
        detail: `HTTP ${again} on the start page twice${title ? ` ("${title.slice(0, 80)}")` : ''}`,
        startStatus,
      });
    }
  }
  // The same refusal served with status 200 (Akamai "Access Denied" on a store's start page) is read from the page.
  if (await refusalPage(web, host)) {
    await sleep(8000);
    const still = await refusalPage(web, host);
    if (still) {
      await web.close().catch(() => {});
      return writeResult(runDir, task, {
        outcome: 'site_blocked',
        detail: `refusal page at the start, still there 8 s later: ${still}`,
        startStatus,
      });
    }
  }
  // Cosmetic: a closed or detached session must not end a task (two rounds lost tasks to exactly this).
  await web.bringToFront().catch(() => {});
  const tabId = await harness.ctl.evaluate(
    async href => (await chrome.tabs.query({})).filter(t => t.url === href).at(-1)?.id,
    web.url(),
  );
  if (!tabId) throw new Error(`no tab found for ${web.url()}`);

  const screenshots = [];
  let driving = true;
  // At the cap the newest screenshot replaces the last one, so the page the task ended on is always kept.
  const shoot = async () => {
    const full = screenshots.length >= MAX_SHOTS;
    const name = full ? screenshots.at(-1) : `${String(screenshots.length).padStart(2, '0')}.png`;
    const page = await agentPage(harness);
    if (!page) return;
    // Right after an action the page is often still loading (a skeleton list, a blank body): wait for the load and a
    // moment of rendering, bounded, so the screenshot shows what the action produced.
    await within(
      page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }),
      5500,
    );
    await sleep(1000);
    if ((await within(shootPage(page, { path: path.join(dir, 'trajectory', name) }), 10_000)) && !full)
      screenshots.push(name);
  };
  // A site that starts refusing mid-task used to be found only when the task ended: one round spent 8,074 s and
  // 3.29M tokens on sites that had already shut the door. Two consecutive refusal reads stop the task there.
  let blockedDuring = null;
  const shooter = (async () => {
    let seen = 0;
    let refusals = 0;
    for (;;) {
      await sleep(500);
      const stopping = !driving;
      const acts = await harness.ctl.evaluate(() => window.__acts).catch(() => seen);
      if (acts > seen) {
        seen = acts;
        await shoot();
        const page = await agentPage(harness);
        const refusal = page ? await refusalPage(page, host).catch(() => null) : null;
        refusals = refusal ? refusals + 1 : 0;
        if (refusal && refusals >= 2 && !blockedDuring) {
          blockedDuring = refusal;
          await harness.post({ type: 'cancel_task', taskId, tabId }).catch(() => {});
        }
      }
      if (stopping) break;
    }
  })().catch(() => {});

  let run;
  try {
    run = await harness.drive({
      taskId,
      tabId,
      task: task.confirmed_task,
      ...LIMITS,
      allowHuman: false,
      human: Array(50).fill(responder()),
      page: web,
    });
  } finally {
    driving = false;
  }
  await shooter;
  // The page the answer was read from, after the last action has settled.
  await shoot().catch(() => {});
  await sleep(900); // the trace sink flushes every 500 ms

  const records = await harness.readTraces(taskId).catch(() => []);
  const metrics = taskMetrics(records, run.events, { taskText: task.confirmed_task });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), run.events.map(e => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(dir, 'trace.jsonl'), records.map(r => JSON.stringify(r)).join('\n'));
  fs.writeFileSync(path.join(dir, 'timeline.txt'), timeline(records, run.events));
  // A task that ends on a refusal page of its own site was refused on the way (a car site served "Access Denied" after its
  // start page had loaded): not measurable from this network either.
  const lastPage = await agentPage(harness);
  const refusedAtEnd = blockedDuring ?? (lastPage ? await refusalPage(lastPage, host) : null);
  for (const page of await harness.webPages()) await page.close().catch(() => {});

  const provider = providerStats(records);
  const blamed = heldBackByProvider(run.outcome, provider, run.events);
  // The last allowed attempt keeps the agent's outcome, flagged, rather than running again.
  const providerDown = blamed && providerAttempts(runDir, task.task_id) + 1 < MAX_PROVIDER_ATTEMPTS;

  const declined = run.questions.filter(isOrderConfirmation).length;
  return writeResult(runDir, task, {
    final_result_response: run.answer,
    action_history: actionHistory(run.events),
    screenshots,
    outcome: refusedAtEnd ? 'site_blocked' : providerDown ? 'provider_down' : run.outcome,
    ...(refusedAtEnd
      ? { detail: `the site refused access during the task: ${refusedAtEnd}`, agentOutcome: run.outcome }
      : providerDown
        ? { detail: `ended as ${run.outcome}; held back by the model provider`, agentOutcome: run.outcome }
        : {}),
    ...(blamed && !providerDown ? { providerAffected: true } : {}),
    provider,
    startStatus,
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
  const system =
    'Confirm before I continue: "Place order" on shop.example/checkout (amount shown: $40.00). This may place an order, make a payment, or change an account or your data. Should I do it?';
  assert(isOrderConfirmation(system), 'system confirmation');
  assert(isOrderConfirmation('Should I proceed to checkout and pay $12?'), 'navigator payment confirmation');
  assert(!isOrderConfirmation('Which size do you want, M or L?'), 'plain question');
  assert(!isOrderConfirmation('Please provide your username and password to log in.'), 'login question');
  const script = Array(50).fill(responder());
  assert(script[0].expect.test(system) && script[0].answer === DECLINE, 'declines an order');
  assert(script[1].expect.test('Which colour?') && script[1].answer === PROCEED, 'proceeds otherwise');
  assert(
    script[2].expect.test('Please provide your phone number and email to continue.') &&
      script[2].answer === NO_PERSONAL_DATA,
    'no personal data',
  );
  assert(
    script[3].expect.test('Should I sign in to see the price?') && script[3].answer === NO_PERSONAL_DATA,
    'no sign-in',
  );
  assert(!asksPersonalData('Which delivery date do you prefer?'), 'plain choice is not personal data');
  assert(refusalText('', 'Please confirm you are human to continue'), 'human check wording');
  const events = [
    { state: 'act.start', data: { details: 'Click element with index 6' } },
    { state: 'act.ok', data: { details: 'Clicked button with index 6: Search' } },
    { state: 'act.start', data: { details: 'Input text into index 3' } },
    { state: 'act.fail', data: { details: 'Input read-back did not match requested text.' } },
    { state: 'act.start', data: { details: 'done' } },
    { state: 'act.ok', data: { details: 'The cheapest is $19.' } },
  ];
  const history = actionHistory(events);
  assert(
    history.length === 3 &&
      history[0] === 'Clicked button with index 6: Search' &&
      history[1].startsWith('Input text into index 3 -> FAILED') &&
      history[2] === 'TASK_COMPLETE -> ANSWER: The cheapest is $19.',
    `history ${JSON.stringify(history)}`,
  );
  const llm = (msg, error) => ({ kind: 'llm', msg, data: error ? { error: { message: error } } : {} });
  const limited = providerStats([
    llm('llm call gemini-2.5-flash failed', 'Google request failed with status code 429: RESOURCE_EXHAUSTED'),
    { kind: 'llm', msg: 'rate limited; retrying in 16.9s' },
    llm('llm call gemini-2.5-flash'),
    llm('llm call gemini-2.5-flash superseded', 'AbortError'),
    llm('llm call gemini-2.5-flash failed', 'status code 503 UNAVAILABLE'),
  ]);
  assert(
    limited.calls === 3 && limited.rateLimited === 1 && limited.serverError === 1 && limited.rateLimitWaitMs === 16_900,
    `stats ${JSON.stringify(limited)}`,
  );
  // A live timeout: its stack's line numbers (":512:") once counted as a 5xx.
  const slow = providerStats([
    {
      kind: 'llm',
      msg: 'llm call gemini-2.5-flash failed',
      data: {
        error: {
          name: 'Error',
          message: 'LLM call timed out after 25000ms',
          stack:
            'Error: LLM call timed out after 25000ms\n    at wK (chrome-extension://x/background.iife.js:512:3021)',
        },
      },
    },
  ]);
  assert(
    slow.timeout === 1 && slow.serverError === 0 && slow.lastCallFailedOnProvider,
    `timeout ${JSON.stringify(slow)}`,
  );
  assert(heldBackByProvider('limit_time', limited, []), 'last call failed on the provider');
  assert(!heldBackByProvider('task.ok', limited, []), 'a success stays a success');
  assert(!heldBackByProvider('limit_steps', limited, []), 'the step limit is the agent’s');
  const agentSide = providerStats([
    llm('llm call x failed', 'status code 400: invalid tool schema'),
    llm('llm call x'),
  ]);
  assert(!heldBackByProvider('task.fail', agentSide, []), 'an agent-side failure is not the provider');
  assert(
    heldBackByProvider('limit_time', agentSide, [
      { state: 'task.pause', data: { details: 'The model provider kept rate-limiting requests.' } },
    ]),
    'rate-limit pause',
  );
  const waited = { ...agentSide, rateLimitWaitMs: 300_000 };
  assert(!heldBackByProvider('task.fail', waited, []), 'waiting does not make the agent’s own failure the provider’s');
  assert(
    heldBackByProvider('limit_time', waited, []) &&
      !heldBackByProvider('limit_time', { ...waited, rateLimitWaitMs: 60_000 }, []),
    'out of time after long waits',
  );
  assert(
    isRefusal(403) && isRefusal(451) && isRefusal(401) && !isRefusal(200) && !isRefusal(404) && !isRefusal(null),
    'refusal statuses',
  );
  // Texts from live refusal pages: Akamai with status 200, a Cloudflare check, a country block.
  assert(
    refusalText(
      'marriott.com/default.mi',
      `# Access Denied\nYou don't have permission to access "http://www.marriott.com/default.mi" on this server.`,
    ),
    'Akamai page',
  );
  assert(
    refusalText(
      'Just a moment...',
      'Performing security verification\nThis page is displayed while the website verifies you are not a bot.',
    ),
    'bot check',
  );
  assert(
    refusalText('Sorry…', 'Sorry, this request is coming from a country which we currently do not support.'),
    'country block',
  );
  // Verification challenges that ended round 1 tasks recorded as task.ok.
  assert(
    refusalText('', 'Our systems have detected unusual traffic from your computer network.') &&
      refusalText('Human verification', 'Press & Hold to confirm you are a human (and not a bot).'),
    'challenge pages',
  );
  assert(
    !refusalText('Help center', `If you see access denied, sign in again. ${'Help text. '.repeat(300)}`),
    'a long page that mentions it',
  );
  assert(!refusalText('Used cars', 'Browse used cars by make and model.'), 'a normal page');
  assert(sameSite('in.ign.com', 'www.ign.com') && !sameSite('www.google.com', 'www.ign.com'), 'same site');
  // Readings from this run: stable with an emulator open, then swap nearly gone with RAM still "available" as cache.
  assert(!memoryShort({ available: 2600, swapFree: 2700 }), 'stable machine');
  assert(
    memoryShort({ available: 3600, swapFree: 73 }) && memoryShort({ available: 1200, swapFree: 5000 }),
    'short of memory',
  );
  assert(!memoryShort({ available: 8000, swapFree: 300 }), 'idle pages in swap with plenty of RAM');
  console.log('self-check ok');
}

async function main() {
  const { values: opts } = parseArgs({
    options: {
      all: { type: 'boolean' },
      resume: { type: 'string' },
      limit: { type: 'string' },
      only: { type: 'string' },
      level: { type: 'string' },
      shard: { type: 'string' },
      'self-check': { type: 'boolean' },
    },
  });
  const [shardIndex, shardCount] = (opts.shard ?? '0/1').split('/').map(Number);
  if (!(shardCount >= 1 && shardIndex >= 0 && shardIndex < shardCount))
    throw new Error(`--shard wants i/n with 0 <= i < n, got ${opts.shard}`);
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
  const only = opts.only
    ?.split(',')
    .map(id => id.trim())
    .filter(Boolean);
  const tasks = pool
    .filter(t => (!only || only.includes(t.task_id)) && (!opts.level || t.level === opts.level))
    .slice(0, opts.limit ? Number(opts.limit) : undefined);
  if (tasks.length === 0) throw new Error('no tasks selected');

  const runDir = opts.resume
    ? path.resolve(opts.resume)
    : path.join(HERE, '..', 'results', `mind2web-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const runId = path.basename(runDir);
  fs.mkdirSync(runDir, { recursive: true });
  const mine = tasks.filter((_, n) => n % shardCount === shardIndex);
  const todo = mine.filter(task => {
    const saved = reclassified(runDir, task, savedResult(runDir, task));
    return !saved || RETRY_ON_RESUME.has(saved.outcome);
  });
  const shardLabel = shardCount > 1 ? ` (shard ${shardIndex}/${shardCount}: ${mine.length} tasks)` : '';
  console.log(
    `${tasks.length} tasks selected${shardLabel}, ${mine.length - todo.length} already done, ${todo.length} to run on Vertex ${process.env.E2E_LOCATION ?? 'global'} with build ${BUILD ?? 'unknown'} (${DIST}) -> ${runDir}`,
  );

  let session = await launchSession(null);
  let inSession = 0;
  let providerStreak = 0;
  try {
    for (const [n, task] of todo.entries()) {
      if (inSession >= TASKS_PER_BROWSER) {
        await closeSession(session);
        session = await launchSession(null);
        inSession = 0;
      }
      await waitForMemory();
      await waitForNetwork();
      networkDropped(); // the wait above is not part of the task
      process.stdout.write(
        `[${n + 1}/${todo.length}] ${task.task_id} [${task.level}] ${task.confirmed_task.slice(0, 70)} ... `,
      );
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
      if (networkDropped() && result.outcome !== 'harness_error') {
        const was = result.outcome;
        result = writeResult(runDir, task, { outcome: 'harness_error', detail: `the network dropped during the task (it ended as ${was})` });
        console.log(`(network dropped during the task; recorded as harness_error, runs again on resume)`);
      }
      const p = result.provider;
      const vertex = p
        ? `, vertex ${p.calls} calls ${p.failed} failed (429 ${p.rateLimited}, 5xx ${p.serverError}, timeout ${p.timeout ?? 0}, net ${p.network}, auth ${p.auth}), rate-limit wait ${Math.round(p.rateLimitWaitMs / 1000)}s`
        : '';
      console.log(
        `${result.outcome}${result.agentOutcome ? ` [agent: ${result.agentOutcome}]` : ''} (${result.seconds ?? 0}s, ${result.steps ?? 0} steps, ${result.metrics?.tokens.input ?? 0} input tokens, ${result.screenshots.length} shots${vertex})`,
      );
      // One line per attempt, across processes (small appends are atomic): a retry replaces the task folder, not this log.
      fs.appendFileSync(
        path.join(runDir, 'attempts.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), build: BUILD, shard: opts.shard ?? null, location: process.env.E2E_LOCATION ?? 'global', task_id: task.task_id, outcome: result.outcome, agentOutcome: result.agentOutcome, detail: result.detail, seconds: result.seconds, steps: result.steps, inputTokens: result.metrics?.tokens.input, provider: p })}\n`,
      );
      // The provider is struggling: back off before the next task instead of spending it too.
      if (result.outcome === 'provider_down') {
        const pause = Math.min(300, 60 * ++providerStreak);
        console.log(`model provider trouble (${providerStreak} in a row); waiting ${pause}s before the next task`);
        await sleep(pause * 1000);
      } else {
        providerStreak = 0;
      }
    }
  } finally {
    await closeSession(session);
  }

  // The summary covers every selected task with a result in the folder, including those from earlier, resumed sessions.
  // Every task of the dataset, not only this selection: an --only re-run must not shrink the round's summary.
  const results = pool.map(task => savedResult(runDir, task)).filter(Boolean);
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
  // Parallel shards each write it: write whole and rename, so a reader never sees half a file.
  const summaryTmp = path.join(runDir, `summary.json.${process.pid}.tmp`);
  fs.writeFileSync(
    summaryTmp,
    `${JSON.stringify(
      {
        runId,
        model,
        plannerModel: process.env.E2E_PLANNER_MODEL ?? model,
        source,
        limits: LIMITS,
        integrity: measurementIntegrity(results, {
          model,
          plannerModel: process.env.E2E_PLANNER_MODEL ?? model,
          region: process.env.E2E_LOCATION ?? 'global',
          lang: process.env.E2E_LANG ?? null,
          timeZone: process.env.E2E_TZ ?? null,
          memory: MEMORY,
        }),
        results: rows,
      },
      null,
      2,
    )}\n`,
  );
  fs.renameSync(summaryTmp, path.join(runDir, 'summary.json'));
  const outcomes = {};
  for (const row of rows) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  const cost = rows.reduce((n, r) => n + (r.costUsd ?? 0), 0);
  const tokens = rows.reduce((n, r) => n + (r.inputTokens ?? 0), 0);
  console.log(
    `${rows.length} of ${tasks.length} tasks have results ${JSON.stringify(outcomes)}, ${tokens} input tokens, estimated cost $${cost.toFixed(2)}. Not scored yet.`,
  );
  console.log(`Results: ${runDir}\nJudge:   node e2e/mind2web/judge.mjs ${runDir}`);
}

// Puppeteer attaches to pages a site opens in the background; a timeout there ("Page.enable timed out") rejected with
// nothing awaiting it and ended the whole worker, losing its task. The task's own awaited calls still fail and are retried
// as harness errors. Anything else still ends the process.
process.on('unhandledRejection', error => {
  if (['ProtocolError', 'TargetCloseError'].includes(error?.name)) {
    console.log(`(background browser error ignored: ${error.message})`);
    return;
  }
  throw error;
});

main().catch(error => {
  console.error(`MIND2WEB RUN FAILED: ${error.message}`);
  process.exitCode = 1;
});

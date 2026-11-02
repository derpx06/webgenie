// The first run a new user has, on a fresh profile with nothing pre-seeded (the suites seed settings and consent):
//   no key -> welcome screen; save a key -> both roles get a model; the notice gates the agent until it is accepted, and
//   the background refuses a task before that.
//   node e2e/firstrun.mjs [dist]        (default ../dist; pass an unpacked release zip to test what ships)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const DIST = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../../dist'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-firstrun-'));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  userDataDir: profile,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox'],
});
try {
  const worker = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().includes('background'), { timeout: 20000 });
  const id = new URL(worker.url()).host;
  const open = async page => {
    const tab = await browser.newPage();
    await tab.goto(`chrome-extension://${id}/${page}`, { waitUntil: 'networkidle0' });
    return tab;
  };
  const bodyText = tab => tab.evaluate(() => document.body.innerText);
  const stored = tab => tab.evaluate(() => chrome.storage.local.get(null));

  const panel = await open('side-panel/index.html');
  check('no key: the panel shows the welcome screen', /Welcome to WebGenie/.test(await bodyText(panel)));

  const options = await open('options/index.html');
  check('options shows the real version, not a hard-coded one', (await bodyText(options)).toLowerCase().includes(`v${JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'))).version}`));
  await options.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Models').click());
  await sleep(500);
  await options.click('button[title="Add New Provider"]');
  await sleep(500);
  await options.evaluate(() => {
    [...document.querySelectorAll('button')].find(el => el.querySelector('span')?.textContent.trim() === 'OpenAI')?.click();
  });
  await sleep(800);
  // The new card is collapsed under its name; opening it reveals the key field.
  await options.click('[role=button][aria-label^="Toggle "]');
  await sleep(600);
  const keyInput = await options.$('input[id$="-api-key"]');
  check('adding a provider offers an API key field', !!keyInput);
  await keyInput.type('sk-firstrun-not-a-real-key');
  await options.evaluate(() => [...document.querySelectorAll('button')].find(b => /^save$/i.test(b.innerText.trim()))?.click());
  await sleep(1500);

  const afterSave = await stored(options);
  const models = Object.entries(afterSave).filter(([key]) => /agent-model/i.test(key));
  const roles = models.flatMap(([, value]) => Object.keys(value?.agents ?? value ?? {}));
  check('saving a key assigns a model to both roles', roles.includes('planner') && roles.includes('navigator'), `roles=${roles.join(',') || 'none'}`);

  // The panel is told by the same storage, so it moves on from the welcome screen to the notice.
  await panel.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  const gated = await bodyText(panel);
  check('with a key but before accepting: the notice is shown, not the composer', /sends|notice|before you start|accept/i.test(gated) && !(await panel.$('textarea')), gated.replace(/\s+/g, ' ').slice(0, 80));

  // The background refuses a task until the notice is accepted, whatever the panel does.
  const refused = await panel.evaluate(
    () =>
      new Promise(resolve => {
        const port = chrome.runtime.connect({ name: 'side-panel-connection' });
        const seen = [];
        port.onMessage.addListener(m => seen.push(m));
        port.postMessage({ type: 'new_task', task: 'say hello', taskId: 'firstrun-1', tabId: 1 });
        setTimeout(() => resolve(seen.map(m => JSON.stringify(m).slice(0, 160))), 2500);
      }),
  );
  check('the background refuses a task before the notice is accepted', refused.some(m => /error|disclos|accept|notice/i.test(m)) && !refused.some(m => /act\.|step\.start|task\.start/i.test(m)), refused[0] ?? 'no reply');

  // Accepting is remembered.
  await panel.evaluate(() => [...document.querySelectorAll('button')].find(b => /accept|agree|understand|continue/i.test(b.innerText))?.click());
  await sleep(800);
  const settings = (await stored(options))['general-settings'];
  check('accepting the notice is stored', typeof settings?.dataDisclosureAcceptedAt === 'number');
  await panel.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  check('after accepting: the composer is available', !!(await panel.$('textarea')));
} finally {
  await browser.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(checks.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exitCode = checks.every(Boolean) ? 0 : 1;

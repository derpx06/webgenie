# Production readiness — WebGenie, re-verified

Read-only re-audit of the working tree at `ada968b` (branch `main`, clean), version `0.1.13`,
on 2026-10-16. Every row below was checked against the source in this tree. Where I repeat a
finding from `reports/PRODUCTION_AUDIT.md` I re-read the code; where that audit was imprecise I
say so. Where I could not determine something I say that instead of guessing.

Nothing in the repository was modified. `pnpm install` was run because `node_modules/` was absent
and the build could not otherwise be verified; that writes only to gitignored directories.

---

## 1. Build, type-check and test — measured, not reported

`node v25.8.2`, `pnpm 9.15.1`. `node_modules/` was **missing** on first contact; `pnpm -F
chrome-extension test`, `pnpm type-check` and `pnpm build` all failed with
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL … Command "vitest" not found`. After
`pnpm install --frozen-lockfile` (exit 0, lockfile satisfied, no resolution drift):

| Command | Exit | Numbers |
|---|---|---|
| `pnpm -F chrome-extension test` | **0** | **58 test files, 859 tests, all passed.** 4.49 s (collect 34.9 s, tests 10.8 s). Largest suite `agent/__tests__/executor.test.ts`, 94 tests. |
| `pnpm type-check` | **0** | 12/12 turbo tasks, 6.7 s. Zero `error TS`. |
| `pnpm build` | **0** | 5/5 turbo tasks, 7.5 s. `dist/` = **9.1 MB**. |

Warnings, all pre-existing and benign:

- `[WARN] The "pnpm" field in package.json is no longer read by pnpm … "pnpm.overrides"` — on
  **every** pnpm invocation. The `pnpm.overrides` block in the root `package.json` is being
  **silently ignored** by pnpm 9.15.1. Worth checking what those overrides were pinning; if one of
  them was a security pin, it is not in effect. (I did not audit the override list itself.)
- `MODULE_TYPELESS_PACKAGE_JSON` for `packages/tailwind-config` (sidepanel and options builds).
- `▲ [WARNING] The glob pattern "./lib/**/*.tsx" did not match any files [empty-glob]` in
  `@extension/schema-utils:ready`.
- Vite's 500 kB chunk notice on the side panel.
- `turbo`: `the daemon configuration option is deprecated`.

Shipped artefact facts, measured:

- `dist/background.iife.js` = **2,792,761 B** (2.79 MB), single IIFE, **30 `console.log`** left in it.
- `dist/webgenie-logo.png` = **2,752,771 B**, and the identical file again at
  `dist/side-panel/webgenie-logo.png`. **5.5 MB of the 9.1 MB package is one duplicated image.**
  `file` says `PNG image data, 2400 x 1704` — non-square, used for all four icon sizes and the action icon.
- Zero `.map` files in `dist`.
- `packages/i18n/locales/{en,pt_BR,zh_TW}/messages.json` — **293 keys each**, no drift.
- Versions agree: `package.json` and `chrome-extension/package.json` both `0.1.13`.

**Conclusion for area 6 of the earlier audit:** its build numbers were right. The one thing it
missed is that the tree does not build from a clean checkout without `pnpm install`, and that the
`pnpm.overrides` block is dead.

---

## 2. The four landed fixes — read, not taken on trust

All four are present and, with one exception, sound.

### 2.1 `fc1fec3` — a stall no longer charges the failure budget: **in, and sound as far as it goes**

`executor.ts:674-681` increments `context.stalls`, records a `span`, logs, and does **not** touch
`consecutiveFailures`. `consecutiveFailures` is now charged in exactly four places, all of which
are a real executed failure:

- `executor.ts:1112` — `outcome === 'failed'`, `+0.5` for a page-side error, `+1` otherwise.
- `executor.ts:1136` — the `catch` around a whole navigator step, after the typed terminal errors
  are rethrown.
- `executor.ts:1051` — the planner path.
- `executor.ts:1053/1114/1137/1165` — the `>= maxFailures` throws.

**Does a stall still charge the failure budget anywhere? No.** `grep -rn "stalls"
chrome-extension/src --include=*.ts` (excluding tests) returns only the field declaration
(`types.ts:230`), the increment and the two log/record lines. Nothing in that path reaches
`consecutiveFailures`.

**Can a guard refusal still end a task? No.** Two distinct refusal classes, both safe:

- *Actionability* guards (covered / invisible / moving / disabled / read-only / stale-index) come
  back as `executionStatus: 'threw', validated: 'failed'` (`navigator.ts:1460-1470`) and are
  intercepted by the explicit branch at `executor.ts:1104-1107` before the charging branch at
  `:1109`. `dispatchGuard` (`validation/service.ts:593-600`) is the shared matcher, so the test
  and the executor cannot drift.
- *Safety* refusals (commit gate, intent check, secret binding, firewall, challenge element,
  invented data, overwrite, list entry) all push `validated: 'unknown'`
  (`navigator.ts:559,585,664,828,902,933,965,1011,1035,1068,1422`), which lands in the
  `outcome === 'unknown'` branch at `executor.ts:1117` — log only, no charge.

That is the right shape: a refusal costs nothing because nothing reached the page.

### 2.1a **NEW BUG introduced by this fix — `maxStalls` is dead code**

`types.ts:37` declares `maxStalls: number`, `types.ts:64` defaults it to `6`, and
`executor.ts:678-680` increments `context.stalls` and prints `${context.stalls}/${context.options.maxStalls}`.
**`context.stalls` is never compared to `context.options.maxStalls` anywhere in shipped source.**
The commit message says "A stall now counts on its own (context.stalls, options.maxStalls = 6…)" —
the counting landed; the bound did not.

Net effect: before `fc1fec3`, three stalls ended a task (too eagerly — the reported 11 frozen
tasks). Now **an unbounded number of stalls does nothing but force a re-plan and request a
screenshot**, and the only remaining ceiling on a task cycling `click → go_back → click → go_back`
is `maxSteps` (default **100**) — i.e. up to ~100 navigator calls and ~20 planner calls on a loop
the executor has already detected and named. This trades a premature-failure bug for a
burn-the-whole-budget bug, and it compounds B13 (no spend cap). One line fixes it.

### 2.2 `81c2f47` — two-action cycle seen in four steps: **in, and sound**

`stalledOn` is exported at `executor.ts:70-76`:

```ts
export function stalledOn(keys: string[]): boolean {
  const last = keys[keys.length - 1];
  if (keys.slice(-6).filter(key => key === last).length >= 3) return true;
  const [first, second, third, fourth] = keys.slice(-4);
  return keys.length >= 4 && first === third && second === fourth && first !== second;
}
```

Pure, exported, tested on keys. `recordStep()` (`executor.ts:937-950`) feeds it
`actions|layoutFingerprint` and also returns `fresh`, which is what refills the failure budget at
`executor.ts:665-672`. Correct: only *new, validated* work (or a new finding) resets the streak, so
a repeated read that happens to validate no longer keeps the count alive.

### 2.3 `2b9111a` — one problem per requirement, one send-back: **in, and sound**

`requirementProblem` / `requirementProblems` / `RequirementProblem` live in
`validation/done-evidence.ts:355-382`; the three former flags collapse into the single
`this.requirementProblemRefused` (`executor.ts:139`, reset at `:228`, read and set at `:271-275`).
`REQUIREMENT_PROBLEM_NOTES` (`executor.ts:81-86`) groups every problem requirement by kind into one
refusal, so each still gets its specific advice. One send-back for all of them, as advertised.

### 2.4 `8bb9b62` — advisory checks pinned: **in, and sound**

`executor.ts:306` carries the invariant as a comment — *"Every deterministic check above is
advisory: each refuses once and then accepts"* — and the commit adds a test that a deterministic
check failing on two consecutive planner `done`s still completes the second time. Given the stated
~84 % precision / ~56 % recall of those checks, pinning them as advisory is the right call.

---

## 3. The 17 blockers, re-verified against `ada968b`

**Summary: 17 of 17 are still open.** None was fixed by the four landed commits (which touched only
the executor's failure accounting and completion checks); none was a false alarm, though **B1 is
narrower than the earlier audit stated** and **3.5 is partly mitigated**. Evidence below.

| # | Blocker | Status | Evidence in this tree |
|---|---|---|---|
| **B1** | `onlyOpens()` voids the commit label gate | **OPEN — real, but narrower than stated** | `validation/service.ts:65-70` is unchanged. `service.ts:126` — `label = onlyOpens(node) ? undefined : parts.find(isCommitLabel);` then `:127` — `if (!label && ((form?.isSubmitter && commitsForm) \|\| modelSaysCommit)) label = …`. See the correction below. |
| **B2** | An approved commit survives a worker death and can be spent twice | **OPEN** | `navigator.ts:1083` `if (commit) this.context.approvedCommitKey = null;` — in memory, immediately before the call. `executor.ts:877` writes `approvedCommitKey` into the checkpoint only at the end of the step; `executor.ts:900` restores it. Key is stable: `` `${place}\|${label.toLowerCase()}` `` (`service.ts:148`). |
| **B3** | No idempotency key; a whole step's actions run before anything is recorded | **OPEN** | `navigator.ts:260` `actionResults = await this.doMultiAction(actions);` then `:263` `this.context.messageManager.addToolTurn(calls, actionResults);`. `actionId` is generated fresh per attempt at `navigator.ts:487` and is a trace correlation id only. `maxActionsPerStep: 5` (`generalSettings.ts:46`). |
| **B4** | Exfiltration through the query string of a page-linked path | **OPEN** | `urlKey` (`service.ts:222-230`) returns `host + pathname`, lowercased, **query and fragment dropped**; `addressKey` (`:233-236`) adds the query but is not used here. `urlHasProvenance` (`navigator.ts:390-399`) compares `urlKey(href, state.url) === urlKey(url)` and also short-circuits on `this.context.visitedUrls.has(wanted)` (keyed by `urlKey` too). One `<a href="https://attacker/c">` on an injected page whitelists every query string on `/c`. |
| **B5** | Firewall on, enforces nothing | **OPEN — exactly as described** | `firewall.ts:35-39` `{ allowList: [], denyList: [], enabled: true }`. `browser/util.ts:10` — `isUrlAllowed(url, allowList, denyList)` **does not take `enabled` at all**, and `:37-39` returns `true` whenever both lists are empty. `grep '\.enabled' chrome-extension/src/background/browser/` → nothing. UI: `FirewallSettings.tsx:63` renders the heading "Firewall Protection" with the toggle bound to `isEnabled`, and `:118` renders "No filtering rules configured" below it. |
| **B6** | Telemetry opt-out by default | **OPEN — exactly as described** | `analyticsSettings.ts:27-32` `DEFAULT_ANALYTICS_SETTINGS = { enabled: true, … }` with the comment *"enabled by default as per requirements"*. `services/analytics.ts:73` `api_host: 'https://app.posthog.com'`, `:81` `opt_out_capturing_by_default: false, // Enabled by default per requirements`, `:86` `bootstrap` with the persistent anonymous id, `:194` `trackDomainVisit`. Gated on `VITE_POSTHOG_API_KEY` (`vite.config.mts:73`), so a keyless local build no-ops and a store build with the key collects. Still contradicts `DECISIONS.md` D1. |
| **B7** | The consent text denies what the code does | **OPEN — exactly as described** | `AnalyticsSettings.tsx:272-288`. The `<input type="checkbox">` has **no label, no title, no i18n key**; the only copy is *"Securely share system-level diagnostics. No personal identifiers or data logs are ever exported from your device."*, with a badge reading **"End-to-End Local Processing"** directly beneath it. A stable `distinctID` plus every agent-visited domain is neither. |
| **B8** | Every open tab's URL and title goes to the model every step | **OPEN** | `context.ts:290-291` `getTabInfos()` → `this._browserAdapter.queryTabs({})` — no filter at all, every window. Consumed by `getCachedState` (`:305`) and `getState`, written into the state message by `prompts/base.ts`. |
| **B9** | `retry-after: 0` → unbounded tight retry loop | **OPEN — confirmed by reading the three paths** | `retryDelayHint` (`base.ts:293-307`) can return **0** three ways: `Number(header) === 0` passes `seconds >= 0` (`:297`); an HTTP-date in the past gives `Math.max(0, at - Date.now())` (`:300`); `retryDelay: "0s"` gives `Math.round(0)` (`:303`). `rateLimitDelayMs` (`:324-328`) returns `Math.min(hint, 30_000)` verbatim. In the loop (`:584-600`): `rateLimitWaitedMs += 0` never grows, so the `> RATE_LIMIT_BUDGET_MS` guard at `:585` never trips; `cooldownUntil` is set to `Date.now() + 0`; `waitUnlessAborted(0)` resolves at once. `rateLimitRetries` is never compared to a maximum. The pacing hold at `:561` is `0` once `rateLimitRetries > 0`, and `startDelayMs` returns `0` anyway when the provider sent no `x-ratelimit-limit-*` header (`:219`). No overall task deadline exists. |
| **B10** | Trace capture off by default → no evidence for any bug report | **OPEN** | `trace.ts:44` `let enabled = import.meta.env.DEV;`, `:170` `enabled = import.meta.env.DEV \|\| Boolean(settings.enableDeveloperOptions && settings.captureTraces);`. `advancedSettings.ts:22,24` — both `false`. |
| **B11** | Checkpoint writes fail silently and are traced as successes | **OPEN — exactly as described** | `adapters/IndexedDBStorageProvider.ts` — `set` catches, `console.error`s and **resolves normally**; `get` catches and returns `null`, which `isCheckpointResumable` reads as "no saved task". `executor.ts:881-883` then records `checkpoint.saved`. This is the only `IStorageProvider` implementation. |
| **B12** | Raw provider `error.message` reaches the panel and is persisted | **OPEN** | `agent/agents/utils/error-handler.ts:30-40` — `ChatModelAuthError(errorMessage, error)`, `ChatModelBadRequestError(errorMessage, error)`, `ChatModelPaymentRequiredError(errorMessage, error)` all carry the provider's message **unchanged**. (Rate-limit and forbidden are correctly replaced with safe text at `:43` and `:60`.) `formatExecutionError` (`executor.ts:57-63`) passes it through to `t('exec_task_fail', [errorMessage])`, whose `en` value is `"Task failed: \n\n$ERROR_MESSAGE$"`. The port catch-all (`index.ts:711-716`) posts `error.message` with no redaction at all. `redactSecrets` only replaces *registered* passwords; the `SECRET_VALUE` regex that would catch `sk-…`/`AIza…`/`Bearer …` is trace-only (`trace.ts:41`). |
| **B13** | No spend cap, no token cap, no cost display; `maxSteps` 100 vs UI `max={50}` | **OPEN** | `generalSettings.ts:45-51` `maxSteps: 100, maxActionsPerStep: 5, maxFailures: 3, planningInterval: 5`. `GeneralSettings.tsx:57` renders `maxSteps` with `min={1} max={50}` — the shipped default is outside its own control's range. `grep -rn "parallel_task\|budget" pages/side-panel/src/` → nothing; `budgetTokens` exists only on the unreachable `parallel_task` command (`index.ts:527-533`). |
| **B14** | Saving an API key configures nothing | **OPEN — exactly as described** | `pages/options/src/components/model-settings/useModelSettings.ts:348-388` — `handleSave` validates the base URL, builds `configToSave`, calls `llmProviderStore.setProvider`, refreshes `availableModels`, and ends in `catch { alert(getErrorMessage(error)) }`. **`setAgentModel` is never called**; its only callers are the three manual role handlers at `:446`, `:466`, `:487`. Background then throws `t('bg_setup_noNavigatorModel')` at `index.ts:876-878`, naming a "navigator" the options UI never uses as a word. |
| **B15** | No privacy policy | **OPEN** | No `PRIVACY.md` at the repo root; `grep -in privacy README.md` matches only the browser-data-tools table row. |
| **B16** | One non-square 2.6 MB PNG for all icon sizes, shipped twice | **OPEN** | `manifest.js:93-101`; `chrome-extension/public/webgenie-logo.png` is `PNG image data, 2400 x 1704`; both `dist/webgenie-logo.png` and `dist/side-panel/webgenie-logo.png` are 2,752,771 B. |
| **B17** | Permission surface | **OPEN** | `manifest.js:64-84` still requests `bookmarks, readingList, history, downloads, browsingData, management, sessions, system.cpu, alarms, activeTab` alongside `debugger`, `tabs`, `<all_urls>` and `scripting`. `enableBrowserDataTools` defaults `false`, so none of the first group is reachable on a default install. `web_accessible_resources` (`manifest.js:109-121`) still exposes `*.js` to `matches: ['*://*/*']`, so the 2.79 MB worker bundle is `fetch()`-able from any page and the extension ID is trivially probed. |

### Correction to B1 — what the gate actually does

The earlier audit gave two examples. Only one of them is a bypass.

- **`<a href="/checkout/submit">Place your order</a>` — a real, unconditional bypass.** `onlyOpens`
  returns `true`, so the label is discarded; an `<a>` is never `form.isSubmitter`, so the fallback
  at `service.ts:127` needs `modelSaysCommit`, which is the self-report of the model being injected.
  This is **deliberate and tested**: `validation/__tests__/validation.test.ts:506-517` asserts
  `click(link, { commits: 'none' }, noForm)` is `null` and only `click(link, { commits: 'order' })`
  gates. One-click / saved-card purchase links are exactly this markup.
- **`<button aria-expanded="false">Place order</button>` — not a bypass when the form has card
  fields.** The same test at `validation.test.ts:515` pins the opposite:
  `click(element(1, {tagName:'button', attributes:{'aria-label':'Pay now','aria-expanded':'false'}}), {}, paymentForm)?.label` is `'Pay now'`,
  because `form.isSubmitter && commitsForm` rescues it. It *is* a bypass when `paymentFields` is
  false — which, per **N4** below, is most real checkouts.

B1 stays a blocker. The `<a href>` hole is complete and the `aria-expanded` hole is conditional on
a payment-field check that usually fails anyway.

### 3.5 — partly mitigated, not fixed

`titleFromTask` (`core/task-groups/manager.ts:70-78`) strips URLs and any word containing a digit,
`@` or a quote mark before taking six words, and `storableUrl` (`core/tab-registry/registry.ts:20-22`)
strips the query and fragment. So the worst of the earlier claim (passwords, emails, codes in a
persisted group title) is handled. What remains: up to six words of the user's task text plus agent
tab URLs and page titles live in `chrome.storage.local` under `tab-orchestration-state`, with no
TTL, not `wg_mem:`-prefixed (so "Forget site memory" misses it), and no control anywhere in
`pages/options/src`. Still serious, no longer a privacy blocker on its own.

### Other rows from the earlier audit, spot-checked and confirmed open

`1.7` side-panel close interrupts (`index.ts:730-731`) · `1.9` keep-alive is stopped only in
`runExecutor`'s `finally` (`index.ts:175`) and the orchestrator's (`:271`), with no
`chrome.runtime.onStartup` cleanup · `1.10` `CheckpointStore.clear` exists
(`contracts/checkpoint.ts:29-31`) but no sweep calls it · `1.11` `ACTIVE_TASK_KEY` and the
transcript are `chrome.storage.session` (`index.ts:167`, `messages/service.ts:103,117`) ·
`2.2` `fill_form` is registered at `builder.ts:268` with **no `hasIndex`** (default `false`,
`builder.ts:83`), so `getIndexArg` returns `null`, `indexedNode` is `undefined`
(`navigator.ts:745`) and `formCommitInfo(undefined)` inspects the form around `document.activeElement`
(`page.ts:2107-2108`) · `2.6` `const host = hostOf(this.context.promptState?.url);` at
`executor.ts:1256` · `2.7` `COMMIT_LABEL` at `service.ts:47` is English-only and `^`-anchored ·
`2.8` `COMMIT_DECIDING_TOOLS` (`schemas.ts:620-622`) resolves to exactly two tools —
`click_element` (`:88`) and `send_keys` (`:259`) are the only schemas with `commitDeciding: true` ·
`3.11` `TEST_GET_LLM_PAGE_STATE` (`index.ts:340`), `TEST_GET_ALL_TOOLS` (`:418`) and
`TEST_GET_SESSION_STATS` (`:436`) have **no `sender.url` check and no DEV gate**, unlike their
neighbours at `:319` and `:332` · `4.3` `task_resumable` (`index.ts:597`) sends
`taskId, task, status, question` — **no `interruption`**, though `executor.ts:879` persisted it ·
`4.5` the panel posts `heartbeat` on a 25 s interval (`useAgentConnection.ts:193-197`) and the
background acks (`index.ts:480-482`), but `grep heartbeat_ack pages/side-panel/src/` → nothing ·
`4.6` `SidePanel.tsx` has no `withErrorBoundary` (`Options.tsx:142` does) · `4.7` the max-steps
branch (`executor.ts:727-736`) emits bare `t('exec_errors_maxStepsReached')` = **"Max steps
reached"** with no `withLastAnswer`, while the max-failures branch beside it (`:737-744`) does call
`withLastAnswer` · `4.10` only **4 of 9** `.tsx` in `pages/options/src/components/` import
`@extension/i18n` · `4.12` `alert(getErrorMessage(error))` at `useModelSettings.ts:386` ·
`5.2` `useConfig.ts:9-10` counts any configured role, `index.ts:876-878` requires the navigator ·
`7.6` `agent/messages/views.ts` has no `removeMessage`, no eviction and no trim.

---

## 4. What the earlier audit missed

### N1 — `maxStalls` is dead code (regression from `fc1fec3`)

See §2.1a. `types.ts:37,64` declare and default it; `executor.ts:678-680` increments and prints it;
**nothing compares them**. An unbounded stall loop now runs to `maxSteps` (100).
*Severity: blocker for unsupervised use* — it is the cheapest possible fix (one `if`) and it
directly multiplies B13.

### N2 — Two side panels: the second hijacks the first's events, and closing it kills the first's task

`index.ts:476` — `currentPort = port`, a single module-level slot. `subscribeToExecutorEvents`
posts every agent event to `currentPort` (`index.ts:955-965`). `chrome.sidePanel` is per-window, so
opening a second Chrome window's panel silently retargets a running task's event stream: **panel A
renders nothing further and panel B's chat fills with a task its user did not start.**

The disconnect handler is half-right. `index.ts:723` — `if (currentPort !== port) return;` — means
closing the *older* panel correctly does nothing. But when the *newer* panel closes,
`index.ts:730-731` runs `currentExecutor.interrupt(t('bg_interrupt_panelClosed'))` and **interrupts
the task panel A started and is still watching**, with no event reaching panel A to say so.
*Severity: serious.*

### N3 — `stopRunningTask()` is not a lock; two executors can drive the same browser

`runningTask` is assigned inside `runExecutor` **after** `await chrome.storage.session.set(…)` and
`await keepAliveManager.startKeepAlive()` (`index.ts:167-171`), while the `new_task` handler awaits
`stopRunningTask()`, `setupExecutor()` and `tabOrchestrator.beginTask()` before calling it
(`index.ts:490-502`). The port `onMessage` listener is `async` (`index.ts:478`), so Chrome will
dispatch a second message into that window. A second `new_task` arriving there sees
`runningTask === null`, returns from `stopRunningTask()` immediately, and builds a second
`Executor` over the same module-level `browserContext` singleton — two agent loops issuing CDP
`Input` events into one debugger session, with `currentExecutor` pointing at only one of them and
`runExecutor`'s `finally` cleaning up only its own.

Reachable today via N2 (two windows, two panels). A *single* panel cannot do it: `inputEnabled` is
set `false` at task start (`useTaskExecution.ts:150`) and `ChatInput` is `disabled={!inputEnabled}`
(`SidePanel.tsx:192,232`). So the window is narrow but real, and it widens with any future caller
of the port. *Severity: serious.*

### N4 — Real checkouts defeat `paymentFields` by construction

`inspectForm` (`page.ts:208-230`) is evaluated **in the frame of the clicked node**
(`page.ts:2106` — `(await this._requireHandle(node)).evaluate(inspectForm)`) and inspects only
`form.elements` of the nearest `<form>`. Stripe Elements, Adyen, Braintree and every other
hosted-fields processor render card number, expiry and CVC inside **cross-origin iframes**, so the
main-document form that holds the submit button contains no control matching
`/\bcc-|card.?(number|num)|cc.?num|\bcvc\b|\bcvv\b|\bcsc\b|\biban\b|security.?code/i`
(`page.ts:224`) and `paymentFields` is `false`.

So the form half of the commit gate is unavailable on exactly the pages it exists for. Combined
with the English-only, `^`-anchored `COMMIT_LABEL` (`service.ts:47`) and B1's `<a href>` hole, a
hosted-fields checkout with a non-English or icon-only submit is ungated unless the model
volunteers `commits`. The earlier audit noted the saved-card case (2.7); it missed that the
*iframe* case covers most card checkouts too. *Severity: blocker, same class as B1.*

### N5 — A failed form inspection fails the commit gate **open**

`navigator.formCommitInfo` (`navigator.ts:405-413`) catches any error, logs a `logger.warning` and
returns `null`. `commitTarget` then computes `commitsForm = !!form?.inForm && …` → `false`
(`service.ts:118`), so a detached frame, a navigation mid-step, a CDP timeout or a cross-origin
handle error silently removes the form half of the gate. Every other guard in this codebase fails
closed — the page-blind intent check explicitly refuses on a throw (`navigator.ts:376-380`). This
one does not. *Severity: serious. One-line fix: treat a null inspection as "may commit".*

### N6 — `fill_form` values reach the trace store and the worker console unredacted

`redactArgs` (`navigator.ts:131-142`) length-redacts only `text` and `prompt_text`, and only for
`input_text` and `handle_dialog`. `fill_form`'s payload is `fields: [{ index, value }]`
(`schemas.ts:144-154`), so **every value typed through the single-call form path passes through
`redactArgs` untouched** and is written verbatim to:

- the trace store — `navigator.ts:1114` `data: { args: redactArgs(actionName, actionArgs), … }`;
- the worker console — `navigator.ts:1361` and `:1446`, which are **not gated on the trace toggle**;
- the emitted act event — `navigator.ts:547` `payload: { actionName, actionArgs: redactArgs(…) }`.

`fill_form` is the tool the prompt steers the model toward for addresses and checkout details. Names,
street addresses, emails, phone numbers and any card number the user supplied in the task all land
there. `go_to_url` URLs, `search_web` queries and `save_findings` content are likewise verbatim.
Only `{{secret_N}}` passwords are registered secrets (`executor.ts:744`, `trace.ts:52-58`), and the
`SECRET_KEY` name-based redaction in `sanitize` (`trace.ts:112`) never matches `value`.

Answering the posed question directly: **yes, user data reaches the trace store unredacted.** The
store is off by default (which is B10's own problem), but the console lines are not — and
"Download traces (JSONL)" is `getAll()` with no filter.
*Severity: serious; blocker once B10 is fixed by defaulting capture on.*

### N7 — The orchestrator and `parallel_task` ship but are unreachable

`grep -rn "parallel_task\|resume_parallel_task\|orchestration_event" pages/side-panel/src/` returns
nothing, yet `index.ts:527-545` serves those commands on the authenticated port and the whole
`agent/orchestration/` tree is linked into the 2.79 MB worker bundle. Not a security hole (the port
is authenticated to `side-panel/index.html`), but it is unexercised code in the hot bundle and one
more thing a reviewer will ask about. *Severity: polish.*

### N8 — `pnpm.overrides` is silently ignored

Every pnpm invocation prints `The "pnpm" field in package.json is no longer read by pnpm. The
following keys were ignored: "pnpm.overrides"`. Whatever those overrides pinned — I did not audit
the list — is **not in effect** under pnpm 9.15.1. If any was a transitive security pin, it is
unenforced. *Severity: unknown until the override list is read; cheap to check.*

### What the agent does with a login or payment page it was not asked to touch

There is **no site scope anywhere.** The firewall is empty (B5), `urlHasProvenance` accepts any
`href` the page itself supplies (`navigator.ts:390-399`), and nothing compares the current host
against the task's start host except `taskNamesSite` (`service.ts:268`), which is used only to
*skip* the personal-data check (`navigator.ts:808`). So the agent can arrive anywhere.

**On an unasked login page**, the navigator prompt tells it to proceed:
`prompts/templates/navigator.ts:41` — *"Get past a login, 2FA code, captcha or permission prompt
the task did not give what it needs for — go to the site first, the user is often signed in. Ask
for credentials with fields (type \"password\")."* If the user answers, `executor.ts:1256` binds the
new password to `hostOf(this.context.promptState?.url)` — **whatever page the agent happens to be
on**, with no check that the host is one the task named. The question text is model-authored and
rendered in the extension's own chrome. That is 2.6, and it is the direct answer: the agent does
not stop at an unasked login, it asks the user for credentials and binds them to the page that
asked.

**On an unasked payment page**, the agent cannot invent card details (`inventedPersonalData`,
`navigator.ts:1023-1046`) and has none unless the user gave them, so the realistic harm is a
one-click or saved-card purchase. That is gated by `commitTarget` alone — and B1's `<a href>` hole,
N4's iframe hole, 2.2's `fill_form` hole and 2.7's language hole are all exactly that case.
**CAPTCHAs are handled correctly**: `isChallengeElement` refuses any interaction with a verification
widget and hands it to the user (`navigator.ts:750-756`) — the one place where "not asked" is
enforced rather than suggested.

### Closing the side panel mid-task

Confirmed as the earlier audit described: `index.ts:730-731` interrupts on the panel's
`onDisconnect`, with a good, localised message (`bg_interrupt_panelClosed` = *"The side panel was
closed. The task is saved: open the side panel to resume it."*). The checkpoint survives in
IndexedDB and `ACTIVE_TASK_KEY` is deliberately **not** cleared when `interruption` is set
(`index.ts:181`), so a reopened panel in the same session can reattach. Across a browser restart
the session-scoped transcript is gone (1.11). The *reason* is persisted (`executor.ts:879`) and
then not sent (`index.ts:597`) — 4.3. N2 adds the new wrinkle that the panel whose close triggers
this may not be the panel that started the task.

### The content-script overlay: can a page fingerprint or interfere with it?

**Interfere — no. This is clean, and better than I expected.** There is no
`window.addEventListener('message')`, no `postMessage`, no `document.addEventListener` and no
custom-event listener anywhere in `pages/content/src`; the only page-level listener is
`window.addEventListener('pagehide', teardown)` (`pages/content/src/index.ts:87`). The content
script **never calls `chrome.runtime.sendMessage` or `chrome.runtime.connect`** — it only
*receives* (`index.ts:46`) — so there is no page → content → background relay at all, and the
manifest has no `externally_connectable`. Background payloads are validated structurally before
use (`readRect` rejects non-finite boxes, `index.ts:37-44`; `KINDS` whitelists action kinds,
`index.ts:34`), and the `goal` string is injected via `textContent`, not `innerHTML`. The frame
guard `if (window !== window.top) return;` (`index.ts:47`) keeps it out of subframes. **A page can
observe the overlay; it cannot drive it or reach the agent through it.**

**Fingerprint — yes, four ways, three of them avoidable:**

1. **The biggest one is not the overlay.** `manifest.js:109-120` exposes `*.js`, `*.css`, `*.svg`
   and `webgenie-logo.png` to `matches: ['*://*/*']` with **no `use_dynamic_url`**. Any page can
   `fetch('chrome-extension://<id>/webgenie-logo.png')` and detect the install **with no task
   running**. (This is 2.9 / B17, now with the detection mechanism spelled out.)
2. While a task runs, the overlay host is a fixed, well-known id — `HOST_ID =
   'webgenie-agent-overlay'` (`overlay/presence.ts:35`), appended to `document.documentElement`
   (`index.ts:21`). `document.getElementById('webgenie-agent-overlay')` is a one-line check.
   The shadow root is **`mode: 'open'`** (`presence.ts:402`), so the page can read
   `host.shadowRoot.innerHTML` and the whole `<style>` block; and the CSS custom properties
   `--wg-a`/`--wg-b`/`--wg-speed` on the host's inline style (`presence.ts:459-461`) leak the
   current workflow stage through `getComputedStyle` (`overlay/core.ts:38-48`). Nothing is added on
   an idle page — the host is created lazily inside `overlay()` (`index.ts:16-25`), reached only
   from the three background branches — which is the right design.
3. **Every screenshot stamps the page with the product name.** `browser/page.ts:1506` sets
   `document.documentElement.setAttribute('data-webgenie-capture', '1')` and appends
   `<style id="puppeteer-disable-animations">` in the **main world**, removed at `:1542`. A page
   `MutationObserver` on `documentElement` attributes sees it directly, every step that captures.
4. **The overlay is broadcast to tabs that are not the agent's.**
   `core/activity-engine/engine.ts:175` — `const isTargetTab = !activeTabId || tab.id === activeTabId;`
   — over `chrome.tabs.query({})` (`:166`). When `activeTabId` is `null` (no `PRIMARY_ACTIVE` tab
   in the registry, `:128-129`), **every open tab** is sent `active: true` and builds the overlay.
   So unrelated pages — including hostile ones the agent never touched — both detect the extension
   and visibly show an agent-is-working border the user did not ask for. *Severity: serious.*

**Cost and cleanliness — good.** `position:fixed; inset:0; pointer-events:none`
(`presence.ts:400`), `aria-hidden="true"` (`:399`), appended to `documentElement` not `body`, no
`document.body.style` anywhere, `z-index: 2147483000` deliberately below the maximum so page
modals still win (`presence.ts:39`). **No `MutationObserver` and no `requestAnimationFrame` loop**
— animation is the Web Animations API only (`presence.ts:479`), tracked and cancelled
(`:493`); four `setTimeout`s, all cleared in `destroy()` (`:805-812`).

**One leak:** teardown runs only on `AGENT_STATUS {active:false}` + 900 ms (`index.ts:52-57`) or
`pagehide` (`:87`). If the MV3 worker dies mid-task no `active:false` is ever broadcast, so the
host, its timers and its CSS animations stay on the page until the user navigates. *Severity: polish.*

**TEST_\* handlers, reachability settled.** Confirmed ungated (`index.ts:340,418,436`), and
`TEST_GET_SESSION_STATS` returns `workingMemory`, the message count and the task id
(`index.ts:441-448`). But a web page **cannot** reach them: the content script sends no runtime
messages and there is no `externally_connectable`. The only in-repo caller is
`pages/side-panel/src/devtools/domDebug.ts:42`. So 3.11 is a latent hole, not an exploitable one —
downgrade from *serious* to *polish-with-a-trap*: it becomes live the day anyone adds a page→content
relay or an `externally_connectable` entry. Still 30 minutes to close.

### The side panel after a task ends: what is wrong or stale

**Normal completion, failure and cancel are clean.** `useAgentEventHandler.ts:68-76` clears
`showStopButton`, re-enables input, sets follow-up mode and clears `pausedReason` on both `TASK_OK`
and `TASK_FAIL`; `task.cancel` (`:77-84`) is the same minus follow-up mode. The user's own Stop
resets optimistically before any round-trip (`useTaskExecution.ts:213-218`), and a failure arriving
as a port `error` instead of an event also calls `resetToIdle()` (`useAgentConnection.ts:157-159`).
The `"Showing progress..."` marker is dropped by the next `appendMessage`
(`useChatSession.ts:38`) and is never rendered as a bubble anyway (`ThinkBlock.tsx:160`); it only
drives the spinner (`MessageList.tsx:260-263`).

Four real problems:

#### N9 — A paused panel says "Running Automation" and keeps spinning

`useAgentEventHandler.ts:85-89` sets `pausedReason` **and forces `setShowStopButton(true)`**.
`SidePanel.tsx:213` passes `isTaskRunning={showStopButton}`, so `MessageList.tsx:131` keeps
`isCycleRunning` true and the header reads *"Running Automation"* with the pulsing dot
(`MessageList.tsx:189,222`) — **at the same time as** the amber pause notice
(`MessageList.tsx:312-316`). And because `TASK_PAUSE`/`TASK_RESUME` leave `skip = true`, no
`appendMessage` runs, so the trailing progress marker is never dropped and `ThinkBlock.tsx:179-183`
spins for the whole pause. Input stays disabled throughout — nothing in the pause branch calls
`setInputEnabled(true)`. The panel simultaneously claims running, paused and busy.
*Severity: serious.*

#### N10 — Reopening the panel on a **live** paused task shows an empty chat with no sign a task exists

On remount, `useSidePanelController.ts:134-146` runs `setupConnection()` and
`requestReattach(latest.id)` but **does not load that session's messages**, so `currentSessionId`
and `messages` stay empty and `SidePanel.tsx:160` renders `EmptyChat`. If the worker is still alive
the background takes the first reattach branch (`index.ts:587-590`) and calls `reemitQuestion()`,
which emits **only** when `waitingForHuman && pendingQuestion` (`executor.ts:1235-1241`) — a no-op
for a plain pause. Result: **empty chat, no pause reason, no resume affordance, no indication
anything is running.** The experience is correct only in the worker-*died* case, where `reattach`
falls through to `task_resumable` (`index.ts:596-597`) and the panel renders `ResumableNotice`
(`SidePanel.tsx:173-181`). This compounds 4.3 (the `interruption` reason is persisted and not sent).
*Severity: serious — this is the non-watching user's whole return path.*

#### N11 — Switching chat session mid-task writes the running task's steps into the wrong chat

This is the worst thing in the panel, and the earlier audit did not have it.
`handleSessionSelect` (`useSidePanelController.ts:185-191`) → `loadSessionFromHistory`
(`useChatSession.ts:59-75`) mutates `sessionIdRef.current` and `messages`, and **does not cancel
the running task** or reset `showStopButton`, `inputEnabled`, `pausedReason`, `isWaitingForHuman`
or `lastScreenshot`.

`handleTaskState` has **no task or session filter at all** — `useAgentEventHandler.ts:47`
destructures `{ actor, state, timestamp, data, screenshot }` and ignores `data.taskId`, which the
payload does carry (`types/event.ts:49`). `appendMessage` resolves the target from the mutated ref:
`useChatSession.ts:42-46` — `const effectiveSessionId = sessionId !== undefined ? sessionId :
sessionIdRef.current; … chatHistoryStore.addMessage(effectiveSessionId, newMessage)`. So the old
task's events are appended to the newly-opened session's view **and persisted into its history on
disk**. Two other handlers in the same file (`task_resumable`, `useAgentConnection.ts:163-164`, and
`reattach_none`, `:175`) *do* guard by session, which shows the guard was understood and then not
applied to the event path.

It gets worse: the `reattach` fired for the newly selected session usually answers `reattach_none`
→ `resetToIdle()` (`useAgentConnection.ts:173-175`), so the UI **also stops showing a stop button
while the old task is still genuinely running in the background** — the user has no way to stop it.
Separately, `MessageList`'s expand/collapse state is component-local and keyed by cycle *index*
(`MessageList.tsx:54,57`) with no `key` on the component (`SidePanel.tsx:211`), so the previous
session's expanded set is applied to the new one. And `useChatSession.ts:70` returns `true` outside
the `if (fullSession && …)` block, so a missing or empty session reports success and
`handleSessionSelect` closes history and reattaches against a session it never loaded.
*Severity: blocker for unsupervised use — it is a cross-session data write, not just a render bug.*

#### N12 — `lastScreenshot` is never cleared

`setLastScreenshot(null)` **appears nowhere in `pages/side-panel/src`** (verified: the only
non-plumbing call is `setLastScreenshot(screenshot)` at `useAgentEventHandler.ts:54`). The task-end
branch explicitly declines to clear it (`:75`, `// Don't clear screenshot here so user can see
final result`), and `handleStopTask`, `resetToIdle`, `handleNewChat` and `resetSession` all omit
it. `AgentSight`'s reset branch is `if (!isActive && !screenshot)` (`AgentSight.tsx:26`),
unreachable while `screenshot` is non-null. **A screenshot of the last page of a finished task — a
logged-in inbox, a bank page — stays rendered in the panel indefinitely, across new chats and into
later sessions.** *Severity: serious (privacy, on-screen).*

#### Smaller dead/stale state, verified

`isReplaying` is **never set `true`** anywhere, so `isReplayingRef` is permanently false
(`useSidePanelController.ts:100-102`) and `ACT_OK` events are always skipped
(`useAgentEventHandler.ts:113`) — the replay UI path is dead. `isWaitingForHuman` is cleared on
task end but not in `handleNewChat` or `resetSession`. `isHistoricalSession` has no end-of-task
counterpart.

---

## 5. Verdict

### (a) What is safe to ship today, and to whom

**Internal / developer use only, unpacked, with an operator watching the screen, on sites that hold
no money and no account state.**

- **Not shippable to the Chrome Web Store at all today**, independent of agent quality: no privacy
  policy exists (B15) while the manifest requests `history`, `browsingData`, `management`,
  `downloads`, `sessions`, `debugger` and `<all_urls>` (B17); the icons are a single non-square
  2.6 MB PNG (B16); and a store build with `VITE_POSTHOG_API_KEY` set collects domain history by
  default under consent copy that denies it (B6, B7). Submission would be refused, and should be.
- **Not safe unsupervised**, even internally. Three independent markup-controlled bypasses of the
  commit gate (B1, N4, 2.2) mean a purchase can execute silently; `urlKey` dropping the query
  string (B4) means everything the agent read can leave the machine on a link the page supplied,
  with the firewall that would stop it empty by default (B5); and `retry-after: 0` (B9) can hang a
  task in a tight retry loop forever with no task deadline and no visible ceiling on spend (B13,
  made worse by N1).
- **Not usable supervised by a non-developer either**, because it does not start: saving an API key
  never assigns a model to either role (B14), so a normal user reaches a welcome screen that never
  goes away. And once it does run, switching chat session mid-task writes the running task's steps
  into the wrong conversation's stored history and hides the stop button (N11), which is a data
  bug, not a cosmetic one.
- **What is genuinely good and should not be disturbed:** the commit question is system-written and
  a page cannot word it; the intent check is page-blind and fails closed; `{{secret_N}}` plaintexts
  never enter any model context and never persist; route memory stores no typed text; API keys are
  `StorageEnum.Local` only; the side-panel port is authenticated; both dangerous tool flags default
  off with honest copy; CAPTCHAs are refused and handed to the user; **the content script is a
  genuinely hardened one-way sink — no page-reachable listener, no relay to the background, no
  `innerHTML` on dynamic text, no `MutationObserver`, no rAF loop, pointer-events none, every timer
  cleared**; and 859 tests pass with all three commands green.

### (b) Ordered must-fix list before unsupervised use

Ordered by harm per hour, not by harm alone.

| # | Fix | One-line reason | Est. |
|---|---|---|---|
| 1 | Floor the rate-limit delay: `Math.max(1_000, …)` at `base.ts:325` | B9 — a `retry-after: 0` hangs the task forever and burns provider quota at round-trip rate. | **0.5 h** |
| 2 | Compare `context.stalls` to `context.options.maxStalls` at `executor.ts:678` | N1 — the bound the last fix promised was never written; a detected loop now runs to 100 steps. | **0.5 h** |
| 3 | Treat `formCommitInfo === null` as "may commit" (`service.ts:118`) | N5 — the only guard in the codebase that fails open. | **0.5 h** |
| 4 | Redact `fill_form` `fields[].value` in `redactArgs` (`navigator.ts:136`) | N6 — addresses, emails and card numbers go verbatim to the console and the trace store. | **0.5 h** |
| 5 | Rethrow from `IndexedDBStorageProvider.set`; surface the failure | B11 — the whole resume story rests on a write that cannot report failure, and is traced as a success. | **1 h** |
| 6 | `enabled: false` in `DEFAULT_ANALYTICS_SETTINGS`; rewrite or delete the consent copy | B6 + B7 — domain history leaves the machine before the user opens a settings screen, under text that denies it, against `DECISIONS.md` D1. | **2 h** |
| 7 | Use `addressKey`, not `urlKey`, in `urlHasProvenance` and `visitedUrls` | B4 — one page-supplied `<a href>` currently whitelists every query string on that path; that is the exfiltration channel. | **1.5 h** |
| 8 | Stop `onlyOpens()` suppressing a commit *label*; use it to soften the question, not skip the gate. Update `validation.test.ts:506-517`. | B1 — an `<a href>` "Place your order" is unconditionally ungated, and it is tested as correct. | **3 h** |
| 9 | Inspect the form across frames, or gate on "a payment field anywhere on the page" | N4 — hosted-field checkouts (Stripe/Adyen/Braintree) have no card input in the submit's own form, so `paymentFields` is false where it matters most. | **6 h** |
| 10 | Register `fill_form` with `hasIndex` and inspect the targeted form | 2.2 — the one-call fill-and-submit path is gated against whatever had focus. | **2 h** |
| 11 | Honour `firewall.enabled`; either ship a real default policy or make the UI tell the truth | B5 — the backstop under B4/B1 is off, and the options page says it is on. | **3 h** |
| 12 | Persist `approvedCommitKey = null` **before** dispatch, not at the end of the step | B2 — one approval, two orders across a worker death. | **2 h** |
| 13 | Redact and map provider errors: auth/bad-request/payment branches of `error-handler.ts:30-40` | B12 — a 401 body carrying `sk-…` is rendered in chat and written to chat history. | **3 h** |
| 14 | A task deadline and a step/spend ceiling the user can see; clamp `maxSteps` to the UI range | B13 — nothing in the product frames any ceiling as money, and the default is outside its own control's range. | **8 h** |
| 15 | Filter `handleTaskState` by `data.taskId` / session, and cancel-or-keep-ownership on session switch | N11 — a running task's steps are written into whichever chat the user opens next, and the stop button disappears while it still runs. | **4 h** |
| 16 | Restrict `getTabInfos()` to tabs the agent opened or is attached to | B8 — banking/HR/medical tab URLs and titles are uploaded every step during an unrelated task. | **1.5 h** |
| 17 | Single-panel ownership (reject or hand over a second connection) and a real task lock around `new_task` | N2 + N3 — a second window silently steals the event stream, kills the task on close, and can start a second executor on the same debugger session. | **4 h** |
| 18 | On reattach to a live paused task, load the session and emit the pause state; stop forcing `showStopButton` during a pause | N9 + N10 — the returning user sees either "Running Automation" over a pause notice, or an empty chat with no sign a task exists. | **3 h** |
| 19 | `setLastScreenshot(null)` on task end, new chat and session reset | N12 — the last frame of a finished task (a logged-in page) stays on screen across sessions. | **0.5 h** |
| 20 | Assign a sensible default model to both roles on provider save | B14 — without it a normal user cannot run a single task. | **2 h** |
| 21 | Default an always-on `warning`/`error` ring buffer (or `captureTraces: true`), and route the six bare `console.log` diagnostics through `logger` | B10 + 7.5 — on a default install a failed task leaves no durable evidence, and B9 is exactly that bug report. Do this **after** #4, or it writes unredacted values to disk. | **3 h** |
| 22 | Fix `engine.ts:175`: broadcast the overlay only to the agent's tab, never to all tabs when `activeTabId` is null | overlay-4 — unrelated (possibly hostile) tabs both detect the extension and show an agent-is-working border. | **1 h** |
| 23 | Gate the three `TEST_*` handlers on `import.meta.env.DEV` and a `sender.url` check | 3.11 — unlike their neighbours they verify nothing, and one returns the agent's working memory. Not reachable from a page today; a trap for the first relay anyone adds. | **0.5 h** |
| 24 | `withErrorBoundary` on `SidePanel.tsx` | 4.6 — a render throw is a blank white panel with no way out. | **0.5 h** |
| 25 | Send `interruption` in `task_resumable` and render it | 4.3 — the reason is written to disk and thrown away; rate-limited, offline, debugger-cancelled and tab-closed are indistinguishable to the returning user. | **1.5 h** |
| 26 | Record the tool turn and checkpoint **per action**, not per step; add an idempotency key | B3 — up to five actions can execute with nothing recorded, and a resumed task will re-issue them. Real design work. | **12 h** |
| 27 | Persist the fail-open guard counters, `findings` and `requirements` in `TaskCheckpoint` | 1.5 + 1.6 — a resumed task behaves worse than one that never stopped. | **4 h** |
| 28 | Clean up orphaned offscreen documents on `chrome.runtime.onStartup`; sweep old checkpoints; tear the overlay down on worker death | 1.9 + 1.10 + overlay-leak — an orphaned keep-alive pings forever, abandoned task text lives in IndexedDB with no sweep, and a dead worker leaves the overlay animating on the page. | **3.5 h** |

**Sum for unsupervised readiness: ~75 hours** for someone who knows this codebase.
Items 1–5 together are **3 hours** and remove the two worst *runaway* behaviours plus the
silent-write problem; items 1–15 are **~37 hours** and close every path by which a non-watching
user loses money, data, account control or chat integrity.

### Store submission, additional and separable

| Fix | Reason | Est. |
|---|---|---|
| Privacy policy + per-permission justification + store listing material | B15, 6.6 — submission is refused without them. | **4 h** |
| Square icons at 16/32/48/128; stop shipping the 2.6 MB PNG twice | B16 — rejection, and 5.5 MB of a 9.1 MB package. | **1.5 h** |
| Move `bookmarks/readingList/history/downloads/browsingData/sessions` to `optional_permissions`; drop `management`, `alarms`, `activeTab`, `system.cpu` | B17 — an install prompt that reads as spyware for tools that default off. | **4 h** |
| Narrow `web_accessible_resources` off `*.js` and add `use_dynamic_url` | 2.9 — the whole 2.79 MB worker bundle is fetchable from any page, and a fixed resource URL is a one-line install probe. | **1.5 h** |
| `minimum_chrome_version: "120"` | 6.5 — `chrome.offscreen`, `side_panel`, `chrome.readingList`. | **0.25 h** |

**~11 hours**, independent of the agent work.

### (c) What I could not determine

- Whether the `pnpm.overrides` block pinned anything security-relevant (N8) — I read the warning,
  not the override list.
- Whether the live `https://WebGenie.ai/docs` and `github.com/WebGenie/WebGenie` links in the Help
  tab and `SECURITY.md` resolve — no network access was used for this audit.
- Runtime behaviour of any of the above: this was a source audit. The four landed fixes are
  covered by `executor.test.ts` (94 tests, green), but no live run was performed.

# 14 — Comparable solutions, read from their source

**Date:** 2026-10-16. **Method:** every project below was read from its own repository or first-party
documentation, not from papers or write-ups. Each claim carries a file path or doc URL and a date
(last-commit date from the GitHub API, or the publication date on the page). Where a claim could
only be reached second-hand it is marked *unverified*.

This brief does not repeat `01`–`12`. Those cover the loop, SOTA, evaluation, coding harnesses,
runtime, security, planning, perception, memory, provider throughput, frontier teardowns and
robustness. What is new here is: **the code of the projects nearest to ours, as it stands this
week**, and the fact that three of the four nearest relatives have rewritten their perception and
verification layers since we forked.

Our own numbers throughout come from `reports/R4_REVIEW.md` (run `mind2web-r4-2953c78`, 300 tasks,
judged 54.4%).

---

## 0. Provenance: WebGenie is a hard fork of nanobrowser

This needs saying plainly because every recommendation about nanobrowser depends on it.

- Our first commit, `6157b7e` (2026-03-20), is nanobrowser's tree. It contains nanobrowser's
  `README.md` (Discord and sponsor links intact), `chrome-extension/public/buildDomTree.js`
  (1,505 lines), `pages/side-panel/public/icons/validator.svg`, and the same
  `chrome-extension/src/background/agent/{executor,agents/planner,agents/navigator}.ts` layout.
- The marker survives in shipped code: `UNTRUSTED_CONTENT_TAG_START = '<nano_untrusted_content>'`
  in `chrome-extension/src/background/agent/messages/utils.ts:10`.
- Both are Apache-2.0, so the fork is licit; the attribution in `README.md` is a separate matter and
  is out of scope here.
- 510 commits later we have added 142 files under `chrome-extension/src/background/` and removed
  three (`browser/dom/clickable/service.ts`, `browser/dom/raw_types.ts`, `task/manager.ts`).
  `buildDomTree.js` is gone; perception is CDP.

So "what has upstream done since" is a real question with a real answer, and the answer is large.

### What upstream did since we forked

| Date | Commit / release | What |
| --- | --- | --- |
| 2026-10-02 | `7885bf1c` | `build: migrate to a single WXT package and the AI SDK v7` — LangChain dropped |
| 2026-10-02 | `c1347a91` | v0.2.0 |
| 2026-10-13 | `8ac395da` | **`Nanobrowser 0.3: rebuilt from the ground up`** |
| 2026-10-13 → 15 | `cb709aae`…`f1e912d7` | analytics, page border, permission cards, take-over card |

(Commit list: `https://api.github.com/repos/nanobrowser/nanobrowser/commits`, read 2026-10-16.)

Nanobrowser 0.3 is not an iteration of the code we forked. It is a different program with the same
product. Its tree (`https://api.github.com/repos/nanobrowser/nanobrowser/git/trees/master?recursive=1`,
read 2026-10-16) is:

```
src/browser-control/        # "the layer": no model inside it, deterministic
  core/perception/          ax.ts capture.ts diff.ts enrich.ts layout.ts masking.ts
                            observe.ts outline.ts read.ts window.ts
  core/interaction/         actionability.ts classify.ts evidence.ts gate.ts key-guard.ts
                            keys.ts pointer.ts preflight.ts resolve.ts withheld.ts
  core/tools/               act.ts ask.ts dialog.ts fill.ts labels.ts navigate.ts
                            observe.ts tabs.ts text.ts upload.ts wait.ts
  core/refs.ts  core/hash.ts  core/navigation-guard.ts  core/url-policy.ts
  host/                     cdp-session.ts chrome-host.ts frame-topology.ts puppeteer.ts
  probe/                    an injected probe used for element state and hit acceptance
  protocol/                 catalogue.ts errors.ts results.ts schemas.ts
src/agent/                  loop.ts (49 KB) prompt.ts tools.ts completion.ts compaction.ts
                            guards.ts elision.ts context.ts records.ts restore.ts
src/background/checks/      ~55 in-extension deterministic checks
src/background/scenarios/   ~30 local fixture pages of hard DOM situations
src/llm/                    limiter.ts overflow.ts profiles.ts model-info.ts stream.ts
```

The README (`https://raw.githubusercontent.com/nanobrowser/nanobrowser/master/README.md`,
2026-10-16) states the architecture directly: the control layer "talks to the page only through
Chrome's `chrome.debugger` API and uses Puppeteer to keep track of frames", has "no AI model inside
it, so the same input gives the same result", and gives "each element an ID tied to that element, so
stale IDs stop working rather than pointing to the wrong thing".

That is our architecture, two years further on. The rest of this section is the diff.

---

## 1. nanobrowser 0.3 — the closest relative, and the one with the most to take

### 1.1 Durable refs, and an outline *diff* instead of a fresh element list

**What it does.** `src/browser-control/core/refs.ts`: `RefRegistry.assign` mints `a1`, `a2`, … from
a persisted epoch prefix plus a counter that is never reset, and returns the *existing* record when
the same node in the same document already has one. A `RefRecord` keeps
`{tabId, sessionId, frameId, loaderId, backendNodeId, source: 'ax'|'layout', print, stale}`, where
`print` is `{role, name}` for AX-sourced refs and `{tag, text digest, names, nth, context}` for
layout-sourced ones; `context` is the enclosing `row | listitem | article | treeitem`'s
`backendNodeId` plus a digest of up to `RECORD_DIGEST_CHARS = 2_000` characters of its text.
`lookupRef` fails with `REF_UNKNOWN`, `REF_TAB_MISMATCH`, `STALE_DOCUMENT` / `FRAME_DETACHED` /
`DEBUGGER_DETACHED` (`Ref ${ref} is no longer valid: ${what}`), or `REF_NOT_PRESENTED`
(`Ref ${ref} was not in the latest observation of tab …`). Because the record key includes
`loaderId`, a ref never carries into a new document.

Because refs are durable, `src/browser-control/core/perception/diff.ts` can send **only what
changed**: `diffLines(prev, next)` trims the common head and tail, runs an LCS over the middle,
`compactOps` turns runs of kept lines into a count, and `renderDiff(ops, sinceRev)` emits
`- <line>` for a removal, `+ <line>` for an addition, and `~ <line>   (was: <old line>)` when a ref
appears in both — a state or value change. Header: `changes since rev <sinceRev>`, or
`no changes since rev <sinceRev>`. `applyDiff` re-derives the new outline from the old one and
throws `Diff does not apply at line …` if it does not, so the diff is verified, not assumed.
`MAX_LINES = 4_000` turns diffing off for giant outlines.

**What we do.** `browser/dom/ax-tree-pruner.ts:14-16` assigns
`node.highlightIndex = selectorMap.size` — **indexes are 0..N-1, re-allocated from scratch on every
read**. Index 12 is a different element after any page change. We mark novelty
(`node.isNew` → `*[index]` in `agent/prompts/base.ts`) but still resend the whole list, windowed to
`MAX_INTERACTIVE_ELEMENTS_CHARS = 26000` by `windowAroundViewport`. `browser/dom/selector-healer.ts`
exists to score a remembered element against candidates after the fact — a repair for a problem
stable ids do not have.

**Four independent projects converged on stable ids and we are the outlier.** Browser Use uses the
raw `backendNodeId` as the index (`browser_use/dom/serializer/serializer.py:649`,
`_allocate_selector_index`, 2026-08-28). Playwright stamps an expando
`element._ariaRef = {role, name, ref}` and reuses the ref while role and name are unchanged
(`packages/injected/src/ariaSnapshot.ts:226-238`, `computeAriaRef`, 2026-10-08). Chrome DevTools MCP
keys a persistent per-page map on `` `${loaderId}_${backendNodeId}` `` and reuses the old uid when
the key recurs (`src/TextSnapshot.ts:62-66`, v1.11.0, 2026-10-15). Nanobrowser does the above.

**What we should change.**
- `browser/dom/ax-tree-pruner.ts` — replace the `selectorMap.size` counter with a per-task registry
  keyed on `(frameId, loaderId, backendNodeId)` that returns the previous id when the key recurs.
  Keep a `print` (`role`, `name`, and for layout-sourced nodes the enclosing record digest) and fail
  the lookup when the print no longer matches, instead of acting on whatever now sits at that index.
  Plan item **1.12** already names this; it is gated G3 and should be ungated.
- `browser/dom/views.ts::clickableElementsToString` and `agent/prompts/base.ts` —
  once ids are durable, render the state as `renderDiff`-style `+ / - / ~ (was: …)` against the
  observation the model was last shown, with the full outline on the first step of a page, after a
  document change, or on demand.
- `agent/prompts/base.ts::dropUnshownIndexes` can then go: an id either resolves or errors.

**Buys.** The 796 consecutive action pairs on one URL with a byte-identical element list (16.7% of
pairs, 8.22M tokens, ~2 hours — `R4 §5`) collapse to `no changes since rev N`. Wrong-target failures
that come from a re-indexed list stop being silent. It is the precondition for every other
token-side fix.

**Risk.** High blast radius: `selectorMap` is read by the navigator, validation, highlighting,
replay (`agent/agents/navigator/replay.ts`) and route memory. Mitigation is that the diff is
*verified* (`applyDiff`) and falls back to a full outline whenever it does not apply.

**Verdict: adopt.**

### 1.2 `expect` on the action, and a receipt that reads the value back

**What it does.** Every layer tool takes an `expect` argument and returns a *receipt*.
`src/browser-control/core/interaction/evidence.ts`: `Evidence.begin()` snapshots the URL, the
target's probe state, page facts (alerts, invalid fields, top-level layers) and focus, and
subscribes to `Page.frameNavigated`, `Page.javascriptDialogOpening`, `Page.downloadWillBegin`,
`Network.requestWillBeSent/loadingFinished/loadingFailed`, `tabs.onCreated`. `#signals()` then
produces strings: `new document "…"`, `URL → "…"`, `dialog …`, `new tab <id>`,
`download started …`, `target removed`, `N mutation(s) in "<block>"` (marked *weak*),
`request: METHOD "…"`. `settle()` polls every `POLL_MS = 100` up to `CAP_MS = 1500`, waits for
`networkIdle` up to `NAVIGATION_READY_MS = 5000` after a new document, and adds the strong signals
`alert "…"`, `validation "…"`, `+N top-level layer: …`, `focus → "…"`. The verdict is `changed`,
`none`, or **`unattributable`** — only weak signals and the block is still mutating over
`VOLATILITY_MS = 400`, reported as `the page changes by itself`.
`checkExpectation()` then tests the caller's `Expectation` (`url` substring, `text`, `textGone`,
`value`, `checked`, `gone`) and returns `met | unmet | not_checked`.

And `set` reads the value back by itself (`core/tools/text.ts`): for text and native inputs the
value is re-read after settling and reported `read back "…"` (met) or the value read vs the value
requested (unmet); for selects `selectedOptions` is compared by index and value; for toggles
`checked` is re-read and a wrong state **throws `STATE_UNCHANGED` with `delivered: true`**. An
already-correct toggle is not clicked at all: `already checked`, `dispatched: false`. `type` (key by
key) explicitly refuses to judge: without `expect` it reports `not_checked`.

**What we do.** `agent/validation/service.ts::validateActionOutcome` compares observations before
and after and sets `ActionResult.validated`. There is no `expect`/postcondition anywhere in the
tree (grep for `postcondition` finds only two comments in `browser/views.ts`). R4 §4 records the
consequence directly: *"`input_text: passed` while the slider stayed at 3 TB; `fill_form: passed`
after UPS silently resolved two US ZIP codes to Chile; a radius select that never opened. Our
verdict proves the event was dispatched, not that it took effect."*

**What we should change.**
- `agent/actions/schemas.ts` — add one optional `expect` object to the mutating schemas
  (`click_element`, `input_text`, `send_keys`, `select_dropdown_option`, `fill_form`) with the five
  fields nanobrowser uses: `url_contains`, `text`, `text_gone`, `value`, `checked`. Describe it as
  "what the page should show if this worked"; do not make it required.
- `agent/validation/service.ts::validateActionOutcome` — evaluate it on the settled observation and
  set a third axis next to `validated`: `postcondition: met | unmet | not_checked`.
- `browser/page.ts` — for `input_text`, `select_dropdown_option` and the checkbox/radio path, read
  the value back unconditionally and put it in the result, as `set` does. A toggle already in the
  wanted state should be a validated no-op, not a click (plan item 2.4 says this; the read-back is
  the half that makes it checkable).

**Buys.** This is the mechanism behind the 11.4-point filter block and the 10.5-point answer block.
A filter that did not apply is `unmet` in the same step, not three plans later. It also turns
`unattributable` into a first-class verdict, which is what "action sent but had no effect"
(13 tasks, median 50 steps, 563k tokens) actually is.

**Risk.** Low. The argument is optional, the fallback is today's behaviour, and a wrong `expect`
costs one re-read.

**Verdict: adopt.**

### 1.3 The verification-debt ledger — `done` refused by code, not by a model call

**What it does.** `src/agent/completion.ts`. `createsDebt(tool, result)` marks a page action as
unverified when the result failed with `error.delivered` true or `'unknown'`, when
`receipt.dispatched === 'unknown'`, when there is a `pageError` or a non-empty `pending` list, when
`receipt.effect.verdict` is `'none'` or `'unattributable'` **and** `postcondition.status !== 'met'`,
or when `postcondition.status === 'unmet'`. An action whose result already shows the page afterwards
(`observe: 'diff'`) creates no debt. `clearsDebt` accepts only later evidence about the same tab: a
successful `snapshot`/`find`/`read`/`screenshot`, a `wait` whose `met` is not `'time'`, a page whose
`rev` has advanced, or a `postcondition.status === 'met'`. `refusal(open)` is the gate: the text
begins `refused: you have not seen the result of`, names each debt
(`click button «Submit» on tab 12`), and says to
`Observe the page (snapshot, find or read) to verify, then call done again, or call done with "partial"`.
`src/agent/loop.ts` ends the run as `partial` after two refusals in a row. Debt on a closed tab
becomes `unverifiable` and `unverifiedLines` adds *not verified, the tab closed* to the final answer.

**What we do.** Completion is the planner's call — a model call — plus `done-evidence.ts`, which
*computes* an evidence verdict and then **only logs it** (`verify.skippable`;
`acceptEvidencedDone` is default-off with no UI, `docs/agent.md`). R4: **31.6% of the agent's own
`done` verdicts are wrong (54 of 171), unchanged from r3**, and the answer layer is the largest
block at 10.5 points.

**What we should change.** Invert `done-evidence.ts`. Keep a per-task ledger of mutating actions
whose outcome was never observed, built from the same `validated` / (new) `postcondition` fields,
and refuse `done(success: true)` deterministically while it is non-empty — before
`agent/contracts/replan.ts` spends a planner call. The planner's completion check stays for
*answer* quality (it is catching real things: R4 §9); the ledger takes the mechanical half. The
refusal text must name the unverified action and the way to clear it, exactly as upstream's does,
and `done` with a partial/honest outcome must always be allowed through (our honest-empty reporting
is judged a success — R4 §9).

**Buys.** Attacks the 10.5-point answer block and the 31.6% wrong-`done` rate without a model call,
on any provider. It also removes planner round-trips: today a bad `done` costs a planner call to
discover.

**Risk.** Medium — over-strict debt turns a winnable task into `partial`. Upstream's own answer is
the two-refusal cap. Ship it behind a counter and read the false-refusal rate off traces, the way
plan item 2.10 does for guards.

**Verdict: adopt.**

### 1.4 Playwright-grade actionability with a retry budget

**What it does.** `src/browser-control/core/interaction/actionability.ts`: `waitForActionable` runs
`checkOnce` on the schedule `SCHEDULE = [0, 20, 100, 100, 500]` ms within
`ACTIONABILITY_BUDGET_MS = 5000`. `checkOnce` is, in order: connected (`NODE_DETACHED`);
`DOM.scrollIntoViewIfNeeded` on the target *and on every owner iframe up the chain*; enabled
(`DISABLED`); editable for text actions (`NOT_EDITABLE`); visible with a non-zero
`DOM.getContentQuads` quad (`NOT_VISIBLE`); **stable** — sample the quad centre, wait
`STABLE_GAP_MS = 50`, sample again (`NOT_STABLE`); inside the layout viewport via
`Page.getLayoutMetrics`; **hit test** — `nodeAtViewportPoint` in the target's session, then
`hitAccepts` on the probe, distinguishing `nested` (target the inner control by its ref),
`ancestor` (the target ignores pointer events) and covered, and walking the owner-iframe chain
(`OBSCURED` with `details.level`); and finally `assertAsShown`, re-checking the element is still the
one that was shown. Terminal codes are not retried (`NODE_DETACHED`, `TARGET_CHANGED`,
`NOT_INTERACTABLE`, `FRAME_DETACHED`, `STALE_DOCUMENT`, nested `OBSCURED`); `DISABLED`,
`NOT_VISIBLE`, `NOT_STABLE` and plain `OBSCURED` are. A hidden checkbox or radio with no quad is
clicked at a point interpolated bilinearly inside its *label's* quad.

Chrome DevTools MCP reaches the same place differently: `src/utils/WaitForHelper.ts` runs a
`MutationObserver` stable-DOM wait (quiet for 100 ms, bounded at 3000 ms, scaled by the CPU-throttle
multiplier) raced against navigation detection, around every input action (v1.11.0, 2026-10-15).

**What we do.** We have the perception half and not the waiting half.
`browser/chromium-apis/ax-tree-extractor.ts::coveringLayer` computes a covering layer from
`DOMSnapshot` paint order and writes `attributes.covered`; `browser/page.ts::coverBlocker` runs
`elementFromPoint` at the centre and four inner points, names the blocker and its dismiss buttons.
Both are good (R4 §9 calls the failure messages out as something not to break). But a pointer action
on a covered or zero-area target is **refused**, not retried: there is no equivalent of
`SCHEDULE`/`ACTIONABILITY_BUDGET_MS`, no stability sample, and no scroll-into-view through the
iframe owner chain. `settling.ts::waitForActionSettled` waits *after* the action, not before it.

**What we should change.** `browser/page.ts` — wrap the existing `coverBlocker` /
`pointerTarget` / disabled checks in a bounded retry (`[0, 20, 100, 100, 500]` within 5 s), add a
50 ms quad-stability sample, and scroll owner iframes into view before giving up. Classify the
existing failure codes terminal vs retryable so a genuinely nested target still fails fast with the
message we already write.

**Buys.** "Click a covered, hidden or inert target" is 15 tasks / 6.6 points (R4 §6), and "action
sent but had no effect" another 13. A large share of those are pages that were still animating,
still laying out, or had a transient overlay.

**Risk.** Low-medium: up to 5 s added to a failing action. Cap it and trace the wait.

**Verdict: adopt.**

### 1.5 Guards with numbers, in one place

**What it does.** `src/agent/guards.ts`: `ERROR_STOP = 5` consecutive errors stops the run
(`5 calls in a row failed.`). No-effect is counted **per target** (keyed on the JSON of the target,
not reset by navigation) and applies to `click`, `set`, `type`, `press`, `fill_form`:
`NO_EFFECT_NUDGE = 2` →
`${tool} on this target had no effect ${count} times (${signals}). Try another way, or ask the user.`;
`NO_EFFECT_STOP = 3` ends the run. A repeat nudge looks at the last `REPEAT_WINDOW = 6` call
signatures (tool + args minus `intent` + outcome) and fires at `REPEAT_LIMIT = 3`.

**What we do.** The same ideas, scattered: `MAX_IDENTICAL_ACTIONS` and `MAX_EMPTY_SCROLLS` in
`agent/agents/navigator.ts`, `progress_stall` and `GoalRepeats` in `agent/contracts/replan.ts`,
`maxFailures` in `agent/executor.ts`. R4 §5 says the repeat guard "fired 17 times against 1,682
repeats", and §3 that the new repeat guard "froze 11 tasks into a stall instead of redirecting
them".

**What we should change.** Not a rewrite — one addition. Our counters key on the *action*
(name + addressKey + args). Upstream's no-effect counter keys on the **target** and survives
navigation, which catches the case ours misses: the same button reached by three different routes.
Add a per-target no-effect count in `agent/validation/service.ts` fed by the new `postcondition`
field, nudge at 2 and force a re-plan at 3. R4 §8.6 already asks for "a guard refusal should force
a re-plan, not a retry" (3.8M tokens).

**Verdict: adapt.**

### 1.6 The scenario corpus — a deterministic conformance suite for the control layer

**What it does.** `src/background/scenarios/` is ~30 local fixture pages of exactly the situations
that break browser agents: `drawn-over-pages.ts`, `hidden-payment-frame.ts`,
`clicks-dialogs-frames.ts`, `toggles-and-nested-controls.ts`, `page-changes-midway.ts`,
`turns-into-pay-now.ts`, `wait-and-navigate-deadlines.ts`, `focus-moves.ts`,
`code-fields-and-submit.ts`, `masked-rerendered-fields.ts`, `masked-hidden-regions.ts`. They are
driven by ~55 checks in `src/background/checks/` (`frame-tree.ts`, `record-ax.ts`,
`record-layout.ts`, `observe-timing.ts`, `observe-tools.ts`, `keyboard-a11y.ts`, `canary-sweep.ts`,
`navigation-policy.ts`, …) from an in-extension `src/test-panel/` with `ObserveTab`, `ActTab`,
`ScenariosTab`. Prompts are answered by a scripted responder (`approveAll` in
`src/background/prompts.ts`); `src/llm/scripted.ts` is a scripted model. **No model call, no network,
fully deterministic.** Golden captures live in
`src/browser-control/core/__tests__/payloads/` (`shadow-closed.capture.json`,
`frames-nested.capture.json`, `d-layout-table.capture.json`, `d-hidpi.capture.json`, …).

**What we do.** `chrome-extension/e2e/fixtures.mjs` is 656 lines and holds one wizard
(`WIZARD_PAGES`, `LONG_WIZARD_PAGES`, `WIZARD_FIELDS`). Everything else is live sites through a
model (`pnpm e2e`), where R4 measured 64 tasks blocked, geolocation drift to India, and provider
throttle at half the wall clock. We cannot currently answer "did this perception change break
closed shadow roots" without spending a run.

**What we should change.** Grow `chrome-extension/e2e/fixtures.mjs` into a fixture directory with
one page per hard case, and add a model-free suite that drives `BrowserContext.getState` and the
action handlers against them, asserting the serialized outline against a golden file. The cases to
start from are the ones R4 priced: covered/inert targets, a dialog with a textless backdrop, a
late-mounting consent iframe, a custom select, a slider, a carousel, a `contenteditable`, an
autocomplete whose commit lives in the tree, a list that re-renders on filter, a page that changes
under the pointer.

**Buys.** Turns perception and actionability from "measured once per 20-hour live run" into
"measured on every commit". It is the only item here that makes the other four *safe* to ship.

**Risk.** None to the product; it is test code. Cost is the writing.

**Verdict: adopt.**

### 1.7 One agent, not planner + navigator

**What it does.** `src/agent/loop.ts` (2026-10-15): *"One agent runs the loop. `AgentLoop` makes one
model call per turn through `#stream`, then runs that reply's tool batch."* There is no planner.
Planning survives as text the single agent writes. Browser Use did the same: `agent/system_prompts/`
has eight prompt variants and **no planner prompt**; the plan is `plan_update: [...]` /
`current_plan_item: int` fields inside the one JSON reply (`browser_use/agent/views.py:405`), and
only `tests/ci/test_agent_planning.py` still matches "plan".

**Our position.** We have a planner, and R4 says it earns its keep in places (the completion refusal
caught an answer claiming 67,150 results where the page showed 1,029 — §9) and costs in others
(planner error is the second-largest failure class, 21 tasks; 88 re-plans "restated the goal";
planner prompt cache was 1.5% against the navigator's 37%).

**Verdict: reject the merge, adopt the cache lesson.** A single agent is a bet that one model can
hold the plan and the page at once; on weak and local models — which D5 requires us to support —
that bet is worse, and 07/11 already found the split helps there. But the *reason* upstream's cache
works is worth copying: one message list, where everything before the newest turn is byte-identical.
`agent/memory/in-chat/context-builder.ts::buildContextPacket` already puts the stamp in the system
prefix and all volatile blocks in the final message (the comment says so), which should have fixed
the 1.5%; **verify it on the next run's `kind: 'llm'` records before spending more on it.**

### 1.8 Smaller things worth lifting

- **`fill_form` with the postcondition on the submit.** `core/tools/fill.ts`: fields are set in
  order, the first failure throws `Field N of M failed` carrying `partial: {receipts, failedAt,
  submitted: false}` and a hint that says *not* to repeat the whole call but to snapshot and
  continue from the next field; `expect` is routed to the last field, or to the submit click when
  there is one. Our `fill_form` is the fastest thing we have (R4 §9) and does not do the partial
  hand-back. **Adopt** in `agent/actions/handlers/interaction.ts`.
- **Tool capability flags with `required`.** `src/agent/tools.ts`: `toolsForRun()` fixes the list for
  the whole run — *"its prompt prefix stays cached"* — drops `screenshot` without vision, and keeps
  `snapshot` and `done` always. Plan items 4.3/4.4 say the same; this is upstream confirmation.
- **Context compaction with a code-written ledger.** `src/agent/compaction.ts` keeps user messages
  verbatim and `ask_user` exchanges, keeps the newest 30% of the window, and replaces the rest with
  (a) `ledgerLines` — one line per call, written by code, model free text excluded, external strings
  quoted and capped at 120/160 chars, oldest reads merged into `tab N: X earlier reads and moves`
  but **writes, hand-overs, declines, blocks and unverified actions never merged** — and (b) one
  model summary with fixed sections `## Progress / ## Data gathered / ## Key decisions /
  ## Next steps`. Our `[ALREADY TRIED]` ledger is the same instinct; the "never merge a write"
  rule and the never-merge-unverified rule are the parts we do not have. **Adapt.**
- **`ask_user` timeout 15 minutes, confirmations never time out** (`src/extension/agent-session.ts`:
  `ASK_TIMEOUT_MS`, `confirmTimeoutMs = Infinity`). Our `humanWaitMinutes` default is 10 and applies
  to both. A confirmation that expires is strictly worse than one that waits. **Adopt** in
  `agent/executor.ts`.
- **Ask / Auto modes with per-site Allow / Ask / Block rules** (README, `src/options/
  PermissionsSection.tsx`). Our commit gate is derived from a model-written `commits` argument plus
  `commitTarget()`. Upstream's is a user-set policy per site, with the categories fixed by the
  product (submit/send/delete/upload vs pay/password/code/access). Ours is more precise and
  model-dependent; theirs is predictable and model-independent. **Adapt**: keep `commits`, add the
  per-site policy as the outer gate, because R4 §3 records intent-check refusals on 38 tasks against
  8 in r3 — a user-set policy is the thing that makes a guard tunable without a model.

---

## 2. Browser Use — the most active open-source agent

Repo HEAD `e0a70fb` (2026-10-16), v0.13.13 (2026-10-15).

### 2.1 They deleted their injected DOM script too — and kept one JS call

`buildDomTree.js` is gone; **the repo contains zero `.js` files** (verified against the full tree,
663 paths). The replacement shipped in v0.6.0 (2025-08-19), PRs #2400 *Switch to pure cdp extraction
layer* and #2573. `browser_use/dom/service.py::_get_all_trees` (2026-09-02) fires four CDP calls
concurrently under `asyncio.wait(..., timeout=10.0)`: `DOMSnapshot.captureSnapshot` with
`includePaintOrder: True`, `includeDOMRects: True` and exactly **10** `computedStyles`
(`dom/enhanced_snapshot.py:17`, with the comment that asking for more "prevents Chrome crashes on
heavy sites"); `DOM.getDocument(depth=-1, pierce=True)`; `Accessibility.getFullAXTree` **per frame**
(root-frame failure propagates, child-frame failures are skipped); `Page.getLayoutMetrics`.

That is our pipeline, with three details we do not have:

1. **`getEventListeners` for click handlers.** One `Runtime.evaluate` with
   `includeCommandLineAPI: True` calls the DevTools-only `getEventListeners(el)` over
   `document.querySelectorAll('*')` (`dom/service.py:465-560`), bails above 10,000 elements, caps at
   `_MAX_JS_CLICK_LISTENER_ELEMENTS = 100` matches, resolves objectIds in batches of 20 via
   `DOM.describeNode`, then `Runtime.releaseObject`. This is how a React `onClick` on a bare `<div>`
   becomes interactive.
2. **`cursor: pointer` as the last interactivity signal**, from the 10 computed styles
   (`dom/serializer/clickable_elements.py::ClickableElementDetector.is_interactive`). Our plan item
   1.6 calls this "the one signal that survives React's root event delegation"; it is unshipped.
3. **A `viewport_threshold = 1000` px slack** in
   `DomService.is_element_visible_according_to_all_parents` (`service.py:252`) — elements up to
   1000 px outside the viewport count as visible, after walking the frame chain in reverse, adding
   each iframe's offset and subtracting each `HTML` node's `scrollRects`.

**What we should change.** `browser/chromium-apis/ax-tree-extractor.ts` already takes one
`DOMSnapshot` per session; add `cursor` and `pointer-events` to the computed styles it requests and
surface `cursor: pointer` as a clickability signal and `cursor: not-allowed` as disabled (plan 1.6,
**adopt**). The `getEventListeners` pass is a single capped `Runtime.evaluate` and does not break
"no injected perception script" in spirit — it injects nothing, it asks the debugger — but it does
cost a round trip on every read; **adapt**, gated to pages where the AX tree yields few interactive
elements (we already detect that: `SPARSE_READ_ELEMENTS`).

### 2.2 Occlusion: paint order plus a rectangle union, per iframe

`dom/serializer/paint_order.py` (2026-07-23). `PaintOrderRemover.calculate_paint_order()` groups
nodes by `snapshot_node.paint_order`, iterates **descending**, and maintains a `RectUnionPure`
(disjoint rectangles with a 4-way `_split_diff`) **keyed per `(session_id, owning iframe frame_id)`**.
A node whose rect the union already `contains()` gets `ignored_by_paint_order = True`. A node joins
the occluder union only if its `background-color != rgba(0,0,0,0)` **and** `opacity >= 0.8` (source
comment: *"this is highly vibes based number"*). `_MAX_RECTS = 5000`, after which `contains()`
returns False — **fails open**.

Ours (`ax-tree-extractor.ts::coveringLayer`) compares a single element against higher-paint-order
boxes and writes `attributes.covered`; it does not accumulate a union, so a target covered by the
*combination* of two overlapping panels is missed, and it does not gate on background/opacity, so a
transparent wrapper can read as a cover. **Adapt**: add the opacity/background gate (cheap, removes
false "covered") and the per-frame keying. The full rectangle union is more machinery than our 6.6
points justifies on its own — take it only if the fixture suite (§1.6) shows false negatives.

### 2.3 The batch: `terminates_sequence` and a URL guard

`max_actions_per_step: int = 5` (`agent/service.py:178`), hard-truncated after parsing.
`multi_act` (`agent/service.py:2730`) stops on: `done` at index > 0; `result.is_done` or
`result.error`; `registered_action.terminates_sequence` — declared on `search`, `navigate`,
`go_back`, `switch`, `evaluate`; and a **runtime guard that compares `get_current_page_url()` and
`agent_focus_target_id` before and after every action and aborts the rest on any change**.
`wait_between_actions = 0.1s`.

The prompt teaches the same taxonomy explicitly (`agent/system_prompts/system_prompt.md`,
`<efficiency_guidelines>`): page-changing (always last) = navigate/search/go_back/switch/evaluate;
potentially page-changing = click; safe to chain = input/scroll/find_text/extract/search_page/
find_elements/file ops.

Nanobrowser's `loop.ts` goes further: **consecutive read calls run in parallel via `Promise.all`**
and a failed read does not stop the group; mutates run one at a time with `stopsBatch` returning
true on an error, a navigation, a new tab, a hand-over, or a `click/set/type/press/fill_form` whose
`effect.verdict === 'none'` and postcondition not met. Skipped calls are labelled
(`SKIP_CHANGED`, `SKIP_STEERING = 'skipped: the user sent a message.'`, `SKIP_CONTROL`, `CUT_REPLY`).

**What we should change.** `agent/agents/navigator.ts::doMultiAction` stops on `revealedControls`
and a few error paths; it has no declared per-tool "terminates the sequence" and no URL/target-change
abort. Add both — a `terminatesSequence: true` flag next to `irreversible` in
`agent/actions/schemas.ts`, and a URL + tab check between actions — and let read-only tools
(`read_page`, `find_in_page`, `extract`, `save_findings`, `notes`) chain freely after a mutation
instead of ending the turn. R4 §8.3 prices this at 8.2M tokens, and 58% of the batchable pairs
follow a read-only action. **Adopt.**

### 2.4 Serializer details worth copying

- Attribute values capped at **100 chars** (`cap_text_length(value, 100)`, `dom/views.py`,
  `serializer.py:1398`); `class` deliberately excluded from `DEFAULT_INCLUDE_ATTRIBUTES`.
- **`input[type=password]` never emits `value` or `valuetext`** from DOM or AX
  (`serializer.py:1292-1300`), with the comment citing prompt-injection exfiltration. We have
  `{{secret_N}}` placeholders on the input side; check the *output* side of
  `browser/dom/views.ts::clickableElementsToString` for the same. **Adopt**, cheap.
- Synthesized attributes: `format=YYYY-MM-DD` for HTML5 date inputs with jQuery/Bootstrap/
  `uib-datepicker-popup` sniffing, `placeholder=123-456-7890` for `tel`, and
  `compound_components=(name=…,role=…,min=…,max=…,current=…,count=…,options=a|b|c|d,format=…)` for
  grouped widgets with options capped at 4 (`serializer.py:1225-1290`). That last one is the
  **slider / custom-select** shape we are missing (R4: 10 tasks, 4.4 points) and it costs one line
  per widget. **Adopt** in `browser/dom/views.ts`.
- **Containment filtering**: `PROPAGATING_ELEMENTS` (`a`, `button`, `div[role=button]`,
  `div/span[role=combobox]`, `span[role=button]`, `input[role=combobox]`) swallow descendants that
  are ≥ `DEFAULT_CONTAINMENT_THRESHOLD = 0.99` contained in them, excepting text nodes, form
  controls, other propagating elements, `onclick`, non-empty `aria-label`, and
  `role in {button,link,checkbox,radio,tab,menuitem,option}` (`serializer.py:772-905`). This is
  shape work, not truncation; it is what R4 §8 means by "removes round trips, not evidence".
  **Adapt.**
- A scrollable container gets an index **only when it has no interactive descendants** — except
  dropdown containers (`role in {listbox,menu,combobox,menubar,tree,grid}`, `<select>`, or a class
  containing `dropdown`/`select-menu`), which are always indexed (`serializer.py:722-745`). Plan
  item 1.4 wants scroll containers surfaced; this is the admission rule that keeps it from doubling
  the list. **Adopt.**

### 2.5 `extract` done properly

`tools/service.py:1067-1310`: page → markdown (`dom/markdown_extractor.py`) →
`chunk_markdown_by_structure(content, max_chunk_chars=100000, start_from_char=…)` returning
`has_more`, `char_offset_end`, `chunk_index`, `total_chunks` and an **`overlap_prefix`** so a
continuation chunk carries its table headers; the result text tells the model the exact
`start_from_char` to resume at. `output_schema` is a JSON Schema converted to a Pydantic model by
`tools/extraction/schema_utils.py::schema_dict_to_pydantic_model`, **falling back to free text on
`ValueError`/`TypeError`** rather than erroring. An `already_collected: list[str]` (first 100)
dedupes across pagination.

R4 §3 is explicit that our `extract` schema argument was a regression: *"Rejected 27 times across 13
tasks; 7 runs died outright. The model invents `selector`/`attribute`/`pattern` keys and single
quotes, gets rejected, and retries the same thing."* `agent/actions/handlers/content.ts:399` still
does a bare `JSON.parse` and returns an error. **Adopt the fallback**: on a parse or shape failure,
do not error — run `read_page(mode: 'main')` and return the markdown with a one-line note. Cap at
two attempts. That is R4 §7.4, 1.3 points plus 7 dead runs, and it is a ten-line change.

### 2.6 Other Browser Use mechanisms

- **Downloads**: `watchdogs/downloads_watchdog.py` (2026-07-21) sets `Browser.setDownloadBehavior`
  per target, handles `Page.downloadWillBegin`/`downloadProgress`, **and** sniffs
  `Network.responseReceived` for `content-type: application/pdf` or
  `Content-Disposition: attachment`, downloading out of band; PDF-viewer detection cached per URL;
  `_session_pdf_urls` dedupes. Our `AgentContext.downloads` is `chrome.downloads` events only.
  **Adapt** if downloads matter to the product; not priced in R4.
- **Provider fallback**: `_try_switch_to_fallback_llm` (`agent/service.py:1983`) switches
  permanently to a `fallback_llm` on `ModelRateLimitError`, `ModelOutputTruncatedError` or status in
  `{401,402,429,500,502,503,504}` — once per run. R4 §5: *"31% of 9,281 model attempts failed,
  almost all 429… Every one of the 20 slowest steps in the run is throttle."* Our orchestration
  governor can downgrade models but single-task runs cannot. **Adopt** a one-shot fallback model in
  `agent/agents/base.ts` before `RATE_LIMIT_BUDGET_MS` pauses the task.
- **Vision policy `use_vision='auto'`** (`agent/service.py:169`): the screenshot *tool* is registered
  and the model must ask for it; with `True`/`False` the tool is force-excluded. That is exactly our
  `view_screenshot` design. **We already do this** — keep it.
- **`search_page` and `find_elements`** are zero-LLM-cost tools (grep over page text with optional
  regex and a CSS scope; CSS selector → tag/text/attributes). Our `find_in_page` is the first;
  we have no second. See §3.2.

---

## 3. Playwright MCP and Chrome DevTools MCP — the reference snapshot formats

### 3.1 The format

Playwright's AI snapshot (`packages/injected/src/ariaSnapshot.ts`, 2026-10-08 →
`ariaSnapshotDistiller.ts`, 2026-07-29 → `packages/isomorphic/ariaSnapshotRenderer.ts`) renders one
node per YAML list item:

```
- button "Submit" [disabled] [active] [ref=e17] [cursor=pointer] [box=12,40,88,32]
```

The `ai` mode is `{visibility: 'ariaOrVisible', refs: 'interactable', includeGenericRole: true,
renderActive: true, renderCursorPointer: true}` (`toInternalOptions`, `ariaSnapshot.ts:58-78`).
Refs are minted **only** for nodes that are `box.visible` *and* `receivesPointerEvents`. `url` and
`placeholder` render as child props. Names above 900 chars are dropped (YAML's 1024-char key limit).
Frames get a `refPrefix`, yielding `f2e17`.

Chrome DevTools MCP renders `uid=<snapshotId>_<counter> <role> "<name>" <attr>="<val>"`, 2-space
indent, with ` [selected in the DevTools Elements panel]` on the DevTools selection
(`src/formatters/SnapshotFormatter.ts`, v1.11.0, 2026-10-15).

Two pruning rules were invented independently by both and we have neither:
`removeNameRepeatingChild` / `#hasRedundantTextChildren` — drop a node's children when they are all
childless text whose concatenation equals the parent's accessible name — and
`unwrapSingleChildGenerics` / `inlineTextIntoGeneric`. **Adopt** both in
`browser/dom/ax-tree-pruner.ts`; they are pure shape and cost nothing in evidence.

The distiller's contract is the part that matters most:
*"Plugins mutate the tree in place; `snapshot.info` and `snapshot.refs` are left intact, so refs of
removed nodes still resolve through the aria-ref selector engine."* **Token pruning and element
addressing must be decoupled.** Our indexes are allocated by the pruner
(`ax-tree-pruner.ts:14-16`), so every pruning change silently renumbers the page. Fixing §1.1 fixes
this too.

### 3.2 `browser_find` — grep the snapshot, return windows with ancestors

`packages/playwright-core/src/tools/backend/find.ts` (2026-09-30) renders the AI snapshot, greps it
line-wise (substring or `/regex/flags`), emits `grep -C 3`-style windows, **coalesces overlapping
windows**, and prefixes each window with the **ancestor path reconstructed from indentation**
(`ancestorIndices`), inserting `...` gap markers. Its own description: *"cheaper than capturing the
whole snapshot when you only need to locate an element and its ref."*

Our `find_in_page` greps the *text extraction*, not the element outline, and returns surroundings
plus the index of the element carrying the match. It is close. The missing piece is the **ancestor
path**, which is what tells the model whether the match is inside the filter panel or the results
grid. **Adapt**: add the indentation-derived ancestor path to `find_in_page`'s snippets in
`agent/actions/handlers/content.ts`. Cheap, and it attacks "find the right page instead of
circling" (14 tasks, 6.1 points).

### 3.3 `element` + `target`, and the stale-ref message

`backend/snapshot.ts:25-32`: every element-taking tool carries
`element: z.string().optional().describe('Human-readable element description used to obtain
permission to interact with the element')` and `target: z.string()`. `ref` was renamed to `target`
on 2026-04-15 (`feat(api): Page.hideHighlight, rename ref → target (#40219)`) and `target` now
accepts a plain selector too; `element` became optional. The stale-ref error is the recovery
instruction itself: `` `Ref ${target} not found in the current page snapshot. Try capturing new
snapshot.` `` (`backend/tab.ts:549-575`).

The human-description field is worth noting and **rejecting as a requirement**: it is `.optional()`
upstream now, and we already get the same self-consistency check free from the required `memory`
field on every tool. Keep the error-message discipline instead — ours already names candidates,
which is better (R4 §9).

### 3.4 Neither server diffs snapshots

Playwright MCP re-renders the full snapshot on every mutating tool
(`response.setIncludeSnapshot()`); the only diff-like behaviour is rendering the tab header *only
when changed* (`backend/response.ts:293-298`). Chrome DevTools MCP likewise. They attack size with
pruning, `browser_find`, a `depth` limit, `filename` spill-out to disk, and `--snapshot-mode=none`.

This matters for the §1.1 recommendation: **nanobrowser is the only one of the four that diffs**,
and it can only do it because its refs are durable and `applyDiff` verifies the result. Do not ship
a diff without the verification step.

### 3.5 What Chrome DevTools MCP has that no agent hand-rolls

`docs/design-principles.md` (12 lines) is worth quoting in full as a tool-design rubric:
*Agent-Agnostic API · Token-Optimized ("Return semantic summaries. 'LCP was 3.2s' is better than 50k
lines of JSON") · Small, Deterministic Blocks ("composable tools (Click, Screenshot), not magic
buttons") · Self-Healing Errors ("Return actionable errors that include context and potential
fixes") · Human-Agent Collaboration · Progressive Complexity · Reference over Value ("for heavy
assets… return a file path or resource URI, never the raw data stream").*

Concretely: `performance_start_trace` → `performance_stop_trace` returns **named insight sets**, and
`performance_analyze_insight {insightName, insightSetId}` drills in; the raw trace goes to a file and
never enters context. `list_network_requests` is paginated. `get_css_styles` resolves computed and
matched styles **by uid**. `emulate` replaces all emulation settings in one atomic call.
`wait_for {text: string[]}` resolves when *any* listed text appears.

For us: **`wait_for` taking an array of texts is a one-line schema change** in
`agent/actions/schemas.ts` and removes a class of "wait for A, then wait for B" loops. **Adopt.**
The network/performance surface is **reject** — it is a debugging product, not an agent need, and
R4 shows no failures it would convert.

`emulate` is worth one sentence of its own: R4 §10 names *"the browser geolocates to India… the
largest non-agent distortion in the score"*. That is a harness problem, not an agent one, but
`chrome-extension/e2e/run.mjs` should pin geolocation the way it already pins language and timezone.

---

## 4. Stagehand / Browserbase and Skyvern

Both trees read 2026-10-16.

### 4.1 Stagehand moved *into* a Chrome extension, and deleted its agent

The `lib/a11y/utils.ts` everyone cites is gone from `main`. Stagehand is now a monorepo
(`packages/{sdk-ts,sdk-python,sdk-go,protocol,extension,evals,cli,docs}`) whose **entire engine runs
inside a Chrome extension** (`packages/extension/`) talking JSON-RPC to a thin SDK, with a
package-internal Playwright replacement called *understudy*
(`packages/extension/understudy/`). The company whose product is a cloud browser moved its engine
into the same place we live. That is the single most useful external validation of our architecture
in this brief.

And `agent()` is gone. `packages/docs/v4/migrations/v3.mdx` (2026-09-22), verbatim: *"`agent()` is
gone. Nothing in v4 replaces it one-for-one"* — it *"was built for models that couldn't reliably
drive a browser on their own"*. The replacements are **code mode** (a coding assistant writes a
Stagehand script you run) and **CUA toolsets**
(`packages/docs/v4/integrations/agent-frameworks/{claude,openai}-cua-toolset-quickstart.mdx`). The
operator prompts still sit in `packages/extension/prompt.ts` (2026-10-13) with no v4 caller.

**Verdict: reject the removal.** It is a bet that the frontier model drives the browser itself, and
D5 forbids us that bet. But note what it implies: Browserbase now believes the durable value is in
the *deterministic layer*, not the loop — which is the same conclusion nanobrowser 0.3 reached by
putting a model-free `browser-control` package under a thin agent.

### 4.2 `EncodedId`, and the second independent case for diffing

`packages/extension/understudy/a11y/snapshot/capture.ts` (2026-10-01): per frame,
`Accessibility.getFullAXTree` over CDP plus a per-session DOM index for tag names, scrollability and
absolute XPaths. The id is literally `` `${page.getOrdinal(frameId)}-${backendNodeId}` `` (the `enc`
lambda in `collectPerFrameMaps`), and the schema enforces it:
`elementId: z.string().regex(/^\d+-\d+$/)` (`packages/extension/inference.ts`, 2026-09-01), with the
system prompt spelling out *"if the tree shows [0-18372], return elementId "0-18372"; never return
only "18372""*. Rendering is `[0-18372] button: Add to cart [checked]`, two-space indent
(`treeFormatUtils.ts::formatTreeLine`); child frames are spliced under their host iframe line by
`injectSubtrees`. Pruning (`a11yTree.ts::buildHierarchicalTree`, `pruneStructuralSafe`) drops
`generic|none|InlineTextBox`, collapses single-child structural nodes, renames generics to the real
tag, promotes `combobox`→`select` for a real `<select>`, strips StaticText children whose
concatenation equals the parent name, and relabels scrollables as `scrollable, <tag>`.

The resolved artifact is **an absolute XPath**, not a backendNodeId:
`xpathUtils.ts::absoluteXPathForBackendNode` does `DOM.resolveNode({backendNodeId})` →
`Runtime.callFunctionOn(nodeToAbsoluteXPath)`, prefixing each iframe hop
(`buildAbsoluteXPathFromChain`) — because the artifact has to survive a page load to be cacheable.

**And `act` diffs the tree.** `packages/extension/services/actService.ts` (2026-10-05): when the
model sets `twoStep: true` — the custom-dropdown case — it re-snapshots, calls
`diffCombinedTrees` (`understudy/a11y/snapshot/treeFormatUtils.ts`) and sends **only the changed
lines** to `buildStepTwoPrompt`. Expanding a dropdown produces a small delta, so step two is cheap
and unambiguous.

That is the second project, arrived at independently of nanobrowser, that answers "a widget just
opened, what is on screen now" with a tree diff rather than a fresh page read. We answer it with
`revealedControls` in `agent/validation/observation.ts`, which stops the batch and names up to five
revealed options. That is the right *trigger* with the wrong *payload*: we then re-send the whole
element list on the next step. **Adopt** — once §1.1 lands, `revealedControls` should hand the
navigator a diff of the opened widget, not a sentence plus a full re-read. This is the cheapest
route to the custom-select and autocomplete classes (4.4 + 1.8 points).

### 4.3 Stagehand's two anti-hallucination tricks

1. **URLs are never written by the model.** `extractService.ts` +
   `inference.ts::extract`: `transformUrlStringsToNumericIds` rewrites every URL-typed field in the
   caller's schema into a numeric DOM id before the call, the system prompt says *"If a user is
   attempting to extract links or URLs, you MUST respond with ONLY the IDs of the link elements"*,
   and `injectUrls` substitutes the real URLs afterwards from `combinedUrlMap` (built in
   `a11yTree.ts` from the AX node's `url` property).
2. **Secrets never enter the prompt.** `act` keeps variables as `%name%` placeholders through the
   model (`buildActVariablesPrompt`) and `substituteVariablesInArguments` fills them at dispatch.

**What we should change.** We have (2) for passwords only (`{{secret_N}}`,
`agent/validation/service.ts`). (1) we do not have, and R4 §6 prices the answer layer at 10.5 points
with *"a name instead of a code"* and fabricated citations among the failures (our `assert` tool
caught some of those — §9). In `agent/actions/handlers/content.ts::handleExtract`, when a schema
field is URL-typed, ask the model for the element index and substitute the real `href` from the
page read. Ten lines, removes a whole class of unbacked answer. **Adopt.**

### 4.4 Stagehand's cache is a replay that self-heals — and the key is closed

`packages/extension/services/cacheService.ts` (2026-10-05): `withCache({method, page, data, …})`
wraps all three primitives, shipping the **raw CDP tree + URL + request params** to the Browserbase
API, which *"owns all cache-key computation (DOM shaping/hashing, URL normalization), project
gating, and the Redis read/write"* — i.e. the interesting part is closed-source and unverifiable.
On a hit, `actService.ts::replayCachedActions` re-executes the cached `Action[]` **with
`selfHeal: false`**, and *"any failure throws so the cache intercept falls back to the full
inference pipeline, which doubles as the self-heal path for stale cached selectors"*; the miss is
recorded as `missReason: "replay_failed"`. Inline, `selfHealAction` re-snapshots and re-infers on a
live selector failure, but rethrows `TimeoutError` rather than healing it.

**Verdict: reject the cache** (D1 — it is a server round trip), **adopt the shape**. Our
`agent/memory/global/memory-store.ts` stores routes advisorily. The pattern worth copying is
*replay-first, fall through to inference on any failure, record why* — which is what
`agent/agents/navigator/replay.ts` should do, and the `missReason` label is what makes route memory
measurable instead of a vibe.

### 4.5 Stagehand's eval verifier gates — read these before the next run

`packages/evals/docs/verifier-gates.md` (README 2026-10-12). A judge pass is **rejected** when the
final answer is empty or the trajectory contains no browser tool calls; verifier errors fail closed
as `ungraded`; `processScoreStrict` zeroes `evidenceInsufficient` criteria while keeping their
weight in the denominator; and `EVAL_REQUIRE_GROUNDING=1` **rejects a numeric answer with no
matching observation from a known page**. Datasets are vendored as JSONL
(`datasets/{webvoyager,onlineMind2Web,webtailbench,odysseysbench,hardbenchmark}/`) and ~10 harnesses
(`framework/{claudeCode,claudeCua,codex,cursor,deepagents,eve}Runner.ts`) run against interchangeable
tool backends (`core/tools/{stagehand_facade,playwright_mcp,chrome_devtools_mcp,cdp_code,
browse_cli}.ts`).

R4 §1 says **25 of the 46 score flips between r3 and r4 are tasks both rounds finished `task.ok`** —
answer quality or judge variance, not capability. `EVAL_REQUIRE_GROUNDING` is the direct answer:
a numeric answer whose number appears in no observation should not score. **Adopt** in
`chrome-extension/e2e/mind2web/` before the next run; it costs nothing and it makes r5 comparable.
No published accuracy numbers exist in the Stagehand repo — *unverified*.

### 4.6 Skyvern: the agent is not allowed to declare itself done

`skyvern/forge/agent.py` (2026-10-16) `complete_verify` (line 6766) and `check_user_goal_complete`
(line 6939) **re-scrape the page** (`scraped_page.refresh`) and render `check-user-goal.j2`
(2026-07-30) with `{navigation_goal, navigation_payload, complete_criterion, terminate_criterion,
big_goal_context, action_history, elements, screenshots, local_datetime}`, returning
`CompleteVerifyResult{is_complete, is_terminate}`. Two call sites: **periodic**
(`verification_trigger="periodic_after_step"`, from `_handle_completed_step_with_parallel_
verification` at line 10182, which races verification against speculative pre-scraping of the next
step under `PARALLEL_VERIFICATION_TIMEOUT_SECONDS`), and **forced** — a model-emitted
`CompleteAction` with `verified=False` is re-judged in
`webeye/actions/handler.py::handle_complete_action` (line 10986, 2026-10-14) and **a rejection
becomes `ActionFailure(IllegitComplete)`**. An `is_terminate` verdict rewrites the action into a
`TerminateAction` in place.

This is the third independent implementation of §1.3 (nanobrowser's debt ledger, our
`done-evidence.ts`, Skyvern's forced re-verify), and the only one with a published score: README
claims **85.8% WebVoyager** and **64.4% WebBench**.

**Important correction to our own research.** Brief `11` attributes **+17 points** to Skyvern's
verification call. That number **appears nowhere in the Skyvern repository** and was not found by
search. Treat it as unsourced until someone produces the citation; the mechanism is real, the
magnitude is not established.

**What we should change.** Two things we do not have:
(a) **the verification call re-reads the page itself** (`scraped_page.refresh`) rather than judging
the state the acting call produced — our planner's completion check sees the same page state the
navigator saw; and (b) **parallel verification**, racing the check against pre-scraping the next
step, which is how they pay for it. (a) is a two-line change in `agent/executor.ts` (force a fresh
read before the completion check) and directly attacks the 31.6% wrong-`done` rate. **Adopt (a);
adapt (b)** only if latency becomes the binding constraint — R4 §5 says provider throttle is, not
page reads (7.7%).

### 4.7 Skyvern: element identity that survives a remount, and incremental trees

`skyvern/webeye/scraper/scraper.py` (2026-10-09) + `domUtils.js` (135 KB, injected):

- Every element is stamped with an injected attribute: `element.setAttribute("unique_id", …)`
  (`SKYVERN_ID_ATTR = "unique_id"`, `skyvern/constants.py`), and `build_element_dict` produces
  `id_to_css_dict` (`[unique_id='…']`), `id_to_element_hash`, `hash_to_element_ids`.
- `hash_element` is sha256 over the node after `clean_element_before_hashing` removes `id`, `rect`,
  `frame_index` and `unique_id`. **`structural_identity` additionally drops `xpath` and `frame`
  recursively**, so *"a control that a preceding action remounted at a new DOM position … still
  matches its pre-remount identity"*. The docstring is explicit that volatile ids (`rc_select_<n>`)
  are deliberately **not** normalized — the match *"must fail closed rather than be guessed at"*.
- `IncrementalScrapePage` (line 955) injects a MutationObserver
  (`start_listen_dom_increment` → `startGlobalIncrementalObserver`) and
  `get_incremental_element_tree` returns **only the nodes added since**. This is how dropdown and
  autocomplete popovers are read without re-scraping the page.
- What the model sees is **HTML, not JSON** (`scraped_page.py::json_to_html`), with `unique_id`
  stripped from non-interactable nodes (`trim_element`/`_should_keep_unique_id`), names truncated at
  500 chars, base64 dropped, and an `href` over 150 chars hashed into `{{_<sha256>}}` with a
  `hashed_href_map` for restoration. Three variants: `build_element_tree`,
  `build_economy_elements_tree`, `build_lean_elements_tree`.

**What we should change.** The injected `unique_id` attribute is the one thing here we should
*not* copy — it mutates the page and we have `backendNodeId`. But `structural_identity`'s
**fail-closed** rule is the correct policy for §1.1 and the direct argument against
`browser/dom/selector-healer.ts`: a remembered element either matches its structural fingerprint or
the reference errors; it is never scored and guessed. And the href-hash with a restoration map
(`{{_<sha256>}}`) is a cheap, evidence-preserving way to keep long tracking URLs out of the element
list — ours are capped by `MAX_INTERACTIVE_ELEMENTS_CHARS` wholesale instead. **Adopt both rules;
reject the DOM mutation.**

### 4.8 Skyvern: the deterministic widget work, which is the best in the field

`skyvern/webeye/actions/handler.py` (794 KB, 2026-10-14):

- `handle_select_option_action` (10421): a custom option degrades to `chain_click`; a
  non-selectable target goes to `find_selectable_child`; a `wait_until_enabled` gate raises
  `InteractWithDisabledElement`; **an already-selected value is an idempotent no-op**; a visible
  native `<select>` takes `normal_select` (Playwright `select_option`, which commits under
  overlays); a **hidden** native `<select>` goes to `find_blocking_element` and clicks the styled
  surrogate.
- Custom dropdowns: `select_from_dropdown` (14974) opens the widget, `locate_dropdown_menu`,
  `try_to_find_potential_scrollable_element` + **`scroll_down_to_load_all_options`** to force lazy
  lists to render, reads the **incremental** tree, and only then asks the model
  (`custom-select.j2`, `opened-dropdown-confirm.j2`, `confirm-multi-selection-finish.j2`).
  Deterministic pre-matching first: `classify_option_match`, `_best_select_shadow_index`,
  `_unique_select_shadow_index`.
- Autocomplete: `input_or_auto_complete_input` (12727) — type, have the model propose five
  candidate values (`auto-completion-potential-answers.j2`), try each, tweak
  (`auto-completion-tweak-value.j2`), choose (`auto-completion-choose-option.j2`), and prove the
  commit with `_click_autocomplete_option_with_commit_evidence`. Capped at
  `MAX_AUTO_COMPLETE_ATTEMP = 1` *"to speed up skyvern"*.
- Per-action read-backs, by handler, not generic: `_verify_autocomplete_input_readback`,
  `_verify_autocomplete_option_identity`, `_autocomplete_commit_evidence`,
  `_verify_tel_input_after_fill` / `verify_phone_input_digits`, `_click_is_redundant`,
  `_ui_select_commit_result`.
- Uploads reject hallucinated URLs: `file_url` must appear in `navigation_goal` /
  `navigation_payload`, else `_find_similar_url_in_text` recovers a verbatim user URL or it returns
  `ActionFailure(ImaginaryFileUrl)` — the same idea as our `inventedPersonalData`.
- Datepickers are *weak*, even here: `isDatePickerSelector` matches only
  `<button data-testid*="date">`; the real path is `InputOrSelectContext.is_date_related` routed
  through the select/autocomplete code plus `check-date-format.j2`. Our
  `toNativeInputValue` handling of native date inputs (`browser/page.ts`) is better than theirs.

**What we should change.** Two deterministic steps, both missing from us and both named in R4:
**scroll the opened dropdown to load all options before reading it** (lazy option lists are part of
the 4.4-point custom-widget class), and **an already-correct value is a validated no-op** rather
than a click (plan 2.4, and it removes a slice of the 1,682 exact repeats). `select_dropdown_option`
and `fill_form` *"landed first try every time they were used"* (R4 §9) — the loops happen where the
agent clicks instead, which is exactly where these two rules bite. **Adopt.**

### 4.9 Skyvern: compiling a successful run into code, with per-action AI fallback

`skyvern/core/script_generations/` (`CLAUDE.md` 2026-09-02, `generate_script.py` 178 KB 2026-10-13,
`skyvern_page.py` 174 KB 2026-10-13). A successful workflow run is compiled per block into Python
via libcst; `run_with: code` requires *every* top-level block to have a `script_block` and a
non-null `run_signature`, else the whole run falls back to `run_with: agent`. Conditional blocks are
never cached; branches cache progressively across runs. `_build_semantic_selector` (line 374)
prefers `aria-label` → `placeholder` → `name` → `:has-text(text)` over a raw XPath, and where no
semantic selector exists it emits a stable
`recoverable_marker_id = crc32(xpath|intention|reasoning|action_id) & 0x7FFFFFFF` so a later run can
upgrade the call. Every generated call carries `ai="fallback"`; the click path
(`skyvern_page.py:494-590`) is: try the selector with retry → `_click_is_redundant` guard → on
failure **press Escape to dismiss an overlay** and retry once → only then
`ai_click(selector=None, intention=…, failed_selector=…, recoverable_marker_id=…)`.

**Verdict: reject the compiler, adopt two details.** A code-generating path is a second runtime we
cannot afford inside an extension, and 09 already found strict admission is what makes memory help
at all. But: (a) **the semantic-selector preference order** (`aria-label` → `placeholder` → `name` →
text) is exactly what `agent/memory/global/memory-store.ts` should store instead of "element role",
and (b) **press Escape and retry once before giving up on a click** is a two-line addition to
`browser/page.ts` that pairs with the actionability retry in §1.4 and with our existing
`coverBlocker` message.

---

## 5. The platform: what Chrome now offers that we hand-roll

Current stable is Chrome 155 (2026-10-06).

### 5.1 The Prompt API is not available in a service worker — plan around it

`third_party/blink/renderer/modules/ai/language_model.idl` declares
`[Exposed(Window AIPromptAPI, Worker AIPromptAPIForWorkers), RuntimeEnabled=AIPromptAPI,
SecureContext]`, and `AIPromptAPIForWorkers` in `runtime_enabled_features.json5` has **`public: true`
and no `status:` field**, i.e. disabled on every platform. `AIPromptAPI` itself is `status: stable`
on desktop; `AIPromptAPIMultimodalInput` and `AIPromptAPIStructuredOutput` are stable;
`AIPromptAPIToolUse` is experimental behind `chrome://flags/#prompt-api-tool-use`. Shipping history
(`https://developer.chrome.com/docs/ai/built-in-apis`, updated 2026-08-26): Translator /
LanguageDetector / Summarizer stable in Chrome 138 for web and extensions; **Prompt API stable in
Chrome 138 for extensions only**, Chrome 148 for the web; Writer/Rewriter still developer trial;
Proofreader origin trial.

So `LanguageModel` can only be called from a document — side panel, options page, or an offscreen
document — and relayed to our worker. Model is Gemini Nano; `responseConstraint` takes a JSON Schema
or a regex, with `omitResponseConstraintInput` and `measureContextUsage()`; hardware floor is 22 GB
free disk, >4 GB VRAM or 16 GB RAM + 4 cores, desktop only, and an enterprise policy can disable it.

**What we should change.** Nothing structural. Under D5 (provider-agnostic) Nano cannot be the
planner or navigator. The one place it fits is the **page-blind intent check** in
`agent/validation/service.ts`, which today costs a full provider round trip and R4 §3 says fired on
38 tasks: it is a short, local, schema-constrained classification over the user's own text. Add it
as an optional provider in `packages/storage/lib/settings/llmProviders.ts` + a branch in
`agent/helper.ts::createChatModel`, used from the side panel context, never required. Also:
**delete any `"aiLanguageModelOriginTrial"` permission** — it is expired. **Adapt, low priority.**

### 5.2 `chrome.automation` is allowlisted — our CDP path is correct

The public docs page 404s and the API is absent from the extension API index.
`extensions/common/api/_manifest_features.json` gates the `automation` manifest key behind an
**allowlist of four SHA-1 extension-ID hashes**. A Web Store extension cannot declare it. There is
nothing to adopt; this confirms `Accessibility.getFullAXTree` over `chrome.debugger` is the only
route. **Reject (unavailable).**

### 5.3 WebMCP — real, shipping in the tooling, not yet in Chrome

chromestatus feature 5117755740913664: maturity *"Specification being incubated in a Community
Group"*, Chrome status *"Proposed"*, `is_released: false`, origin trial desktop/Android/WebView
149 → 156, extension end 162. The entry point is **`document.modelContext`**, not
`navigator.modelContext` (both `https://developer.chrome.com/docs/ai/webmcp/imperative-api`, updated
2026-10-15, and the WICG repo use `document.modelContext`). Shape:
`await document.modelContext.registerTool({name, description, inputSchema, execute, annotations:
{readOnlyHint, untrustedContentHint, consequentialHint}}, {signal, exposedTo})`; discovery
`getTools()`; invocation `executeTool(tool, args, {signal})`, returning `null` if the call
navigates; `toolchange` event; gated by a `tools` Permissions Policy. **There is no WebMCP extension
API** — `https://developer.chrome.com/docs/ai/webmcp` (2026-10-07) says extensions reach it through
content scripts.

Both MCP servers already ship it. Playwright has it **on by default** (`--no-webmcp` to disable):
`backend/webmcp.ts` (2026-10-02) fans `frame.webmcp.tools({timeout})` over all frames
**concurrently with the aria tree walk "so its latency hides behind the tree walk"**
(`tab.ts:452`), exposes `browser_webmcp_list` / `browser_webmcp_call` with names prefixed
`webmcp_<sanitized name>`, renders them above the snapshot, reports
`- N webmcp tools available on the page` in the tab header, and marks them
*"Tool names, descriptions and schemas are page-provided and untrusted"*. Chrome DevTools MCP has
it behind `--categoryExperimentalWebmcp`.

**What we should change.** This is cheap and additive and it does not break D1: nothing is fetched
from a third party, the page declares its own tools. In `pages/content`, call
`document.modelContext?.getTools()`; pass the list to `agent/actions/builder.ts` as dynamically
registered tools named `webmcp_*`, each dispatching through `executeTool`. Two rules, both taken
from Playwright: the tool list is **untrusted page content** and must go through
`agent/messages/utils.ts::wrapUntrustedContent` like any other page text, and the latency must be
hidden behind the AX read, not added to it. Hold it behind a capability flag until chromestatus says
shipped.

**Verdict: adapt, behind a flag.** The risk is that a page declares a `buy_now` tool and the model
calls it: `consequentialHint` must map onto our `commits` gate, and a page-declared tool must never
be exempt from `commitTarget()`.

### 5.4 Chrome 155 restricts `chrome.debugger` on managed browsers

`https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions` (2026-09-08, updated
2026-09-16): a non-empty `runtime_blocked_hosts` in the `ExtensionSettings` policy makes
`chrome.debugger.attach()` fail on **all** targets with `"Host access is restricted by policy."` —
even for origins in `runtime_allowed_hosts` — because *"CDP operates beneath the web platform's
origin model, so origin-based filtering cannot securely restrict it… all-or-nothing model"*.
`DisableScreenshots` or a DLP rule gives `"Screenshot capture is restricted by policy."` The escape
hatch `--disable-features=ExtensionDebuggerStrictPolicyRestrictions` is **removed in Chrome 160**.
Unmanaged profiles are unaffected.

**What we should change.** `chrome-extension/src/background/adapters/ChromeBrowserAdapter.ts` and
`browser/context.ts` — match those two exact strings on attach rejection and surface a real message
in the side panel ("your organisation's policy blocks this extension from controlling pages"). One
`if`. **Adopt.** Every corporate deployment of WebGenie hits this and currently gets a generic
failure.

Related, and already in our favour: **an attached `chrome.debugger` session keeps the MV3 service
worker alive** (Chrome 118;
`https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle`). We
should not add a keepalive hack on top of it. Flat sessions with `sessionId` since Chrome 125.
Chrome 148 exposes every extension API under `browser.*` as well.

The yellow "started debugging this browser" infobar has not changed and there is no supported way to
suppress it outside `--silent-debugger-extension-api` or enterprise force-install. *(Unverified
against Chromium source; no change was found.)*

### 5.5 Other MV3 agents on CDP

- **Playwright Extension** (`microsoft/playwright/packages/extension`, v0.4.0, MV3) is not an agent
  — it is a **CDP relay**. `src/relayConnection.ts` allowlists exactly five invokable commands
  (`chrome.debugger.attach|detach|sendCommand`, `chrome.tabs.create|remove`) and forwards four
  events; the server side (`mcp/cdpRelayV2.ts`, landed 2026-04-24, v1 deleted 2026-07-20)
  synthesizes `Target.setAutoAttach / createTarget / closeTarget / getTargetInfo` from a
  `BrowserModel` so Playwright sees a normal browser, and blocks CDP until the extension has pushed
  every existing tab and sent `extension.initialized`.
  **The part to steal is its re-attach handling**: `REATTACH_DELAY_MS 150`,
  `REATTACH_VERIFY_MS 2500`, `REATTACH_COOLDOWN_MS 3000`. Our debugger-detach path goes straight to
  `executor.interrupt()`. A bounded reconnect before interrupting is a small change in
  `browser/context.ts` and saves a checkpoint round trip. **Adopt.**
- **Stagehand's `packages/extension`** (§4.1) is the other serious MV3 agent engine: `understudy`
  replaces Playwright, perception is `Accessibility.getFullAXTree` per frame over CDP, and the SDK
  talks JSON-RPC to it. It is the same shape as ours, built by a company whose business is a cloud
  browser. Worth tracking as the closest *non-fork* comparison.
- **nanobrowser-v2** (a third-party fork, MV3 + native messaging): injects a page script that builds
  an accessibility snapshot where each actionable element gets a `[ref=eNN]` handle, and uses
  **tiered input** — plain DOM events first, falling back to the debugger/CDP tier only when a site
  demands trusted input, which avoids the yellow banner for most steps. Interesting, and **reject**:
  untrusted events are exactly what a bank's login form ignores, we would discover the tier was
  wrong only after the action silently failed, and R4 already has 13 tasks of "action sent but had
  no effect".
- **midscene.js** (`web-infra-dev/midscene`) is screenshot/VLM-first and explicitly *"avoids sending
  large DOM trees to the model"*. That is the vendor-grounding-model design 08 and 11 already
  rejected for us under D5. **Reject.**
- **BrowserOS** is a Chromium fork, not an extension — not comparable.
- **Browser Use has no first-party extension** (verified: zero `manifest.json` outside
  `browser_use/mcp/`, zero `chrome.debugger` usage).

---

## 6. The five best changes, ranked by benefit to risk

| # | Change | Files | Tied to | Risk |
| --- | --- | --- | --- | --- |
| 1 | **`expect` postcondition + read-back receipt on every mutating action** (nanobrowser `evidence.ts` / `text.ts`; Skyvern's per-handler read-backs) | `agent/actions/schemas.ts`, `agent/validation/service.ts::validateActionOutcome`, `browser/page.ts` | filters kept **11.4 pts**; "validation says `passed` when nothing happened"; action-with-no-effect 13 tasks | **Low** — optional argument, today's behaviour is the fallback |
| 2 | **Completion gated by code, not by the model's word** — a verification-debt ledger, plus a *fresh page read* before the completion check (nanobrowser `completion.ts`; Skyvern `complete_verify` + `IllegitComplete`) | `agent/validation/done-evidence.ts` (invert it), `agent/executor.ts` | answer layer **10.5 pts**; **31.6%** of `done` verdicts wrong | **Medium** — cap at two refusals, trace the false-refusal rate |
| 3 | **Durable element ids, fail-closed, + outline diff** (nanobrowser `refs.ts`/`diff.ts`, Browser Use `backendNodeId`, Playwright `computeAriaRef`, DevTools MCP `loaderId_backendNodeId`, Stagehand `EncodedId`, Skyvern `structural_identity`) | `browser/dom/ax-tree-pruner.ts`, `browser/dom/views.ts`, `agent/prompts/base.ts` (plan **1.12**, ungate) | 16.7% byte-identical pairs = **8.22M tokens / ~2 h**; wrong target **6.6 pts** | **High blast radius**, but the diff is verified by re-application and falls back to a full outline |
| 4 | **Read-only actions chain; `terminatesSequence` + URL-change abort ends a batch; a revealed widget returns a *diff*, not a re-read** (Browser Use `multi_act`, nanobrowser `stopsBatch`, Stagehand `diffCombinedTrees`) | `agent/agents/navigator.ts::doMultiAction`, `agent/actions/schemas.ts`, `agent/validation/observation.ts::revealedControls` | **41% of actions bought nothing**; 58% of batchable pairs follow a read-only action; custom widgets **4.4 pts** | **Low** — strictly fewer round trips, same actions |
| 5 | **A model-free fixture suite for the control layer** (nanobrowser `scenarios/` + `checks/`) | `chrome-extension/e2e/fixtures.mjs` → a fixture dir + golden outlines | covered targets **6.6 pts**, custom widgets **4.4 pts**, and it is what makes 1–4 safe | **None to the product** |

Note that 1, 2 and 3 are each implemented independently by three or more of the projects read here.
That is the strongest signal in this brief: the field converged, and we are outside the consensus on
all three.

Runners-up, each cheap and each with a named R4 number: `extract` falling back to `read_page`
instead of erroring (1.3 pts + 7 dead runs); URL fields answered by element index and substituted
after (Stagehand `transformUrlStringsToNumericIds`, part of the 10.5-point answer block);
Playwright-grade actionability retry with Skyvern's "press Escape and retry once" (6.6 pts);
`EVAL_REQUIRE_GROUNDING` in `chrome-extension/e2e/mind2web/` (25 of 46 r3→r4 flips were judge
variance); scroll an opened dropdown to load all options, and treat an already-correct value as a
validated no-op (4.4 pts, plan 2.4); `cursor: pointer` as a clickability signal (plan 1.6);
`compound_components` for sliders and custom selects; the Chrome 155 policy-error strings; a
one-shot fallback model before `RATE_LIMIT_BUDGET_MS` pauses the task (31% of 9,281 calls failed).

## 7. What we do better — do not lose this in a refactor

1. **Failure messages that carry the recovery.** `coverBlocker` names the covering dialog *and its
   dismiss buttons by index*; `select_dropdown_option` lists the real options; refusals offer
   near-match elements. R4 §9 records a task self-correcting in one step because of it. Chrome
   DevTools MCP has "Self-Healing Errors" as a written design principle; we have the best
   implementation of it in the field. Playwright's stale-ref message is one sentence; ours is a
   repair kit.
2. **A requirements checklist that is harness state, not prompt text.** Every plan carries
   `requirements` marked `applied` (with page-text or URL-parameter evidence) / `not_available` /
   `pending`; a new plan's list is *merged*, not substituted, so a validated application survives a
   reworded plan, and only evidence gone from the current page reopens it, once. Nobody else has
   this. Browser Use's `plan_update` / `[x] [>] [ ] [-]` markers are model-written text with no
   evidence binding; nanobrowser has no equivalent at all. This is the mechanism behind "site-native
   filters and sorts for superlatives — the main driver of judged success" (R4 §9).
3. **Safety that is written by the system, not the model.** System-authored commit confirmations
   with the amount read off the page, `{{secret_N}}` password placeholders that never reach the
   model, page-blind intent checks that see only the user's text, `inventedPersonalData`, the
   one-list-entry-per-form guard, and defanged `nano_*` delimiters with zero-width handling. R4 §9:
   every guard "fired proportionately". Upstream nanobrowser 0.3 replaced this with Ask/Auto modes
   and per-site rules — simpler and more predictable, but it cannot tell "Place order" from
   "Next page". Keep ours; add their per-site policy as an outer, user-set gate.
4. **The planner split itself, for weak models.** Both nearest relatives merged planner into one
   agent in the last six months, and Stagehand deleted `agent()` outright on the grounds that it
   *"was built for models that couldn't reliably drive a browser on their own"*. Under D5 that is
   precisely the model class we must serve, and 07 and 11 found the split helps there. Keep it —
   and keep the completion *refusal*, which caught the 67,150-vs-1,029 answer.
5. **Native date and time inputs.** `browser/page.ts::toNativeInputValue` parses ISO,
   `05/20/2024`, `20/05/2024` (disambiguated when the first part exceeds 12), `May 20, 2024`,
   `3:30 PM` and sets the value directly, with an error naming the expected format when it does not
   parse. Skyvern — the project with the most deterministic widget code in the field — handles
   datepickers through `isDatePickerSelector`, which matches only
   `<button data-testid*="date">`, and otherwise routes dates through its select/autocomplete
   prompts. We are ahead here; do not fold this into a generic `set`.
6. **One `DOMSnapshot` per frame session, reused.** Browser Use's own source comments that asking
   for more than ten computed styles *"prevents Chrome crashes on heavy sites"*; we take the same
   single snapshot for boxes, tags, input types *and* paint order
   (`browser/chromium-apis/ax-tree-extractor.ts`) and do not pay for a second pass. Keep the
   single-call discipline when adding `cursor` and `pointer-events` to the style list.

## 8. What the field has abandoned, and we should too

1. **An injected DOM-building script.** Browser Use deleted `buildDomTree.js` in v0.6.0
   (2025-08-19); nanobrowser 0.3's perception is CDP with a small probe for element state only. We
   already did this — the point is that `chrome-extension/public/buildDomTree.js` and
   `browser/dom/clickable/service.ts` must not come back, and the few remaining
   `chrome.scripting` injections should stay confined to highlighting.
2. **Indexes re-numbered every read, plus a selector healer to clean up after.** Four projects use
   stable ids; `browser/dom/selector-healer.ts` is a 0.0–1.0 similarity scorer that exists only
   because our ids are positional. With §1.1 it becomes dead code.
3. **A separate Validator agent.** Already gone from our tree (and from nanobrowser's before we
   forked — only `pages/side-panel/public/icons/validator.svg` remains). Nothing in the field runs
   one; verification is code (`evidence.ts`, `completion.ts`, `WaitForHelper.ts`). Delete the icon
   and resist re-adding the agent; `done-evidence.ts` becoming a real gate (§1.3) is the correct
   shape.
4. **Screenshot-first perception.** midscene is the live example and the only projects doing it have
   a trained grounding model. 08 and 11 settled this; nothing new contradicts it. Our capability-
   gated `view_screenshot` is the right shape, and Browser Use independently converged on it
   (`use_vision='auto'`).
5. **Growing the tool set.** Nanobrowser 0.3 ships **17** tools, 15 of them core; Browser Use ships
   24 with `screenshot` excluded unless vision is `auto`; Playwright MCP's core set is 25 with
   everything else behind `--caps`. We register ~24 before the `manage_*` family. Plan item 4.6's
   ceiling of 18 is in line with the field; `notes`, `todo_list` and `assert` are the candidates
   (4.7), and `drag_element` must survive until sliders and carousels have another route (R4 §7.3).
6. **Letting the agent declare itself finished.** Nanobrowser refuses `done(success)` while any
   action's outcome is unobserved; Skyvern re-judges a `CompleteAction` with `verified=False` and
   turns a rejection into `ActionFailure(IllegitComplete)`; Browser Use's prompt carries a six-point
   `<pre_done_verification>` checklist including *"Every URL, price, name, and value must appear
   verbatim in your tool outputs or browser_state. Do NOT use your training knowledge to fill
   gaps."* Our `done-evidence.ts` computes the same verdict and then only logs it
   (`acceptEvidencedDone` default-off). Being the one project that computes the check and does not
   enforce it is the worst of both.
7. **Scoring an answer that nothing on a page supports.** Stagehand's
   `packages/evals/docs/verifier-gates.md` rejects a judge pass with an empty answer or no browser
   tool calls, and `EVAL_REQUIRE_GROUNDING=1` rejects numeric answers with no matching observation.
   R4 §1: 25 of 46 flips were judge variance on tasks both rounds completed. Our harness should not
   keep producing numbers that move for that reason.

---

## Could not reach / not verified

- Whether a Browser Use MV3 extension exists in another repository (only `browser-use/browser-use`
  was read).
- Whether Browser Use's v0.13 Rust-backed beta agent reimplements the DOM pipeline; no `.rs` sources
  are vendored.
- Nanobrowser 0.3's full system prompt text: `src/agent/prompt.ts` quoting is limited by the fetch
  tool; the section structure is verified, the wording is not.
- The exact trigger site for `refusal(open)` in nanobrowser's `completion.ts` (the caller is in
  `loop.ts`, read only in summary).
- Any Chrome Web Store policy change aimed at `chrome.debugger` or agentic extensions — searched,
  not found; absence of evidence.
- Edge's WebMCP support behind a flag (third-party claim only).
- **The "+17 points" attributed to Skyvern's verification call in brief `11` is unsourced.** It
  appears nowhere in the Skyvern repository and was not found by search. The mechanism
  (`complete_verify`, `IllegitComplete`) is verified; the magnitude is not. Skyvern's own published
  numbers are 85.8% WebVoyager and 64.4% WebBench (README).
- Stagehand's cache-key hashing is computed server-side and closed-source; only the client contract
  in `cacheService.ts` was read.
- "Director"/workflows is a Browserbase product, absent from the Stagehand repository.
- No published accuracy numbers exist in the Stagehand repository.
- Nanobrowser's and midscene's perception mechanisms were partly read from README text; nanobrowser's
  `perception/ax.ts` confirms `Accessibility.getFullAXTree` as the source, midscene's was not read
  from source.
- The yellow `chrome.debugger` infobar: no Chromium change found, but the negative was not confirmed
  against source.

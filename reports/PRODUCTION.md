# Getting WebGenie production-ready

## Context

The agent survives 300 live tasks across 80+ sites, builds clean, and its guard *architecture* is
sound. What stands between it and real users is not architecture — it is defaults, edges and one
missing capability. The audit (`reports/PRODUCTION_AUDIT.md`) found 17 blockers; three of the worst
were verified by hand before this plan was written:

- `onlyOpens()` (`validation/service.ts:65-70`) treats **any** element carrying `aria-expanded` —
  including `aria-expanded="false"` — and any `<a href>` as "this only opens something", so the
  commit confirmation is skipped. A "Place your order" link buys without asking.
- Analytics ships **enabled by default** (`analyticsSettings.ts:26-28`), sending visited domains
  with a stable anonymous id, which contradicts decision D1 (the model provider is the only outside
  dependency) and the consent text in the options page.
- The firewall ships `enabled: true` with empty lists (`firewall.ts:35-39`), which allows
  everything while the UI presents it as protection.

Alongside these: **31.6% of the agent's own "done" verdicts are wrong** (measured, r4), and MV3 can
kill the worker mid-task with no idempotency key on any tool call, so an approved commit can run
twice.

**Definition of done for this plan:** a user who is not watching can run the agent on their own
browser, and (a) it cannot spend their money or send their data without asking, (b) an interrupted
task cannot repeat an action, (c) when it fails they can see why, (d) when it answers, the answer is
either backed by the page or labelled as unverified, and (e) the extension asks only for the
permissions its default build uses.

Ordering rule: **safety before correctness before polish.** Every item ships with a test that fails
without it.

---

## P0 — Cannot ship without these (safety, money, data)

| # | Fix | Where | Test |
| --- | --- | --- | --- |
| P0.1 | **Commit gate must not be voided by markup.** `onlyOpens` returns true for any `aria-expanded` (even `"false"`) and any `<a href>`. Restrict it: `aria-expanded="true"`-style disclosure only when the control is not itself a submit/commit verb, and a link only when its own wording is not a commit verb. Commit wording wins over markup, always. | `validation/service.ts:65-70` | "Place your order" as `<a href>` and as `aria-expanded="false"` both still require confirmation |
| P0.2 | **An approved commit must not survive a worker death.** The approval is cleared in memory (`navigator.ts:1084`) but the checkpoint is written after the step, so a resume can replay it. Persist the approval's consumption with the step that used it, and treat an approval whose step did not complete as spent. | `agent/contracts/checkpoint.ts`, `executor.ts:682`, `navigator.ts` | resuming a checkpoint whose commit action was approved does not re-approve it |
| P0.3 | **Idempotency key per tool call.** Generate the key when the call is *planned*, persist it with the checkpoint, and refuse to execute a key already recorded as executed. | `agents/navigator.ts:487`, checkpoint | a replayed batch after a simulated worker death executes each action once |
| P0.4 | **Close the query-string exfiltration path.** `urlKey` drops the query, so a page-supplied link can carry an arbitrary payload to an attacker's host under the same "already visited" provenance. Provenance must key on the full address for off-site navigations, and a page-supplied URL whose query carries task data must go through the intent check. | `validation/service.ts:222-230`, `agents/navigator.ts` | a link to a seen host with a new query containing task text triggers the check |
| P0.5 | **Analytics off by default**, and nothing leaves the machine unless the user turns it on. Fix the consent text to say exactly what is sent. | `packages/storage/lib/settings/analyticsSettings.ts:26`, `pages/options/.../AnalyticsSettings.tsx:272-288` | default settings send nothing; the copy matches the payload |
| P0.6 | **Firewall must mean something.** Either enforce a real default policy or stop calling an empty allow-list "Protection": ship it off with honest copy, and make "on" require at least one rule. | `packages/storage/lib/settings/firewall.ts:35-39`, `browser/util.ts:36-39`, options UI | enabled with empty lists is rejected in the UI, or enforces deny-by-default |
| P0.7 | **Other tabs' URLs and titles stop going to the model.** Today every open tab is in every prompt. Send only the tabs the agent itself opened or switched to. | `prompts/base.ts:334-338` | a banking tab open in the background never appears in the packet |
| P0.8 | **No raw provider errors in the UI or history.** Map provider errors to actionable messages; never persist `error.message` verbatim (an API key can appear in it). | `executor.ts:798`, `background/index.ts:712` | an error containing `sk-...` is neither shown nor stored |
| P0.9 | **A spend and step ceiling the user controls.** A per-task token/step cap with a visible default, and `maxSteps` reconciled with the UI's own maximum. | `agent/types.ts`, options UI | a task stops at the cap with a clear reason |

## P1 — Required for unattended use (reliability, honesty, support)

| # | Fix | Where | Test |
| --- | --- | --- | --- |
| P1.1 | **The answer is backed or labelled.** Ship the deterministic half of the verifier (already planned as G1.1/G1.5): every stated qualifier evidenced as an applied control, values sourced from the item's own page. When a check cannot confirm, the answer says so instead of asserting it. | `validation/done-evidence.ts`, `executor.ts` | an answer whose value appears only on the listing is marked unverified |
| P1.2 | **`retry-after: 0` must not spin.** Clamp the hint to a floor and bound total attempts. | `agents/base.ts:585,297-304` | a `retry-after: 0` loop terminates |
| P1.3 | **Traces on by default** (local only, capped, with a clear "clear" control), so "it just stopped" is diagnosable. | `background/trace.ts:44,170`, options | a fresh profile records a task's trace within its cap |
| P1.4 | **Storage failures are not silent successes.** Surface a checkpoint write failure to the user and the trace. | `background/adapters/IndexedDBStorageProvider.ts:31-37` | a failing write reports failure |
| P1.5 | **First run actually works.** Saving a key must configure the agent models; add a connection test and a clear empty state. | `pages/options/.../useModelSettings.ts:347-388` | saving a key leaves the agent runnable with no further steps |
| P1.6 | **Every user-facing failure is actionable and localised** — rate limit, bad key, refusal, limit reached, debugger detached, tab closed, worker died. | side panel, `packages/i18n` | no English-only or raw string reaches the panel |
| P1.7 | **Fix the payment dialog's default focus** ("Yes, book it" is primary) in the uncommitted side-panel redesign, then land or discard that worktree. | `pages/side-panel` worktree | the dangerous option is never the default |

## P2 — Required to distribute (store, trust, size)

| # | Fix | Where |
| --- | --- | --- |
| P2.1 | **Ask only for what the default build uses.** Move `history`, `bookmarks`, `browsingData`, `management`, `sessions`, `readingList`, `downloads` to `optional_permissions`, requested when the user enables the tools that need them. Drop `alarms`/`system.cpu` if unused. `<all_urls>` + `debugger` stay, with a plain explanation in the listing. | `chrome-extension/manifest.js:64-84` |
| P2.2 | **Real icons.** One 2.6 MB non-square image is shipped twice and used for all four sizes (5.3 MB of a 9.1 MB build). Generate proper 16/32/48/128 PNGs. | `chrome-extension/public`, manifest |
| P2.3 | **Privacy policy and permission justifications**, required for a store listing that requests `history` and `<all_urls>`. | `docs/`, listing |
| P2.4 | **Release process**: version bump, changelog, a tagged build, and a smoke checklist run against the packaged zip. | repo root |

## P3 — Proves it is safe, not just believed to be

| # | Work |
| --- | --- |
| P3.1 | **Security evaluation**: run AgentDojo and WASP against the shipped guards; report attack success *and* utility cost, per decision D4's two-sided rule. Nothing about injection resistance is claimed until this exists. |
| P3.2 | **Judge calibration**: ~100 human-labelled trajectories so every score we quote has a known bias. |
| P3.3 | **The accuracy work already planned** (`reports/PLAN.md` Wave A remainder, Gate 1, Wave B, Gate 2) — filters kept, covered targets, `extract` that cannot die, efficiency. |
| P3.4 | **The model-based de-anchored verifier**, deferred until P1.1 is measured. |

---

## Sequence

1. **P0 in one pass, one item per commit** — every one is small, and several are one line. Nothing else ships until these are in.
2. **P1**, same discipline. P1.1 rides with Gate 1 from the existing plan.
3. **Gate 1** (60 tasks): proves the accuracy work and P1.1 together, against r4's 54.4% on the same slice.
4. **P2**, then a packaged build and the smoke checklist.
5. **P3.1 and P3.2** before any public claim about safety or score.
6. **Wave B + Gate 2** for efficiency, last, because it is the only work that can trade accuracy away.

## Verification

- `pnpm -F chrome-extension test`, `pnpm type-check`, `pnpm build` for every item; a test that fails
  without the change.
- For P0.2 and P0.3, a simulated worker death (kill the checkpoint mid-step in a test) must not
  produce a second execution.
- For P0.5/P0.6/P2.1, a fresh profile check: what the extension asks for, what it sends, what it
  stores — confirmed by reading the network and storage, not by reading the code.
- Gate runs unchanged: same 60 tasks, reading judges, `compare.mjs` refusing a cross-judge
  comparison, revert if judged success falls.

# Quantitative retrospective — Mind2Web runs

Everything below is computed from `chrome-extension/e2e/results/`. The scripts are in
`reports/parts/scripts/` (run as `python3 scripts/<name>.py <run-dir-name>`); anything not produced by one of
them carries its command inline. Model for both roles in every run: `gemini-2.5-flash` on Vertex, limits
`maxSteps 50 / maxMs 2 400 000 / maxInputTokens 500 000` (`summary.json`).

Reused rather than redone: `results/speed-plan.md` (wall-clock budget, settle detail, prompt composition),
`results/answer-quality.md` (answer classification), `results/regressions-r2.md` (r2 base→cand diff),
`mind2web-r1-a920989/reviews/*.json` (per-task step review).

**r3 is still running.** Final read at 2026-09-18 14:52: **95 `result.json`, 78 `trace.jsonl`, 98 task
directories** (`ls mind2web-r3-3fdf2fa/*/result.json | wc -l`). It grew from 84/68 to 95/78 during the analysis,
so every r3 figure names its own denominator and mixed-time r3 numbers differ by a few percent. 17 of the 95
results (`site_blocked`, `provider_down`, `harness_error`) carry no `steps`/`seconds`/`metrics` at all, so r3
per-task rates are over the **78** tasks that ran. Checked: for the 78 tasks holding both files, the sum of
`kind:"llm"` `inputTokens` equals the sum of `metrics.tokens.input` exactly (14 037 724), so the two sources do
not disagree — only the read times do. r3 has no `session.md` (captureSessions off) but its traces do carry
`kind:"session"` records, so the autopsy works on its traced subset (76 tasks when the autopsy ran).

---

## 1. Run summary

Source: `scripts/run_summary.py` (aggregates every `*/result.json`), `scripts/spans.py` (trace spans).

| | r1 `a920989` | r2-base `a920989` | r2-cand `6347e1c` | r3 `3fdf2fa` (partial) |
| --- | ---: | ---: | ---: | ---: |
| tasks attempted | 300 | 60 | 60 | 95 of 300 (78 ran) |
| `task.ok` | 179 | 41 | 41 | 49 |
| `task.fail` | 22 | 3 | 6 | 2 |
| `limit_tokens` | 45 | 15 | 13 | 9 |
| `limit_steps` | 1 | 1 | 0 | 0 |
| `site_blocked` | 52 | 0 | 0 | 24 |
| `site_down` | 1 | 0 | 0 | 0 |
| `provider_down` | 0 | 0 | 0 | 7 |
| `harness_error` | 0 | 0 | 0 | 4 |
| judged success | 17/44 = 38.6% (partial, different judge) | **27/60 = 45.0%** [33.1, 57.5] | **33/60 = 55.0%** [42.5, 66.9] | not judged |
| total steps | 4 210 | 1 057 | 1 025 | 972 |
| wall clock (sum of `seconds`) | 28.8 h | 4.2 h | 4.3 h | 4.7 h |
| input tokens | 60 029 255 | 15 477 663 | 14 815 363 | 14 037 724 |
| output tokens | 1 260 463 | 300 772 | 308 517 | 269 047 |
| cached (read) tokens | 18 127 481 | 4 961 771 | 5 003 681 | 4 465 543 |
| reasoning tokens | 1 024 055 | 242 297 | 249 417 | 209 765 |
| cost USD | 19.64 | 4.88 | 4.71 | 4.40 |
| input tokens / task | 200 098 | 257 961 | 246 923 | 179 971 (÷78) |
| cost / task | $0.0655 | $0.0814 | $0.0786 | $0.0564 (÷78) |
| LLM calls (successful) | 6 613 | 1 615 | 1 446 | 1 293 |
| steps/task p50 / p95 | 10.0 / 36.2 | 15.5 / 40.1 | 14.5 / 36.1 | 9.0 / 32.1 |
| seconds/task p50 / p95 | 262.3 / 946.7 | 217.3 / 580.5 | 203.2 / 648.3 | 149.7 / 611.7 |

Judged rates: `mind2web-r2-*/judgments.json` → `summary.overall` (Wilson CI as stored). r1 was never fully
judged — `reviews/*.json` records `judge: "not judged"` for 231 of 248; the largest r1 judged set is
`judgments-fast-partial/judgments.json`, n=44, 17 success, rate 0.386 [0.257, 0.534], produced by a *different*
judge (flash) than the r2 reading judge, so it is not comparable to the r2 column. r3's lower steps/task and
seconds/task are partly a composition artefact: 35 of its 95 tasks ended in
`site_blocked`/`provider_down`/`harness_error`, 17 of them before any step was taken.

### Median latency by kind (from `kind:"span"` and `kind:"llm"` in `trace.jsonl`)

`scripts/spans.py`. `act:` spans are CDP execution only; settle and the following `getState` are separate.

| span | r2-cand n | r2-cand med | r2-cand p90 | r2-base med | r3 med |
| --- | ---: | ---: | ---: | ---: | ---: |
| `llm planner` | 339 | 5 301 ms | 11 302 | 4 528 | 4 399 |
| `llm navigator` | 1 029 | 3 802 ms | 9 350 | 3 462 | 3 460 |
| `llm * failed` | 617 | ~1 000 ms | 9 214 | ~1 000 | ~950 |
| `getState` | 1 616 | 340 ms | 1 940 | 342 | 749 |
| `network idle` | 218 | 551 ms | 5 010 | 301 | 952 |
| `input dispatch` | 560 | 26 ms | 83 | 28 | 77 |
| act `click_element` | 433 | 56 ms | 203 | 68 | 180 |
| act `input_text` | 119 | 148 ms | 470 | 130 | 403 |
| act `scroll` | 184 | 14 ms | 1 024 | 19 | 65 |
| act `go_back` | 43 | 62 ms | 1 728 | 478 | 1 374 |
| act `go_to_url` | 9 | 2 544 ms | 11 126 | 6 440 | 7 968 |
| act `get_complete_page_content` | 45 | 9 ms | 30 | 6 | 27 |
| act `wait` | 25 | 21 ms | 4 361 | 3 001 | 3 006 |
| act `save_findings` / `done` | 43 / 21 | 1 ms | 2 | 0 / 1 | 1 / 1 |

Post-action settle, parsed from the `[ActionSettle]` log lines
(`grep -ho '\[ActionSettle\] [a-z_]* settled=[a-z]* polls=[0-9]* elapsed=[0-9]*ms total=[0-9]*ms' <run>/*/trace.jsonl`,
then median/sum by action):
r2-cand **806 settles over 60 tasks = 29.0 s/task**, `polls` median 1, `settled=false` 4%; click 1 621 ms median
(17.6 s/task), scroll 942 ms (6.2 s/task), input_text 273 ms, go_back 1 950 ms. r2-base 27.0 s/task, r3 24.6 s/task.
`act:go_to_url` and `act:wait` medians in r1/r2-base/r3 are dominated by their own built-in sleeps.

---

## 4. Token autopsy

Method. `promptChars` in a `kind:"llm"` record is the sum over all messages, system message included, and
**excludes** the tools payload. Each `kind:"session"` record carries the exact final state message (`data.state`)
for that call. Pairing them in order per component per task (`scripts/fit2.py` / the attribution script) gives, per
call, the exact character count of the element block, of the rest of the state message, and of the transcript
(`promptChars − |state| − |system prompt|`). Least squares of `inputTokens` on those three plus a constant gives
tokens-per-character per content type and a fixed per-call constant that is exactly *system prompt + tool schemas*
(the only thing not in `promptChars`). **R² = 0.94 on both roles in all four runs**, and the attribution reproduces
100% of each run's input-token total by construction.

Fitted rates, r2-cand: element block **0.365 tok/char (2.74 chars/token)**, rest of state 0.31, transcript 0.022,
constant **4 903 tok** (navigator) / **3 145 tok** (planner).

The system prompt size is measured from the runs themselves, not assumed:
`min(promptChars − |state| − |task text|)` over all planner calls = **11 109 chars** in r2-cand, 6 982 in r1 and
r2-base, 11 262 in r3; the navigator's 5th percentile of the same quantity is 10 934 / 9 634 / 9 634 / 11 140.
The current source emits 11 548 (planner) and 11 034 (navigator) chars with vision on, confirming the build-to-build
drift. Tool payloads were emitted from source by a throwaway vitest that calls
`new NavigatorActionRegistry(new ActionBuilder({options:{enableBrowserDataTools:false,useVision:true}}).buildDefaultActions()).getTools()`
and `buildToolDefinitions([planToolSchema])`, then `JSON.stringify`: **24 navigator tools = 16 617 chars**
(34 tools = 23 674 chars when `enableBrowserDataTools` is on, which e2e leaves off), plan tool = 3 311 chars.
Solving the two constants against those two byte counts splits prose from JSON:
**4.12 chars/token for prompt prose, 7.39 chars/token for tool JSON.**

### Where r2-cand's 14 815 363 input tokens go (60 tasks, 1 368 calls)

| source | tokens | % of input | per task | useful (estimate) |
| --- | ---: | ---: | ---: | --- |
| **element list** (navigator copy) | 5 546 526 | 37.4% | 92 442 | see below |
| **element list** (planner copy) | 1 789 520 | 12.1% | 29 825 | near zero — the planner never uses an index |
| **system prompt** (navigator, 10 934 ch × 17.2 calls) | 2 731 858 | 18.4% | 45 531 | 100% by construction, 0% marginal — identical every call |
| **tool schemas** (24 tools, 16 617 ch × 17.2 calls) | 2 313 199 | 15.6% | 38 553 | same |
| **system prompt** (planner, 11 109 ch × 5.7 calls) | 914 261 | 6.2% | 15 238 | same |
| **plan tool schema** (3 311 ch × 5.7 calls) | 151 697 | 1.0% | 2 528 | same |
| step summaries (`[Steps so far]`/`[Earlier steps]`) | 418 143 | 2.8% | 6 969 | high |
| tab list + `[Current browser state]` header | 279 840 | 1.9% | 4 664 | low — 2 of 3 tabs are `about:blank` and the side panel |
| action results (`Results of your last actions`) | 213 949 | 1.4% | 3 566 | high |
| `[CURRENT PLAN]` | 81 906 | 0.6% | 1 365 | high |
| `[Scroll info of current page]` | 76 815 | 0.5% | 1 280 | medium |
| `[VALIDATED PROGRESS]` (planner only) | 45 293 | 0.3% | 755 | high |
| `[TODAY]` + `[TASK STARTED ON]` header | 60 466 | 0.4% | 1 008 | low — constant, but sits in the *volatile* last message |
| `[REQUIREMENTS]` | 42 072 | 0.3% | 701 | high |
| screenshots (28 vision calls) | 52 108 | 0.35% | 868 | see below |
| `[FINDINGS]` | 27 118 | 0.2% | 452 | high |
| `[Agent memory]` | 29 393 | 0.2% | 490 | high |
| tool-call/result transcript turns | 85 558 | 0.6% | 1 426 | high |
| `Current step: n/m` line | 8 316 | 0.06% | 139 | low |

Sub-blocks are the per-call character shares from `scripts/autopsy.py` multiplied by that role's fitted
tokens-per-character and call count; they sum to the fitted `otherState` bucket (21 383 tok/task) to within 0.1%.
Screenshot cost is measured as the median fit residual of the 19 image-carrying calls that could be paired:
**+1 861 tokens per attached screenshot** (r2-base +1 638, r1 +1 625, r3 +1 234), against a median residual of
+17 tokens for the 1 044 calls without one (`scripts/extra.py`).

### Not in the 14.8 M (billed or sent but absent from `metrics.tokens`)

| item | r1 | r2-base | r2-cand | r3 |
| --- | ---: | ---: | ---: | ---: |
| hedge-loser (`superseded`) calls | 468 | 113 | 78 | 13 |
| their input tokens (est.: count × that role's median input) | 4 142 538 | 1 111 070 | **786 420** | 136 482 |
| … per task | 15 343 | 18 518 | **13 107 (+5.3%)** | 1 796 |
| failed calls | 6 297 | 656 | 617 | 808 |
| … per task | 23.3 | 10.9 | 10.3 | 10.6 |
| prompt chars uploaded and rejected | 186 183 201 | 19 834 462 | 19 994 353 | 26 911 810 |
| re-asks / schema rejections | 0 | 0 | 0 | 0 |
| reasoning tokens (billed as output) | 1 024 055 | 242 297 | 249 417 | 186 757 |

545 of r2-cand's 617 failures are HTTP 429; a 429 is rejected before inference, so those 20.0 M prompt chars
(≈5.5 M tokens at the fitted rate) cost bandwidth and latency but, on the usual Vertex billing model, not money —
**estimate**, not measured from an invoice. The 43 timeouts in the same run did reach the model. Hedge losers
*are* answered by the model, so their ~786 k tokens are the one genuinely invisible bill: `metrics.tokens` only
counts calls that returned. Re-asks are zero in every run, so tool-call validation costs nothing.

### Repeat factor: how often the same element list is sent twice

`scripts/autopsy.py` MD5s the `[Start of page] … [End of page]` block of every call in a task and counts duplicates.

| | r1 | r2-base | r2-cand | r3 |
| --- | ---: | ---: | ---: | ---: |
| element blocks per task (median) | 17 | — | 20 | 12 |
| distinct blocks per task (median) | 10 | — | 12 | 8 |
| **repeat factor, median / mean** | 1.50 / 1.79 | — | **1.45 / 1.59** | 1.40 / 1.48 |
| re-sent (byte-identical) element chars per task, median / mean | 68 453 / 128 912 | — | **68 348 / 119 559** | 38 396 / 78 355 |
| … as tokens per task (× 0.365) | 25 003 / 47 053 | — | **24 957 / 43 649** | 14 036 / 28 637 |
| line-level: share of element lines also in the *previous* call of the same task (median) | 0.750 | 0.708 | 0.515 | 0.333 |

Denominators: r1 269 tasks with element blocks (of 270 traced), r2-base and r2-cand 60 each, r3 73 at the time
the repeat script ran. r2-base's block-hash columns are omitted because that run's `[REQUIREMENTS]`/`Controls:`
lines are absent (see `regressions-r2.md`), which makes its blocks hash differently from r2-cand's for the same
page; its line-level figure (0.708) is the comparable one.

**The worst offender is the element list**: 49.5% of all input tokens in r2-cand (52.9% r1, 54.5% r2-base,
50.4% r3), and by the strictest measure almost none of it is used. `scripts/useful.py` maps every `index` argument
in a navigator tool call back to the element line it named:

- 113 element lines per navigator call (median), 122 mean; **0.65 of them acted on per call** (median 1).
- **0.38% of element-block characters are lines the model acted on in that same call** (r1 0.38%, r2-base 0.37%,
  r3 0.30%). Per task: 809 distinct element lines sent, **9 ever acted on**.
- **58.7% of element-block characters sit on lines marked `offscreen="true"`** — but 17.5% of acted-on lines were
  offscreen-marked, so the offscreen half is not dead weight; deleting it trades tokens for scroll steps
  (speed-plan reaches the same conclusion from the other direction).
- Attribute shares of the element block (regex count over every session state, r2-cand):
  `href` 24.2%, `aria-label` 12.0%, `offscreen="true"` 9.2%, `role` 3.5%, `type` 1.6%,
  `aria-haspopup`/`aria-expanded` 1.2%; plain (non-`[n]`) text lines 23.3%. href content beyond 40 chars is 6.8%
  of the block, beyond 60 chars 4.0%.

**Useful-share estimate for the element list.** Lower bound 0.4% (lines acted on). A defensible upper bound is
"on-screen lines plus the offscreen lines ever acted on" = 41.3% + ~2% ≈ **43%**, and the extraction tasks read
the plain-text lines too (23.3% of the block), so call it **45% useful, 55% waste — estimate**. The fixed
prefix (system prompt + tool schemas, 41.2% of input) is 100% necessary content and ~0% *marginal* — it is
byte-identical on every one of the ~23 calls in a task, and a perfect cache would make 22 of 23 copies free.

### The three cuts with the best tokens-per-capability ratio

Baseline: 246 923 input tokens/task (r2-cand).

| # | change | measured basis | saving / task | capability risk |
| --- | --- | --- | ---: | --- |
| 1 | Send `page unchanged since step N` instead of a byte-identical element block | repeat factor 1.45 median / 1.59 mean; 119 559 identical chars re-sent per task (mean) | **−43 649 tok (−17.7%)** | none — the replaced text is identical |
| 2 | Trim the element line: `href` capped at 60 chars (path truncated, query kept), `offscreen="true"` → `off`, drop `role` when the tag implies it, drop `aria-haspopup`/`aria-expanded` | 4.0% + 7.4% + 3.5% + 1.2% = 16.1% of element chars | **−19 684 tok (−8.0%)** | low; a requirement whose evidence is a long URL path can no longer be quoted verbatim |
| 3 | Planner: `planningInterval` 3→5 **and** an explicit cache for the planner prefix | `step_interval` fired 207×/60 tasks = 3.45/task; planner cacheRead is 1.6% of planner input vs 43.0% navigator; uncached planner prefix = 16 914 tok/task | **−12 632 tok** (1.4 fewer planner calls) **−12 685 tok** billed-equivalent (cache reads bill at 25%) = **−25 317 (−10.3%)** | moderate on the interval (corrective re-plan triggers untouched); none on the cache |

Three together: **−88 650 tokens/task, −35.9%**, which also moves the `limit_tokens` population (13 of 60 tasks
in r2-cand, 15 of 60 in r2-base, 45 of 300 in r1) well below the 500 k cap.

---

## 7. Efficiency sinks, ranked

Ranked by measured cost per task on r2-cand (60 tasks, 246 923 input tok, 17.1 steps, 258.3 s mean wall clock).
Items 1, 3 and 4 overlap: a wasted step re-sends a page state, and a repeated action is a wasted step. Savings are
estimates unless marked measured.

| # | sink | what it costs today (measured) | change | expected saving |
| --- | --- | --- | --- | --- |
| 1 | **Full page-state re-send every step** | element list = 122 263 tok/task, 49.5% of input; 0.38% of its characters are acted on; repeat factor 1.45 (median), 51.5% of lines carried over from the previous call | send a `page unchanged` marker for a byte-identical block; trim the element line (href 60, `off`, no implied `role`) | −43 649 and −19 684 tok/task (−25.7%) |
| 2 | **System prompt + tool schemas re-sent on all 22.8 calls/task** | 101 850 tok/task, 41.2% of input (nav 4 903 tok/call, planner 3 145 tok/call). The navigator's cache reads (4 952 265) are **98% of its own prefix** (5 045 084) — that half is already solved. The planner's prefix (1 066 229 tok) gets **51 416** cache reads, so **16 914 tok/task is paid at full price** | explicit `CachedContent` for the planner prefix; move `[TODAY]`/`[TASK STARTED ON]` out of the volatile last message into the system message | −12 685 tok/task billed-equivalent (cache reads bill at 25%). The navigator side is already banked — do not double-count it |
| 3 | **Wasted steps** | r1 reviews: **3 914 steps taken vs 1 653 needed** across 247 tasks, median 12 vs 6, ratio 2.37, **57.8% of steps wasted**; 583 wasted-step entries | planner/perception quality — not a per-step tuning problem (`speed-plan.md` §"The elephant") | at 14 457 input tok/step, 9.9 wasted steps/task ≈ 143 000 tok/task and ~120 s/task. Cross-run estimate (r1 reviews × r2-cand rates) |
| 4 | **Repeated actions** | **383 of 1 044 actions are an exact repeat** (36.7%; r2-base 37.3%, r1 38.7%, r3 29.8%). By tool: scroll **75%** (139 of 185), go_back 72%, click_element 30%, input_text 25%, `get_complete_page_content` 20% | refuse the 4th identical action; `MAX_EMPTY_SCROLLS` 6→2 gated on "revealed nothing new **and** height did not grow" | 6.4 actions/task → ~2.5 removable = −26 000 tok, −15 s (speed-plan item 1) |
| 5 | **Rate-limit backoff** | `backoffMs` 3 296 s over 60 tasks = **54.9 s/task mean, 35.8 s median**, 21.3% of wall clock; 1 085 rate-limit events, 545 HTTP 429s | harness-side: quota and region count. `overnight.sh` runs 5 shards on one Vertex quota | not an agent change; r1 paid 123.8 s/task median for the same reason |
| 6 | **Provider retries / failed calls** | 617 failed calls = **10.3/task**; `failedCallMs` 2 433 s = 40.5 s/task (15.7% of wall clock); 20.0 M prompt chars uploaded and rejected; 94 timeouts | same quota fix; shrink the prompt so a retry is cheaper to re-upload | −40 s/task at r3-level contention |
| 7 | **Settle double reads** | **29.0 s/task** (806 settles), `polls` median **1**, `settled=false` **4%**; click 1 621 ms (17.6 s/task), scroll 942 ms (6.2 s/task) | skip the `isSame` quiet read when the action validated on direct target evidence (not for `NAVIGATION_ACTIONS`) | −6 to −9 s/task (speed-plan item 4) |
| 8 | **Hedged duplicate calls** | 110 hedges, **78 answered losers**, 2.75 M prompt chars → **~786 420 tok = 13 107/task (+5.3%)**, invisible to `metrics.tokens`; 505 s of loser latency | raise `HEDGE_AFTER_MS`, or suppress the hedge above ~10 k input tokens | −13 107 tok/task; latency cost unmeasured (no streaming, so the hedge's win cannot be isolated) |
| 9 | **`get_complete_page_content` raw innerText** | 45 calls / 60 tasks = 0.75/task; the following action-result block is **2 845 chars median, 5 553 mean** against a 322-char baseline after `click_element` | cap and structure the extract, or return only the matched region | ~−1 600 tok per call ≈ −1 200 tok/task (0.5%) — small, contrary to its reputation |
| 10 | **Screenshots** | 28 vision calls / 60 tasks (r1 284, r2-base 44, r3 24); **1 861 tok each** → 52 108 tok = **868 tok/task, 0.35% of input** | nothing; it is already the cheapest thing on this list | negligible — do not spend effort here |

Two more, below the top 10 but measured: **planner cadence re-plans** — `step_interval` is 207 of r2-cand's 335
re-plans (3.45/task, more than every other trigger combined: initial 1.02, `contract_complete` 0.35,
`validation` 0.28, `completion_refused` 0.23, `progress_stall` 0.13, `navigator_error` 0.07), at 9 023 tok and
5.3 s per planner call; and the **tab list**, which repeats `about:blank` and the side panel's own URL on all 22.8
calls for 4 664 tok/task.

### Not sinks (measured, so stated once)

Re-asks and schema rejections: **0** in all four runs. `wait` in r2-cand: 25 calls, 21 ms median (r1's 146 calls at
3 002 ms were already fixed; r3 shows 15 calls back at 3 006 ms — worth a look). Action batching: 1.04 actions per
navigator call, 98% of calls carry exactly one, against `maxActionsPerStep: 5` (`speed-plan.md` §3). Everything
outside model calls, backoff and page reads sums to 6 s/task (`speed-plan.md` §1).

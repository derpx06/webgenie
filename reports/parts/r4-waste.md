# Where the agent still wastes effort — run `mind2web-r4-2953c78`

Source: `/home/manas/Documents/webSurfer/chrome-extension/e2e/results/mind2web-r4-2953c78/`.
300 task folders with `result.json`; **270** of them also carry `trace.jsonl` + `timeline.txt`, and all
trace-derived numbers below are over those 270 unless stated. Judge verdicts: **124 success, 110 fail,
36 unjudged** (`judgment-claude.json`). Build `88fff5b`, model `gemini-2.5-flash` on Vertex, 3 workers.

Every figure is computed from the trace records. Derived quantities are marked **(estimate)**.

## Method / commands

Pass 1 streams all 270 `trace.jsonl` into one per-task summary (`kind:"llm"` usage + latency,
`kind:"span"` durations, `kind:"session"` page-state fingerprints, `kind:"log"` planner plans and
`[Action]` lines). Passes 2-7 aggregate it. Scripts live in the session scratchpad:

```bash
S=/tmp/claude-1000/-home-manas-Documents-webSurfer/9f673409-.../scratchpad
python3 $S/pass1.py           # 270 traces (182 MB) -> tasks.jsonl, 2.1 s
python3 $S/pass2.py           # wall-clock buckets + tokens by role + element-list share
python3 $S/pass3.py $S/pass4.py   # waste classes, repeats, batching
python3 $S/pass5.py           # per-step wall time, slowest 20
python3 $S/pass6.py $S/pass7.py   # worst tasks, savings estimates, throttle share
```

Validation of the extraction: trace-derived totals were cross-checked against the `metrics` block that
`result.json` already carries — **input tokens 270/270 exact, backoff ms 270/270, failed-call ms 270/270,
getState count 270/270**. Only the raw call count differs on 85 tasks (off by one; `metrics.llmCalls`
counts the final aborted call), so the trace numbers are used throughout.

---

## 1. Where the wall clock goes

Buckets are top-level and non-overlapping (`Page` "network idle" spans nest inside action/getState and
are reported separately). Total wall = last minus first trace timestamp per task.

### All 270 tasks — 20.34 h wall, median 185.3 s/task

| bucket | median s/task | total h | % of wall |
|---|---:|---:|---:|
| successful model calls | 64.1 | 7.20 | **35.4 %** |
| paced waits (`pacing; waiting Xs`) | 30.0 | 5.01 | **24.7 %** |
| rate-limit backoff (`rate limited; retrying in Xs`) | 13.2 | 4.14 | **20.3 %** |
| failed calls | 3.3 | 0.84 | 4.1 % |
| page reads (`getState`) | 12.4 | 1.56 | 7.7 % |
| action dispatch | 2.2 | 0.47 | 2.3 % |
| hedge duplicates superseded | 0.0 | 0.14 | 0.7 % |
| settling (`Validation` spans) | 0.0 | 0.00 | 0.0 % |
| unaccounted | — | 0.98 | 4.8 % |

Network-idle waits nested inside the above: 0.37 h.

### Successes (n=124) — 7.26 h, median 152.5 s | Failures (n=110) — 12.57 h, median 336.5 s

| bucket | success med s | success % | fail med s | fail % |
|---|---:|---:|---:|---:|
| successful model calls | 51.3 | 33.6 % | 146.5 | 36.3 % |
| paced waits | 30.4 | 25.7 % | 55.3 | 24.2 % |
| rate-limit backoff | 15.7 | 22.8 % | 19.9 | 18.9 % |
| failed calls | 3.9 | 4.0 % | 5.6 | 4.2 % |
| getState | 11.3 | 7.6 % | 24.7 | 7.8 % |
| action dispatch | 1.9 | 1.9 % | 5.6 | 2.5 % |

**The shape is identical in both groups — failures are not slower per step, there are simply ~3x more
steps** (median 10.5 steps for a success, 29.5 for a failure).

> **Headline: 49.8 % of the whole run (10.13 h of 20.34 h) is provider throttle** — paced waits +
> backoff + failed calls + superseded hedges. **2 909 of 9 281 model-call attempts failed (31.3 %)**,
> of which **2 794 were HTTP 429**, 78 client timeouts, 34 aborts, 2× 400. By role: navigator 2 346
> failures, planner 563. Settling costs effectively nothing; action dispatch costs 2.3 %.

## 2. Where the tokens go

Run totals: **67.66 M input, 1.72 M output, 21.08 M cached (31.2 %), 6 372 successful calls, $23.33.**

| group | role | calls | median in | p90 in | total in | median out | cached share |
|---|---|---:|---:|---:|---:|---:|---:|
| ALL | planner | 1 346 | 7 966 | 14 056 | 11.77 M | 328 | **0.015** |
| ALL | navigator | 5 026 | 10 325 | 16 345 | 55.89 M | 158 | 0.374 |
| SUCCESS | planner | 503 | 7 973 | 13 616 | 4.40 M | 272 | 0.011 |
| SUCCESS | navigator | 1 807 | 10 023 | 15 774 | 19.26 M | 140 | 0.364 |
| FAIL | planner | 757 | 8 127 | 14 357 | 6.88 M | 416 | 0.015 |
| FAIL | navigator | 3 109 | 10 599 | 16 721 | 35.47 M | 172 | 0.383 |

Median input per task: **143 k for a success, 391 k for a failure** (2.7x).

**Cache is broken for the planner.** 1 264 of 1 346 planner calls (**94 %**) got a zero cache hit,
against 1 210 of 5 026 (24 %) for the navigator. The planner burns 11.77 M input tokens (17 % of the
run) at 1.5 % cached — its calls are spaced too far apart for the provider's implicit cache, and each
one is prefixed by a `[PROGRESS]` block that changes every time.

### Element list vs everything else

Joined `kind:"session"` records (which carry the full final state message) to their `kind:"llm"` call by
`(component, ts)`: **4 828 of 6 372 calls joined (76 %)**; the unjoined are re-asks and hedge duplicates,
which have no session record.

| role | median element-list chars | median promptChars | element share of prompt | whole page-state msg share |
|---|---:|---:|---:|---:|
| planner | 11 601 | 24 874 | **47.8 %** | 70.7 % |
| navigator | 13 010 | 26 776 | **48.0 %** | 59.3 % |

**(estimate)** applying the char ratio to tokens: the element list is ~**4 932 of 10 274** input tokens
per navigator call and ~**3 766 of 7 872** per planner call. Roughly **32 M of the run's 67.66 M input
tokens are the interactive-element list.** Half the remaining navigator prompt is the static system
prompt and tool schemas — which is exactly what the cache should be absorbing, and does for only 62.6 %
of navigator input and 1.5 % of planner input.

## 3. Steps that bought nothing

4 643 actions executed, plus 363 refused before dispatch = **~5 006 attempts**. 5 023 navigator calls,
1 346 planner calls, 6 735 `getState` spans.

| class | all | in successes | in failures | how measured |
|---|---:|---:|---:|---|
| exact repeat (same action + same args, same task) | 1 682 | 423 | 1 234 | `[Action]` log lines |
| …of which non-idempotent actions only | 749 | — | — | excludes scroll / read_page / find_in_page / view_screenshot / wait_for / go_back / extract |
| …consecutive identical | 396 | 117 | 275 | adjacent `[Action]` lines |
| action refused by a guard | 363 | 102 | 257 | `Guard` spans ending `: refused` |
| action validated `unknown` | 123 | 31 | 91 | `Validation` spans |
| action validated `failed` | 39 | 14 | 24 | `Validation` spans |
| navigator step that re-read an unchanged page | **796** | 230 | 549 | consecutive navigator states, identical URL + identical element-list hash |
| scroll that revealed nothing new | 82 of 818 (10 %) | 9 | 73 | scroll followed by identical element-list hash |
| re-plan repeating the previous goal verbatim | 88 | 25 | 51 | consecutive `Planner output` `next_goal` |

Guard refusals by kind: `covered` 122, `invisible` 88, `stale-index` 37, `failed-retry` 25,
`unshown-index` 17, `identical-repeat` 17, `firewall` 13, `intent-open` 9, `challenge-element` 7,
`disabled` 7. `validated: unknown` is overwhelmingly `click_element` (97 of 123).

Repeats concentrate in specific tools:

| action | uses | repeats | % |
|---|---:|---:|---:|
| scroll | 828 | 593 | 71.6 % |
| go_back | 207 | 140 | 67.6 % |
| switch_tab | 44 | 23 | 52.3 % |
| click_element | 2 033 | 607 | **29.9 %** |
| read_page | 202 | 68 | 33.7 % |
| find_in_page | 246 | 65 | 26.4 % |
| extract | 191 | 50 | 26.2 % |
| input_text | 378 | 83 | 22.0 % |
| **total** | **4 643** | **1 682** | **36.2 %** |

A **verified control**: 959 of 959 planner→navigator adjacent pairs in the same step share one identical
page state — the executor's single page read per step works exactly as `CLAUDE.md` describes, so it is
*not* a source of duplicate reads. The 796 wasted reads are all navigator-to-navigator.

### Cost of one avoided navigator step (measured per-call medians)

median navigator call 3 242 ms + getState 414 ms + mean pacing 2 833 ms + mean backoff 2 337 ms =
**8.8 s and 10 325 input tokens per step.**

**(estimate)** removing each class, priced at that rate:

| class | steps | input tokens | % of run tokens | hours | % of wall |
|---|---:|---:|---:|---:|---:|
| unchanged-page navigator steps | 796 | 8.22 M | 12.1 % | 1.95 | 9.6 % |
| non-idempotent exact repeats | 749 | 7.73 M | 11.4 % | 1.84 | 9.0 % |
| guard-refused actions | 363 | 3.75 M | 5.5 % | 0.89 | 4.4 % |
| validated `unknown` | 123 | 1.27 M | 1.9 % | 0.30 | 1.5 % |
| re-plans repeating the goal | 88 | 0.91 M | 1.3 % | 0.22 | 1.1 % |
| scrolls revealing nothing | 82 | 0.85 M | 1.3 % | 0.20 | 1.0 % |
| validated `failed` | 39 | 0.40 M | 0.6 % | 0.10 | 0.5 % |

These classes overlap. **Per-task union, de-duplicated by timestamp: 2 068 wasted step-events of ~5 006
attempts (41 %) ≈ 21.35 M input tokens (31.6 % of the run) and 5.06 h (24.8 % of wall) (estimate).**
Median 3 wasted steps per task; worst task 72.

## 4. The single-action pattern

4 643 actions over 5 026 navigator calls = **0.92 actions per call**, against a cap of 5.

| measure | pairs | successes | failures |
|---|---:|---:|---:|
| consecutive navigator call pairs | 4 753 | — | — |
| …same URL (no navigation between them) | 3 279 (69 %) | 1 096 | 2 135 |
| …**same URL *and* byte-identical element list** | **796 (16.7 %)** | 230 | 549 |

The strict 796 is the defensible number: the page provably did not change, so both actions were valid
against the same element indices and could have gone in one tool call. 405 such runs exist, median
length 2, max 24, 1 201 calls involved → **796 calls droppable**.

What the agent did in the step that changed nothing:

| preceding action | count | note |
|---|---:|---|
| find_in_page | 168 | read-only by construction |
| click_element | 160 | click had no visible effect |
| extract | 135 | read-only |
| read_page | 109 | read-only |
| scroll | 82 | scrolled past the end |
| save_findings | 31 | read-only |
| view_screenshot | 21 | read-only |
| input_text | 19 | |
| others | 71 | |

**464 of the 796 (58 %) follow an action that cannot change the page.** More broadly, **1 672 of 4 643
actions (36.0 %) are read-only** — scroll 828, find_in_page 246, read_page 202, extract 191,
save_findings 72, wait_for 48, assert 47, view_screenshot 33, todo_list 5 — and each costs a full model
call. Read-only share is 28.9 % in successes and **40.7 % in failures**.

Scroll crawling is the worst instance: 193 runs of ≥2 consecutive scrolls, median 3, max 6, 513 scrolls
inside runs, **320 droppable if batched**. Median scrolls/task is 1 for a success and 4 for a failure;
29 tasks scrolled ≥10 times.

**Savings if the 796 provably-batchable calls were merged (estimate): 796 model calls, 8.22 M input
tokens (12.1 % of the run), 1.95 h (9.6 % of wall).** Batching the 320 redundant scroll steps on top
(they are inside the same 796 where they coincide) is bounded by the same figure. Using the loose
same-URL definition instead would give 3 279 pairs / 33.9 M tokens, but index invalidation after a click
makes that an upper bound only, not an achievable one.

## 5. The slowest 20 steps

5 283 steps total; median 8.6 s, p90 30.8 s, p99 65.5 s. Per-step wall = last minus first trace
timestamp carrying that `step`.

| # | task | step | wall s | what it was waiting for |
|---:|---|---:|---:|---|
| 1 | 3dca7cbe7d0866 | 28 | 137.2 | failed calls 119 s, backoff 26 s, superseded hedge 20 s |
| 2 | a7a73c8fa75441 | 0 | 120.9 | backoff 59 s, pacing 44 s, planner 8 s |
| 3 | 7fff82864f21dd | 2 | 120.4 | backoff 60 s, pacing 45 s, planner 10 s |
| 4 | db1ffb5e605785 | 2 | 119.2 | backoff 62 s, pacing 37 s, planner 12 s |
| 5 | 005be9dd91c956 | 5 | 116.9 | backoff 76 s, pacing 23 s, failed 8 s |
| 6 | 853afd530c72f4 | 10 | 114.1 | backoff 70 s, pacing 30 s |
| 7 | 330cd04c773ac4 | 0 | 104.5 | backoff 64 s, pacing 26 s |
| 8 | f2be37a9a60fbc | 18 | 104.5 | backoff 76 s, failed 13 s, navigator 13 s |
| 9 | 56f8890a837c49 | 0 | 103.4 | backoff 70 s, pacing 15 s |
| 10 | 515f2e5811cfdd | 9 | 101.0 | backoff 80 s, pacing 10 s |
| 11 | 3dca7cbe7d0866 | 21 | 100.1 | failed 58 s, backoff 25 s, navigator 17 s |
| 12 | 48c73f3f53e261 | 10 | 97.6 | backoff 48 s, pacing 30 s |
| 13 | 3dca7cbe7d0866 | 15 | 95.4 | failed 83 s, backoff 18 s |
| 14 | 34ccd15a8ea8fd | 0 | 91.8 | backoff 64 s, pacing 15 s |
| 15 | 6b5be1764692d1 | 8 | 91.2 | failed 56 s, backoff 16 s, pacing 15 s |
| 16 | 323bd85e355965 | 18 | 89.7 | pacing 43 s, failed 27 s, planner 14 s |
| 17 | 9d46ccb915eff3 | 15 | 89.3 | backoff 34 s, **planner call 33 s**, pacing 12 s |
| 18 | 3dca7cbe7d0866 | 24 | 88.8 | failed 66 s, backoff 23 s |
| 19 | 608c595eec271f | 6 | 88.5 | backoff 38 s, pacing 15 s, 29 s unaccounted |
| 20 | b320c68bffc1f3 | 25 | 87.5 | backoff 58 s, pacing 15 s |

**All 20 are provider throttle.** Not one is dominated by a page read, an action, settling or a slow
site. The only non-throttle contributor anywhere in the list is one 33 s planner call (#17). Task
`3dca7cbe7d0866` alone holds four of the twenty, all of them dead time on a 429 storm.

Aggregate per-step bucket totals across the whole run (h): navigator calls 5.34, pacing 5.03,
backoff 4.15, planner calls 1.89, getState 1.56, failed calls 0.84, actions 0.47, network idle 0.38,
superseded hedges 0.14.

## 6. Worst effort-to-result

By outcome (trace-carrying tasks):

| outcome | n | median input tok | total input tok | median steps | median s |
|---|---:|---:|---:|---:|---:|
| task.ok | 178 | 143 802 | 36.83 M | 11 | 170 |
| limit_steps | 22 | 568 398 | **12.67 M** | 50 | 560 |
| limit_tokens | 18 | 677 161 | **12.12 M** | 38 | 464 |
| task.fail | 15 | 277 258 | 4.10 M | 18 | 275 |
| site_blocked | 36 | 23 726 | 1.65 M | 2 | 20 |
| task.pause | 1 | 297 152 | 0.30 M | 25 | 598 |

**The 40 `limit_steps` / `limit_tokens` tasks consumed 24.79 M input tokens — 37 % of the run and $8.48
of $23.33 — and produced exactly 1 judged success.** Cost per success across the run is $0.188.
(Separately, 64 of the 300 tasks ended `site_blocked` for $0.59 total — cheap, correctly abandoned.)

The 15 heaviest failures (`repeats/guard/unknown` counted per task):

| task | site | outcome | steps | input tok | s | r/g/u | verified cause (top repeated call / guards) |
|---|---|---|---:|---:|---:|---|---|
| 636b07af4dd97c | jcpenney.com | limit_tokens | 39 | 757 804 | 295 | 25/2/0 | `scroll down` x17 identical, `scroll down index:49` x6, `find_in_page "Gold"` x5 |
| 733f1d8bf79d5b | tourradar.com | limit_steps | 50 | 746 636 | 716 | 19/20/0 | **13 `firewall` + 4 `repeat-address` guard refusals** — kept trying to open blocked URLs; `scroll down` x7, `go_back` x4 |
| 5dec0e66208494 | bestbuy.com | task.ok, judged wrong | 45 | 737 688 | 346 | 15/0/0 | `scroll down` x11, `read_page full` x4 — crawled the page, answered from the wrong one |
| 47bfe8a7e0e4e7 | versus.com | limit_tokens | 40 | 734 617 | 494 | 18/6/2 | `scroll down` x6 + `scroll bottom` x6, `find_in_page "Compare+"` x4; 4 `unshown-index` refusals |
| 5d542a7ec1fa14 | dblp.org | limit_tokens | 47 | 727 672 | 889 | 27/2/0 | `go_back` x7 + same `click index:109` x6 — clicked into a record and backed out repeatedly |
| 461ab9b0c7b20a | nyse.com | limit_tokens | 49 | 721 352 | 412 | 22/2/0 | `scroll down` x10, same `click index:16` x6, **`input_text` with a 0-character string x4** |
| 824eb7bb0ef1ce | us.speedo.com | limit_steps | 50 | 718 367 | 1058 | 24/11/1 | same `click index:54` x11 against **7 `invisible` guard refusals** — fought one hidden element all run |
| 64345c365f5443 | us-appliance.com | limit_tokens | 38 | 709 988 | 358 | 16/1/1 | `scroll down` x11, same `extract` schema x4 |
| 47186fac8e7c72 | parkers.co.uk | limit_tokens | 41 | 706 665 | 332 | 16/10/1 | `scroll down` x9, **`view_screenshot` x6**, 6 `covered` + 4 `unshown-index` refusals |
| c94551d2b18f9a | petfinder.com | limit_steps | 50 | 705 621 | 457 | 9/1/0 | **the identical `extract` schema x16** — re-extracted the same page sixteen times |
| 64b76158720a69 | healthline.com | limit_steps | 50 | 693 010 | 802 | 23/1/0 | `scroll down` x9, `go_back` x5, same `click index:1` x4 |
| 9ef1a8972f375d | landwatch.com | limit_tokens | 37 | 681 939 | 762 | 20/1/0 | same `click index:40` x6 and `index:4` x4, `scroll down` x8 |
| 62c8d970b3d138 | store.steampowered.com | limit_tokens | 36 | 679 583 | 293 | 13/2/3 | `scroll down` x10, same `extract` x5, same `click index:31` x4 |
| 662ae0f2d3ac85 | wanderlog.com | limit_steps | 50 | 679 347 | 424 | 30/0/0 | **`go_back` x10** + `scroll down` x8 — highest repeat count in the run, no guard ever fired |
| fc53ddd3421411 | bestbuy.com | limit_tokens | 41 | 677 721 | 557 | 13/7/1 | `scroll down` x9 in three arg variants; 3 `invisible` + 2 `stale-index` refusals |

**One call dominates the whole class.** The bare `scroll {"direction":"down"}` — no index, no text — was
issued **701 times run-wide; 546 of those were exact repeats within the same task (32 % of all 1 682
repeats), spread over 109 of 270 tasks, up to 17 times in a single task.** Priced at the measured
per-step rate that is **5.64 M input tokens (8.3 % of the run) and 1.33 h (6.6 % of wall) (estimate)**
spent scrolling one viewport at a time. 13 of the 15 worst failures above lead with it.

The pattern is uniform: **a failure is a task where the agent keeps taking read-only or refused steps
and never re-plans out of the loop.** Failures average 40.7 % read-only actions vs 28.9 % for successes,
and 3x the step count at the same per-step cost.

---

## What to fix first, ranked by measured cost

1. **Provider throttle — 10.13 h of 20.34 h (49.8 % of wall), 2 794× HTTP 429, all 20 slowest steps.**
   This is harness/quota configuration, not agent logic: 3 workers against one Vertex quota. Reducing
   worker concurrency or raising quota is worth more wall-clock than every agent change below combined.
   It costs no accuracy. *Do this before drawing any latency conclusion from a future run.*
2. **The 40 `limit_steps` / `limit_tokens` tasks — 24.79 M input tokens (37 % of the run), $8.48, 1
   success.** The budget is spent after the task is already lost. A stall detector that ends (or asks)
   when N consecutive steps produce no page change would reclaim most of it. Measured trigger signal is
   already in the trace: these tasks carry 9-30 exact repeats each.
3. **796 navigator steps against a provably unchanged page — 8.22 M tokens (12.1 %), 1.95 h (9.6 %)
   (estimate).** 58 % of them follow a read-only action. Two fixes, both general: (a) let a read-only
   action (`find_in_page`, `read_page`, `extract`, `save_findings`, `view_screenshot`) return its result
   *and* continue in the same tool-call batch instead of ending the step; (b) skip the `getState`
   rebuild when the observation fingerprint is unchanged and re-use the prior element list.
4. **749 non-idempotent exact repeats — 7.73 M tokens (11.4 %), 1.84 h (9.0 %) (estimate).** The
   `identical-repeat` guard already exists but fired only 17 times against 1 682 detected repeats: it is
   too narrow. Widening it to (action, args) seen anywhere in the task, surfaced to the model as a
   refusal with the prior result, is the single highest-leverage agent-side change.
5. **Planner prompt caching — 1 264 of 1 346 planner calls (94 %) get zero cache hit, 11.77 M tokens at
   1.5 % cached.** The navigator reaches 37.4 % on the same provider, so the mechanism works; the
   planner's cadence and its changing `[PROGRESS]` prefix defeat it. Moving the volatile progress block
   after the stable system prompt + task history should recover most of it at zero accuracy cost.
6. **363 guard-refused actions — 3.75 M tokens (5.5 %), 0.89 h (estimate).** `covered` (122) and
   `invisible` (88) dominate, and they cluster: 3 of the 15 worst failures spent 10-20 refusals fighting
   one overlay. A refusal should carry the blocking element and force a re-plan rather than return a
   message the navigator retries against.
7. **Bare `scroll {"direction":"down"}` — 546 exact repeats, 5.64 M tokens (8.3 %), 1.33 h (6.6 %)
   (estimate); 109 of 270 tasks; 13 of the 15 worst failures lead with it.** This is the most
   concentrated single waste signature in the run and it is one tool call. A `scroll` that takes a
   target ("until X is visible") and loops in the handler, or simply a larger default stride, turns a
   17-call crawl into one. Related: 193 runs of ≥2 consecutive scrolls, 320 droppable if batched, and
   10 % of all scrolls reveal no new element.
8. **Element list = 48 % of prompt chars both roles (~32 M of 67.66 M input tokens) (estimate).** Real,
   but *last* on this list deliberately: it is the agent's perception, and per
   `accuracy-before-token-efficiency` it must not be trimmed on a token argument. Items 1-7 remove
   *calls*, which removes the same tokens without removing anything the model sees.

**Ceiling if 2-7 all landed (estimate):** the de-duplicated union of wasted steps is 2 068 of ~5 006
attempts — **21.35 M input tokens (31.6 %) and 5.06 h (24.8 % of wall)** — on top of which fixing (1)
addresses a further ~10 h. None of items 1-7 removes evidence from the model's view; each removes a
round trip that produced no new evidence.

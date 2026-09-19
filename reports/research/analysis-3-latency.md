# Where WebGenie's wall clock goes — run `mind2web-r3-3fdf2fa`

## Summary

**Corpus read:** 286 of 300 tasks had a `result.json` when I read it (run still finishing; last `status.log` line says 276/300 final, 23 to re-run). 257 had a `trace.jsonl`; **227–230 are analysable** (outcomes `task.ok` 156, `limit_tokens` 44, `task.fail` 12, `provider_down` 8, `limit_steps` 7; `site_blocked` 55, `site_down` 2, `harness_error` 2 excluded). Baseline: `mind2web-r2-cand-6347e1c`, 60 tasks.

| bucket (interval union, no double-count) | r3 med s | r3 mean s | share | r2-cand med s |
|---|---:|---:|---:|---:|
| **total (`result.seconds`)** | **244.3** | **308.9** | 100% | 203.2 |
| model calls that succeeded | 97.5 | 124.7 | 40.4% | 103.0 |
| rate-limit backoff | 67.0 | 91.8 | 29.7% | 38.7 |
| model calls that failed | 21.4 | 35.8 | 11.6% | 9.2 |
| settling / validation (contains every page read) | 19.9 | 33.0 | 10.7% | 19.4 |
| page-state building, outside settle | 0.0 | 0.0 | 0.0% | 0.0 |
| action execution | 3.2 | 7.6 | 2.5% | 2.0 |
| network-idle waits | 2.9 | 3.3 | 1.1% | 2.0 |
| screenshots | not traced (inside "else") | | | |
| everything else | 6.4 | 12.7 | 4.1% | 5.1 |

**Biggest movers.** Total rose 41 s, and all of it is the provider: r2-cand ran **1 worker**, r3 runs **3 workers on one Vertex quota** (`overnight.log`). On the **56 tasks present in both runs**: total +0.8 s, provider tax **+15.0 s**, **agent-only −7.6 s**, planner calls **6 → 4**. The agent got faster; the harness got slower. Provider loss is **102.9 s median, 43% of mean total**.

Second mover: page-state is not a separate bucket. **100% of `getState` time falls inside a settle window** — the post-action settle read *is* the next step's state. Settle splits into 23.9 s/task of first reads (unavoidable), **7.2 s/task of confirm reads**, 1.7 s/task of sleeps.

**Ranked changes** (seconds saved per task, this corpus):

| # | change | s/task | accuracy risk |
|---|---|---:|---|
| 1 | Shared cross-worker rate limiter (or 1 worker per quota) | **−46 to −103** | none |
| 2 | Fewer steps from better perception (−3 wasted steps) | **−26 to −43** | high |
| 3 | Cut the 25 s call timeout to 12 s | **−9** | low |
| 4 | Planner interval 5 → 7 (one fewer plan) | **−7.8** | moderate |
| 5 | Skip the quiet-confirm read when the page was already quiet | **−4.8** | real, clicks only |
| 6 | Cap a single `getState` at 5 s | −4.0 mean, 0 median | low |
| 7 | Network-idle cap 5 s → 2 s | −2.0 | low |
| 8 | Drop hedged duplicates under quota pressure | −2.5 | low |
| 9 | Restore early-return on `wait` (regressed since r2) | −0.9 | none |
| 10 | Smaller prompts | **−0 to −7**, and **not** via 429s | low |

The unit that matters: **one avoided model call is worth 7.8 s median / 10.6 s mean**, not 3.8 s, because backoff scales with call count.

---

## Method and commands

Every number below comes from the three files per task. All scripts were `python3` read from stdin; nothing was written.

```bash
# corpus size and completeness
ls /…/e2e/results/mind2web-r3-3fdf2fa | wc -l          # 294 entries (287 task dirs + 7 files)
ls /…/mind2web-r3-3fdf2fa/*/result.json | wc -l         # 286
ls /…/mind2web-r3-3fdf2fa/*/trace.jsonl  | wc -l         # 257
tail -5 /…/mind2web-r3-3fdf2fa/status.log                # 276/300 final, 23 to run again
head -6 /…/mind2web-r3-3fdf2fa/overnight.log             # 3 workers: europe-west1, europe-north1, us-east1
head -6 /…/mind2web-r2-cand-6347e1c/overnight.log        # 1 worker: europe-west1
```

Bucketing rule (identical for both runs, so the comparison is like-for-like):

- Each `kind:"llm"` record with `durationMs` gives interval `[ts−durationMs, ts]`, tagged `llm_ok` / `llm_fail` (`msg` contains `failed`) / `hedge` (`superseded`).
- Each `rate limited; retrying in Xs` record (no `durationMs`) gives `[ts, ts+X·1000]`. **Validation:** the parsed sum is 67.2 s/task median against `result.provider.rateLimitWaitMs` = 66.0 s/task — 2% apart.
- Each `kind:"span"` with `durationMs`: `getState`, `network idle`, `action *`, `input dispatch`.
- Each `[ActionSettle] … total=Nms` log line gives `[ts−N, ts]`.
- Intervals are merged in priority order `llm_ok > llm_fail > backoff > settle > action > getState > network idle`; each bucket is charged only the time no higher bucket already owns. "Everything else" = `result.seconds` − union of all of them.

**Method validation:** running it on r2-cand reproduces the earlier `speed-plan.md` table — total 203.2 (was 203.2), model-ok 103.0 (104.7), backoff 38.7 (35.8), failed 9.2 (9.2), page reads 17.0 gross (17.0). The ordering differs only in whether the shared `getState`/settle intervals are labelled "page reads" or "settling"; they are the same seconds.

---

## 1. The wall-clock budget

### r3, n=227

| bucket | med s | mean s | share of mean | p90 s |
|---|---:|---:|---:|---:|
| **total** | **244.3** | **308.9** | 100% | — |
| model calls succeeded | 97.5 | 124.7 | 40.4% | — |
| rate-limit backoff | 67.0 | 91.8 | 29.7% | — |
| model calls failed | 21.4 | 35.8 | 11.6% | — |
| settling / validation | 19.9 | 33.0 | 10.7% | — |
| action execution (CDP) | 3.2 | 7.6 | 2.5% | — |
| network-idle waits | 2.9 | 3.3 | 1.1% | — |
| page-state build outside settle | 0.0 | 0.0 | 0.0% | — |
| everything else (untraced) | 6.4 | 12.7 | 4.1% | — |

Steps: median 14, mean 18.9, p90 40. `steps ÷ reference_length` median **2.00** (r2-cand 1.62 — but see the matched comparison; r3 is the full 300-task set, r2-cand a 60-task subset).

### What moved, and why

Naive run-to-run:

| | r1 (5 workers) | r2-cand (1 worker) | r3 (3 workers) |
|---|---:|---:|---:|
| total med | 293.3 | 203.2 | **244.3** |
| model ok med | 88.1 | 103.0 | 97.5 |
| backoff med | 123.8 | 38.7 | **67.0** |
| failed med | 21.5 | 9.2 | **21.4** |
| settle med | 14.4 | 19.4 | 19.9 |

Backoff tracks worker count, not build. The honest comparison is the **56 tasks that ran in both r2-cand and r3**:

| metric (median over the same 56 tasks) | r2-cand | r3 | Δ |
|---|---:|---:|---:|
| total seconds | 219.1 | 219.8 | +0.8 |
| provider tax (backoff + failed + superseded) | 56.5 | 71.5 | **+15.0** |
| **agent-only (total − provider tax)** | **141.1** | **133.5** | **−7.6** |
| successful model-call time | 104.7 | 100.3 | −4.4 |
| settling | 19.6 | 19.2 | −0.4 |
| steps | 14.0 | 14.0 | 0.0 |
| planner calls | 6.0 | 4.0 | **−2.0** |

Two items from the old plan shipped in build `3fdf2fa` and are visible:

- **Planner interval raised.** Planner calls 6.0 → 4.0/task; `replans.step_interval` 3.45 → 2.28/task. Worth the −7.6 s on its own.
- **Scroll's quiet check exempted** (`navigator.ts::getSettledPostActionState`, `needsQuiet`). Scroll settle median 0.94 → 0.67 s, scroll `polls` median 1 → 0, share of settles with `polls=0` 31% → 46%.

Full-corpus agent-only time: **median 127.2 s, mean 175.0 s**. Provider loss: median 102.9 s, mean 132.8 s = **43.2% of mean total**.

### The settle bucket, decomposed exactly

Matching each `getState` span to the `[ActionSettle]` window that contains it:

| component | s/task |
|---|---:|
| first read of each settle (= the next step's page state) | **23.93** |
| extra confirm / poll reads | **7.22** |
| sleeps and non-read overhead inside settle | 1.68 |
| total | 32.8 |

There is no separate "page-state build" line item in this agent: `getState` outside a settle window is **0.0 s/task**. 26.4 reads/task, median 493 ms, mean 1184 ms, p90 2.55 s, p99 8.68 s, max **220.9 s**.

---

## 2. Model-call latency

Single model for both roles: `gemini-2.5-flash` on Vertex (8 844 timed calls in r3; there is no second model to compare against).

| role | n | calls/task | med s | mean s | p90 s | p99 s | in-tok med | out+think med | cacheRead ÷ input |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| navigator | 4 333 | 19.1 | 3.79 | 4.89 | 8.83 | 18.50 | 10 199 | 222 | 0.44 |
| planner | 1 098 | 4.8 | 5.35 | 6.47 | 10.92 | 23.09 | 8 722 | 532 | **0.03** |

Other roles (intent check) are not separately timed; 37 `intent check` spans in the whole corpus, no duration recorded — negligible.

**Planner prompt caching is still broken.** 3% of planner input tokens come back cached, versus 44% for the navigator through the same `invokeLLM` path. Item 5 of the old plan was not shipped.

### Is latency driven by tokens, by the provider, or by contention?

Reported as correlations, not assertions:

| relationship | Pearson r | Spearman ρ |
|---|---:|---:|
| navigator: duration vs input tokens | 0.09 | 0.10 |
| navigator: duration vs output+thinking tokens | — | **0.45** |
| planner: duration vs input tokens | 0.06 | 0.07 |
| planner: duration vs output+thinking tokens | — | **0.65** |

Latency tracks **what the model writes**, not what it reads. Within-window medians confirm a weak but real input effect:

| navigator input tokens | n | med s | p90 s |
|---|---:|---:|---:|
| 4–8k | 911 | 3.58 | 8.12 |
| 8–12k | 1 983 | 3.72 | 8.53 |
| 12–16k | 1 027 | 3.88 | 9.07 |
| 16–20k | 358 | 4.25 | 11.61 |
| 20–24k | 28 | 5.30 | 16.69 |

Contention: bucketing all calls into 5-minute wall-clock windows (92 windows with ≥20 successful calls) and using the window's failure ratio as the load proxy:

| | corr with window median latency |
|---|---:|
| failed ÷ ok calls in the window | **−0.18** |
| call volume in the window | −0.15 |
| median input tokens in the window | −0.04 |

| quartile | median latency | median in-tok |
|---|---:|---:|
| quietest (fail ratio ≤ 0.48) | 4.43 s | 9 635 |
| busiest (fail ratio ≥ 0.70) | 3.75 s | 9 790 |

**Contention does not slow successful calls down; it converts them into 429s.** Held-constant within busy/quiet windows, the token effect survives at roughly +0.1–0.5 s per 4k tokens. So the answer is: neither tokens nor contention drive *latency* much — contention drives *failure*, which is a different and much larger bucket.

---

## 3. The 20 slowest steps

Steps segmented by the `step` field on sorted trace records; a step runs from its first record to the first record of the next step. 4 517 steps: median 8.6 s, mean 15.5 s, p90 38.8 s, p99 76.6 s, max 280 s. The **top 1% of steps hold 7.4% of all step time; the top 10% hold 37.8%**.

| # | task | step | total s | model ok | model failed | backoff | settle | action | netidle | hedge | untraced | what it was doing |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | c801d1c9 | 23 | 280 | 0 | 131 | 149 | 0 | 0 | 0 | 0 | 0 | 429 retry loop, no action reached |
| 2 | 644a856c | 25 | 252 | 0 | 80 | 172 | 0 | 0 | 0 | 0 | 0 | 429 retry loop |
| 3 | 47186fac | 0 | 251 | 0 | 250 | 0 | 0 | 0 | 0 | 0 | 1 | 10 × 25 s call timeouts, first step |
| 4 | 96afb3c5 | 13 | 236 | 7 | 3 | 17 | **192** | 4 | 0 | 0 | 13 | scroll → settle read hung (merriam-webster, 1 187 elements) |
| 5 | 199be0b5 | 10 | 226 | 3 | 0 | 0 | **223** | 0 | 0 | 0 | 0 | click → single `getState` took 220.9 s (dillards) |
| 6 | b320c68b | 13 | 221 | 0 | 57 | 165 | 0 | 0 | 0 | 0 | 0 | 429 retry loop |
| 7 | be9e7dca | 26 | 156 | 0 | 134 | 22 | 0 | 0 | 0 | 0 | 0 | timeouts + 429 |
| 8 | 157f4a79 | 16 | 132 | 37 | 89 | 3 | 3 | 0 | 0 | 0 | 0 | click, mostly failed calls |
| 9 | 82eb3bfe | 4 | 129 | 5 | 0 | 0 | 56 | 15 | 1 | 0 | **52** | `go_to_url` — page load, 52 s outside any span |
| 10 | f05e87c5 | 12 | 126 | 15 | 11 | 99 | 1 | 0 | 0 | 0 | 0 | click, backoff-dominated |
| 11 | 63d6866f | 13 | 126 | 0 | 125 | 0 | 0 | 0 | 0 | 0 | 1 | 5 × 25 s timeouts |
| 12 | 64345c36 | 1 | 125 | 0 | 125 | 0 | 0 | 0 | 0 | 0 | 0 | 5 × 25 s timeouts |
| 13 | 63d6866f | 14 | 120 | 32 | 88 | 0 | 0 | 0 | 0 | 22 | — | timeouts + hedge |
| 14 | 05483c50 | 5 | 119 | 7 | 9 | 102 | 1 | 0 | 0 | 0 | 0 | click, backoff |
| 15 | dcd26e66 | 10 | 119 | 11 | 87 | 21 | 0 | 0 | 0 | 1 | — | timeouts + 429 |
| 16 | 82eb3bfe | 2 | 119 | 6 | 2 | 38 | 56 | 15 | 1 | 0 | 1 | `go_to_url`, slow load + backoff |
| 17 | a5c87cc1 | 0 | 106 | 5 | 8 | 88 | 0 | 0 | 4 | 0 | 1 | `input_text`, backoff |
| 18 | a13e4231 | 20 | 106 | 14 | 63 | 26 | 2 | 0 | 0 | 0 | 1 | click, timeouts |
| 19 | 367d843c | 1 | 103 | 26 | 27 | 50 | 0 | 0 | 0 | 7 | — | backoff + hedge |
| 20 | a5c87cc1 | 3 | 103 | 14 | 11 | 76 | 2 | 0 | 0 | 0 | 0 | click, backoff |

Mean composition, slowest decile vs the rest:

| bucket | slowest 10% | the rest |
|---|---:|---:|
| backoff | **31.3 s** | 1.7 s |
| failed model calls | **11.7 s** | 0.7 s |
| navigator model calls | 6.0 s | 4.5 s |
| planner model calls | 4.1 s | 1.3 s |
| settling | 3.2 s | 1.5 s |
| action | 0.5 s | 0.4 s |
| network idle | 0.5 s | 0.4 s |
| **step total** | **58.8 s** | **10.7 s** |

**The tail is not page loads and not settling. 17 of the top 20 are retry storms** — 429 backoff or 25 s call timeouts. Two are a single `getState` that hung (220.9 s and 192.2 s); one is an untraced `go_to_url` page load.

---

## 4. Per-action cost

`act` = the `NavigatorAgent action *` span. `settle` = the `[ActionSettle] total` that follows it. `polls` = **extra** reads beyond the first.

| action | n | /task | act med | act p90 | settle med | settle p90 | polls med | settled=false | s/task (act+settle) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| click_element | 1 846 | 8.13 | 0.12 | 0.38 | **2.09** | 4.68 | 1 | 6% | **22.96** |
| scroll | 776 | 3.42 | 0.04 | 1.07 | 0.67 | 2.72 | 0 | 7% | 6.32 |
| go_back | 211 | 0.93 | 0.25 | 5.44 | 2.19 | 5.51 | 1 | 2% | 4.49 |
| input_text | 421 | 1.85 | 0.26 | 0.82 | 0.42 | 2.79 | 0 | 2% | 2.81 |
| go_to_url | 29 | 0.13 | 2.72 | 15.00 | 3.30 | 56.13 | 0 | 0% | 1.82 |
| wait | 61 | 0.27 | 3.00 | 10.05 | — | — | — | — | 0.89 |
| send_keys | 41 | 0.18 | 0.20 | 1.71 | 1.55 | 2.72 | 1 | 12% | 0.47 |
| select_dropdown_option | 45 | 0.20 | 0.08 | 0.26 | 1.38 | 2.56 | 1 | 0% | 0.33 |
| switch_tab | 36 | 0.16 | 0.04 | 0.10 | 1.03 | 1.92 | 1 | 0% | 0.25 |
| get_complete_page_content | 187 | 0.82 | 0.02 | 1.26 | — | — | — | — | 0.20 |
| scroll_to_text | 24 | 0.11 | 0.03 | 0.05 | — | — | — | — | 0.00 |
| done / save_findings / ask_human / view_screenshot | 240 | 1.05 | 0.00 | 0.00 | — | — | — | — | 0.00 |

**The action itself is free; the settle is the cost.** Across every action kind, `act` is 0.12 s median and settle is 1.49 s median. Split by first-vs-extra read:

| action | first read s/task | extra confirm reads s/task |
|---|---:|---:|
| click_element | 13.92 | **5.67** |
| scroll | 4.03 | 0.88 |
| go_back | 2.42 | 0.24 |
| input_text | 2.03 | 0.04 |
| go_to_url | 1.10 | 0.05 |
| all others | 0.43 | 0.34 |
| **total** | **23.93** | **7.22** |

`click_element` is 47% of actions and **70% of all action+settle time**.

---

## 5. Waiting

| | r3 | r2-cand |
|---|---|---|
| settle total | 33.0 s/task, median 1.49 s, p90 4.28 s, p99 10.27 s, max 222.8 s | 29.0 s/task, median 1.20 s |
| `settled=false` (settle timed out) | 176 / 3 407 = **5.2%** | 3.7% |
| network-idle waits | 4.3/task, 8.8 s/task gross, **26% hit the 5 s cap** | 3.6/task, 26% |
| network idle that timed out | 257 waits, median 5.01 s → **5.60 s/task** | — |
| network idle that returned early | 730 waits, median 0.30 s → 3.08 s/task | — |
| explicit `wait` action | 61 calls, requested median 5 s, **actual median 3.00 s** | 25 calls, actual median 0.02 s |
| `wait` early returns | **0 of 63** | effectively all |

Settle by poll count:

| polls | n | share | med s | total s/task | reading |
|---:|---:|---:|---:|---:|---|
| 0 | 1 567 | 45.7% | 1.19 | 18.30 | one read only; quiet check skipped (`input_text`, moving `scroll`) |
| 1 | 1 406 | 41.0% | 1.25 | 10.50 | **first confirm found the page already quiet** |
| 2 | 309 | 9.0% | 2.08 | 2.73 | genuinely still changing |
| 3–7 | 146 | 4.3% | ~2.2 | 1.43 | genuinely still changing |

**Avoidable waiting:**

- The **7.22 s/task of extra reads**; of the 2 597 extra reads, 1 406 (54%) are the `polls=1` case where the page was already quiet. That is **≈3.9 s/task of pure confirmation**, plus ≈0.9 s of the 150 ms sleeps that precede them → **~4.8 s/task**.
- **5.60 s/task of network-idle waits that hit the cap** and learned nothing (gross; ~3.3 s/task net of overlap).
- **0.9 s/task of `wait` actions that no longer return early** — a regression against r2-cand, where the same action returned in 0.02 s median.
- Two pathological `getState` calls (220.9 s, 192.2 s) plus 35 more over 10 s: **4.79 s/task mean, 0 median**. Capping one read at 5 s recovers 3.97 s/task mean.

---

## 6. Provider effects

From `result.json` `provider` blocks over all 288 results:

| | r3 | r2-cand |
|---|---:|---:|
| provider calls | 9 060 (31.5/task) | 1 985 (33.1/task) |
| failed | 3 367 (**37%**) | 617 (31%) |
| 429 rate-limited | 3 140 (10.9/task) | 545 (9.1/task) |
| timeouts | 168 | 59 |
| network errors | 41 | 10 |
| 5xx / auth / other | 0 / 3 / 15 | 0 / 0 / 3 |
| `rateLimitWaitMs` total | 21 352 s = **74.1 s/task** | 3 296 s = 54.9 s/task |
| as a share of all task seconds in the run | **29.3%** | 21.3% |

Failed-call time by cause (union-charged):

| role | cause | n | /task | med s | s/task |
|---|---|---:|---:|---:|---:|
| navigator | 429 | 2 452 | 10.80 | 1.11 | 18.0 |
| navigator | timeout (25 s) | 94 | 0.41 | 25.00 | **10.1** |
| planner | timeout (25 s) | 72 | 0.32 | 25.00 | **8.1** |
| navigator | superseded hedge loser | 137 | 0.60 | 5.16 | 4.3 |
| planner | 429 | 549 | 2.42 | 0.96 | 3.5 |
| planner | superseded hedge loser | 50 | 0.22 | 4.58 | 1.5 |
| both | network/other | 59 | 0.26 | — | 0.7 |

Timeouts are only 0.73 calls/task but **18.2 s/task** — over half the failed-call bucket, because each one burns the full 25 s.

**Hedging:** 289 duplicates fired (1.26/task), 200 losers superseded. Net extra wall clock from losers after union: **2.48 s/task**. Hedged calls that won took 11.95 s median versus 3.98 s for non-hedged — the hedge is firing on genuinely slow calls, but it adds 1.26 requests/task to a request-limited quota.

**What the 429s actually track:**

| relationship | r |
|---|---:|
| provider calls ↔ 429 count | **0.91** |
| provider calls ↔ rateLimitWaitMs | 0.79 |
| task input tokens ↔ 429 count | 0.70 |
| task input tokens ↔ rateLimitWaitMs | 0.56 |
| **tokens per call ↔ 429 per call** | **0.02** |

| tokens per call | n | 429 per provider call (median) |
|---|---:|---:|
| 6–9k | 74 | 0.34 |
| 9–12k | 99 | 0.34 |
| 12–15k | 52 | 0.33 |

The limit being hit is **requests per minute, not tokens per minute.** Token/call has no effect on the 429 rate. The token correlation is entirely mediated by call count. This kills the "smaller prompts buy provider headroom" theory.

**Therefore the unit of saving is the model call, not the token:**

- backoff per provider call: **2.03 s median**
- loaded wall clock per model call = (model ok + failed + backoff) ÷ calls per task = **7.78 s on medians, 10.56 s on means**
- marginal cost of one agent step: **14.3 s** total (OLS, corr(seconds, steps) = 0.86), **8.63 s** with the provider tax removed (intercept 12.0 s)

---

## Ranked changes

Seconds are per task against the r3 medians (244.3 s total, 14 steps, 23.9 model calls, 191k input tokens, $0.059).

### 1. A shared rate limiter across workers, or one worker per quota — **−46 s (conservative) to −103 s (ceiling)**

*Measured:* provider tax is 102.9 s median / 132.8 s mean = **43.2% of mean total**. On the 56 matched tasks, going from 1 worker (r2-cand) to 3 workers (r3) added **15.0 s/task median** while the agent itself got 7.6 s faster; r1's 5 workers cost 123.8 s of backoff. 37% of all 9 060 requests fail. 429s correlate 0.91 with call volume and 0.02 with prompt size, so this is a request-rate problem with a request-rate fix: a token bucket shared across the three workers that paces requests below the per-region RPM limit, so the agent waits deterministically instead of paying a failed round-trip plus exponential backoff for every third call.

*Accuracy risk:* **none.** Identical requests, different scheduling. The cost is run throughput, not per-task time — and it is not even clearly a cost, since 37% of requests are currently wasted work.

*Verify:* `provider.failed ÷ provider.calls` and `rateLimitWaitMs` per task.

### 2. Fewer steps from better perception — **−26 to −43 s**

*Measured:* 14.3 s of total wall clock per step (8.63 s agent-only + the provider tax the step's calls attract). `steps ÷ reference_length` median **2.00**. **36% of all actions are an exact repeat** of an earlier action in the same task (6.2/task); 73% of scrolls are repeats. `click_element` is 47% of actions and 70% of action+settle time. Removing 2–3 wasted steps is 26–43 s.

*Accuracy risk:* **high, and this is the hard one.** Everything here is a perception/planning improvement, not a timing knob — the mechanical part (refuse the Nth identical action) is item 2a of the old plan and is worth roughly the first 15 s; the rest is choosing the right element the first time.

*Verify:* exact-repeat action share, steps/task, pass rate.

### 3. Cut the model-call timeout from 25 s to 12 s — **−9 s**

*Measured:* 166 timeouts across the run, each burning the full 25 s = **18.2 s/task**. Successful calls have p99 = 18.5 s (navigator) / 23.1 s (planner), so a 12 s cap would abandon roughly the slowest 2–3% of calls — but the hedge already fires on those (hedged winners: 11.95 s median), so the duplicate is usually in flight by then. Halving the timeout halves the 18.2 s.

*Accuracy risk:* **low.** A cancelled call is retried; a 25 s call that would have succeeded at 24 s is rare and its retry costs less than the 13 s saved.

*Verify:* `provider.timeout` count and the failed-call s/task.

### 4. Planner interval 5 → 7 — **−7.8 s**

*Measured:* still 4.8 planner calls/task, `step_interval` still the largest trigger at 2.28/task (vs `initial` 1.01, `validation` 0.53, `contract_complete` 0.47). One fewer planner call = 5.35 s of latency + its share of backoff = **7.8 s loaded**. The 6 → 4 change already banked 7.6 s on the matched tasks with no outcome regression (37 `task.ok` both runs); the same lever has one more notch.

*Accuracy risk:* **moderate.** All corrective triggers stay armed; the loss is only on tasks that drift silently. Diminishing returns — 4.8 calls is already near the floor of `initial` + `validation` + `contract_complete`.

*Verify:* `metrics.replans.step_interval`, steps/task, pass rate.

### 5. Skip the quiet-confirm read when the first confirm would find the page quiet — **−4.8 s**

*Measured:* 7.22 s/task of extra reads plus 1.68 s/task of sleeps. 54% of extra reads are the `polls=1` case: the page was already quiet and the read changed nothing. `click_element` alone is 5.67 of the 7.22.

*Where:* `agent/agents/navigator.ts::getSettledPostActionState` — the `needsQuiet` predicate that already exempts a scroll that moved. Extend it to clicks whose `validateActionOutcome` passed on **target-local** evidence (`target_value`, a confirmed selection, `handle_dialog`) rather than page-wide `document_change`.

*Accuracy risk:* **real, and this is the one to be careful with.** Reading after a click too early raises `unknown` validations, and each of those costs a re-plan (7.8 s) — so a change that saves 4.8 s and adds 0.2 unknown validations per task is net negative. Do not exempt `go_back`, `go_to_url` or anything in `NAVIGATION_ACTIONS`. `settled=false` is already up 3.7% → 5.2% between runs.

*Verify:* `[ActionSettle] polls`, and `metrics.validations.unknown` before and after.

### 6. Cap a single `getState` at 5 s — **−4.0 s mean, 0 median**

*Measured:* 37 reads over 10 s totalling 1 093 s = 4.79 s/task mean. The two worst are 220.9 s (dillards.com, 0 elements returned) and 192.2 s (merriam-webster, 1 187 elements) — steps #4 and #5 of the top-20. Capping at 5 s and returning the last good state recovers 3.97 s/task mean.

*Accuracy risk:* **low.** A read that takes 220 s and returns 0 elements is already useless.

*Verify:* the `getState` duration p99 and max.

### 7. Network-idle cap 5 s → 2 s — **−2.0 s**

*Measured:* 4.3 waits/task; **26% hit the cap** (257 waits × 5.01 s = 5.60 s/task gross, ~3.3 s/task net after overlap). The 74% that return early return in 0.30 s median — the useful signal arrives fast or not at all, so the last 3 s of the cap buys nothing in 26% of cases.

*Accuracy risk:* **low**, but non-zero on slow sites where a late XHR carries the results. Settling would catch most of it.

*Verify:* the `network idle` span `timedOut` rate and s/task.

### 8. Drop hedged duplicates while the quota is saturated — **−2.5 s**

*Measured:* 289 hedges/230 tasks, 200 losers, **2.48 s/task** of extra union time, plus 1.26 extra requests/task on a request-limited quota where 37% of requests already fail. The hedge helps the individual call (hedged winners 11.95 s median) but feeds the 429 loop that costs 67 s/task.

*Accuracy risk:* **low.** Gate hedging on the recent 429 rate: hedge when the provider is healthy, never when it is shedding load. Superseded by item 1 if the shared limiter lands.

*Verify:* `slow call; sending a duplicate request` count vs `provider.rateLimited`.

### 9. Restore the `wait` action's early return — **−0.9 s**

*Measured:* a regression against r2-cand. r2-cand: 25 waits, actual median **0.02 s**. r3: 61 waits, actual median **3.00 s**, and **0 of 63 returned early**. 42 of the 63 carry no `seconds` argument at all.

*Accuracy risk:* **none** — it is restoring shipped behaviour.

*Verify:* `action wait` span `durationMs` median.

### 10. Smaller prompts — **−0 to −7 s, and not for the reason previously assumed**

*Measured:* corr(duration, inputTokens) = **0.09** navigator / 0.06 planner; Spearman 0.10 / 0.07. Latency tracks *output* tokens instead (ρ 0.45 / 0.65). Within fixed contention windows, going 16–20k → 4–8k input moves the median from 4.66 s to 4.41 s (quiet) and 4.25 s to 4.15 s (busy) — about 0.1–0.3 s per call, so ≈2–7 s/task if every prompt were halved. **And it buys no provider headroom:** corr(tokens per call, 429 per call) = **0.02**. The limit is requests, not tokens.

*The real argument for smaller prompts is not speed:* **44 of 286 tasks (15%) end at the 500k input-token cap** (`limit_tokens`), which is an accuracy loss, and cost is $0.079/task mean ($18 for the run). Rank it as a correctness item, not a speed item.

*Verify:* the `limit_tokens` outcome count.

### Considered and rejected, with the measurement

- **Parallel page reads / overlapping state build with the model call.** The first settle read *is* the model call's input — 23.9 of the 33.0 s/task of settle cannot be moved off the critical path by construction. The only genuinely parallelisable read is the **quiet confirm** (7.2 s/task): issue the navigator call on the first read and cancel if the confirm disagrees. That is item 5 with extra machinery and the same accuracy risk, for the same 4.8 s. Take item 5 instead.
- **Batching actions per step.** Unchanged from the old finding: the action mix is 47% `click_element`, whose stop rules legitimately end a batch. Not worth prompt surgery.
- **Streaming.** Output is a single tool call, 222 (navigator) / 532 (planner) tokens median. Nothing executable from a partial tool call.
- **Fixing the planner's zero prompt caching.** Still broken (3% vs the navigator's 44%) and still worth ~19k tokens/task at no accuracy risk — but tokens are not the bottleneck and cached input does not reduce latency measurably here. A cost item, not a speed item.
- **Avoiding screenshots.** 19.7/task are written by the harness, but no screenshot span carries a duration and `getState` is never called with `useVision:true` in this corpus. Whatever they cost is inside the 12.7 s/task of untraced time, most of which is accounted for below.
- **Trace writes, checkpoints, `removeHighlight`.** Every untraced gap between spans sums to **9.80 s/task**, and the largest single line is `network idle → llm` at 2.05 s/task (page load finishing before the call) — not harness overhead. Nothing to win.
- **More workers.** Directly measured to be negative: 1 → 3 workers cost 15.0 s/task on identical tasks.

### What could not be measured

- **Time-to-first-token vs generation.** No streaming; a 3.79 s call is queue + prefill + decode with no split. The 0.45/0.65 Spearman against output tokens says decode dominates the variance, but not by how much.
- **Screenshot cost**, separately — untraced, somewhere inside the 9.8 s/task of gaps.
- **Whether the 14 unfinished tasks skew the corpus.** 286 of 300 have results and the run had 23 tasks queued for a re-run; the re-run population is biased toward `provider_down` and `site_blocked`, which would push the provider share *up*, not down.
- **Ground-truth step counts.** `reference_length` is a Mind2Web annotation for a different UI path; the 2.00 ratio is directional. The unbiased mechanical figure is the 36% exact-repeat action rate.
- **Whether `site_blocked` (55 tasks, 19% of the corpus) consumes wall clock worth optimising.** 30 of them have traces; they are excluded here to keep the comparison to r2-cand honest, since r2-cand's 60-task subset has none.

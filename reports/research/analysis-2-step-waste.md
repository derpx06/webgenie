## Step Analysis — Mind2Web runs r1–r3

*(Read-only; every number below comes from the commands shown. Nothing was written.)*

---

## Summary

**Corpus:** r3 (`3fdf2fa`, 289 tasks with `result.json`, 4,862 step-units = 4,649 executed actions + 213 planner-only steps, 56.6M input tokens, 20.3 wall-hours), r2-cand (60) and r2-base (60) for comparison, and 248 r1 reviews reused for root causes and ideal-step estimates.

**Buckets (r3, all tasks)**

| bucket | n | share | med tok | med s |
|---|---|---|---|---|
| productive | 2,693 | 55.4% | 11,346 | 8.3 |
| redundant | 747 | 15.4% | 9,860 | 8.2 |
| blocked | 652 | 13.4% | 9,836 | 6.1 |
| corrective | 295 | 6.1% | 9,668 | 9.7 |
| overhead | 303 | 6.2% | 9,544 | 6.3 |
| exploratory-dead-end | 172 | 3.5% | 9,198 | 7.9 |

**Failures are 3.3× successes, not 2×:** median 33 steps / 533 s / 505k tokens vs 10 / 166 s / 136k. Failures are not "more of the same": productive share drops 63.6% → 48.1% while redundant+corrective+dead-end rises 16.2% → 34.9%.

**First divergence (64 agent-failures, all classified)**

| class | n | share |
|---|---|---|
| planner error (loop, no route memory, premature/absence answer) | 19 | 30% |
| missing perception (control existed, state never showed it) | 16 | 25% |
| wrong route (page/tool that cannot satisfy the task) | 11 | 17% |
| wrong target (criterion into the wrong control; autocomplete not committed) | 7 | 11% |
| guard refusal (false "covered", URL policy guard, commit gate) | 6 | 9% |
| site behaviour (regional variant, grid never rendered, stuck overlay) | 5 | 8% |

**Changes ranked by steps removed in this corpus** (marginal, after the ones above it):

| # | change | steps | marginal | tokens |
|---|---|---|---|---|
| 1 | one-shot page reading | 624 (13.4%) | 624 | 8.68M |
| 2 | validate-before-act | 357 (7.7%) | 341 | 4.92M |
| 3 | call the site's own API | 1,116 (24.0%) | 492 | 5.90M |
| 4 | smaller action space | 364 (7.8%) | 160 | 1.58M |
| 5 | failed action forces a re-look | 157 (3.4%) | 46 | 0.53M |
| 6 | per-domain workflows | 96 (2.1%) | 74 | 0.88M |
| 7 | evidence-gated finish | 0 | 0 | — (quality only) |
| 8 | no horizontal scroll | 0 | 0 | — (does not occur) |

Union: **1,737 steps (37.4%), 22.5M tokens (39.8%), 7.3 wall-hours.** 1 and 3 overlap totally (624/624); 3 and 4 overlap on 204; 2 and 5 overlap on 109.

---

## 1. Method and commands

Step-units come from `events.jsonl` (`act.ok` / `act.fail`, paired with the preceding `act.start` for the verb), which matched `result.json.action_history` exactly in 250/257 tasks. Per-step tokens are the `kind:"llm"` records in `trace.jsonl` summed by `step` and divided by the number of actions in that step; per-step seconds are the gap to the previous action (so LLM latency, retries and backoff are charged to the step they paid for).

```bash
# corpus shape
du -sh e2e/results/mind2web-r3-3fdf2fa      # 2.3G, 289 tasks with result.json
python3 -c "...Counter(d['outcome'] for d in results)..."
# step-unit alignment check (events vs action_history)
#   -> 250/257 exact, 5 off by 1
# guard taxonomy
grep -h "error:" */timeline.txt | sed 's/[0-9]\+/N/g' | sort | uniq -c | sort -rn
# scroll directions in all four runs -> down/up/top/bottom only, never left/right
for r in r3 r2-cand r2-base r1; do grep -ho 'action scroll {[^}]*}' $r/*/timeline.txt | ...; done
```

Classification rules, in priority order:

| bucket | rule |
|---|---|
| blocked | `act.fail` (guard refusal or page error), guard named from the error string |
| corrective | `go_back`, `close_tab`, or `scroll_up`/`scroll_top` within 4 steps of a downward scroll |
| redundant | exact repeat of an earlier action's details; scroll whose report says "page height did not change"; 4th+ consecutive identical scroll |
| exploratory-dead-end | every step from a navigating click/`go_to_url` up to the `go_back` that undid it, when nothing was extracted in between (the `go_back` itself stays corrective) |
| overhead | planner-only steps (REPLAN with no action), `wait`, `view_screenshot`, `ask_human`, `TASK_INCOMPLETE` |
| productive | everything else |

Caveats worth carrying: r3 has no LLM judge, so **success = harness outcome `task.ok`**, which is optimistic — in the r1 reviews only 83/248 answers were *correct*, 32 partially correct, 20 wrong, 75 no answer, 10 honest refusals. And **29.2% of r3 wall time (21,352 s of 73,223 s) was provider rate-limit backoff** (239/289 tasks hit a 429), so seconds are latency-inflated; step and token counts are not.

## 2. Buckets per run

| bucket | r3 n | r3 % | med tok | med s | Σ s | r2-cand % | r2-base % |
|---|---|---|---|---|---|---|---|
| productive | 2,693 | 55.4% | 11,346 | 8.3 | 39,219 | 58.3% | 58.0% |
| redundant | 747 | 15.4% | 9,860 | 8.2 | 10,840 | 15.9% | 16.8% |
| blocked | 652 | 13.4% | 9,836 | 6.1 | 8,613 | 11.5% | 12.6% |
| corrective | 295 | 6.1% | 9,668 | 9.7 | 5,091 | 4.8% | 4.2% |
| overhead | 303 | 6.2% | 9,544 | 6.3 | 3,601 | 6.7% | 6.8% |
| exploratory-dead-end | 172 | 3.5% | 9,198 | 7.9 | 2,277 | 2.8% | 1.6% |
| **total** | **4,862** | | | | **69,641** | 1,126 units | 1,160 units |

The mix is stable across builds (waste 41–45% everywhere); r3's extra dead-end share comes from its harder 300-task slice, not a regression — r2-cand and r2-base scored identically (41/60 `task.ok` each).

**Bucket by action** (r3, top rows): `click` productive 1,363 / blocked 441 / redundant 362 / dead-end 149; `scroll_down` productive 479 / redundant 190 / blocked 64; `input_text` productive 358 / redundant 86 / blocked 62; `replan` overhead 226; `go_back` corrective 219. One click in five is refused, and one in five is a repeat.

**Guards and page errors** (all 652 blocked units):

| guard / error | n | share | med s | med tok |
|---|---|---|---|---|
| overlay-covered ("is covered by …") | 146 | 22.4% | 8.3 | 12,597 |
| no-op click ("did not visibly change") | 99 | 15.2% | 2.3 | 5,710 |
| stale index (not on page / detached / no longer available) | 97 | 14.9% | 10.5 | 12,063 |
| invisible element ("no visible area") | 93 | 14.3% | 10.4 | 13,681 |
| no-op scroll ("page did not scroll") | 51 | 7.8% | 2.3 | 6,034 |
| policy URL guard ("nothing in the user's request leads to …") | 51 | 7.8% | 17.4 | 8,289 |
| policy text guard ("Not typed:", "does not ask to enter") | 25 | 3.8% | 16.7 | 9,572 |
| history-missing / wrong-el-type / disabled / read-only | 30 | 4.6% | ~8 | ~10k |
| other + timeouts + dropdown-option-missing | 60 | 9.2% | | |

Policy guards are the expensive ones per step (17 s median — they burn a full LLM round trip to be told no) and they account for 76 refusals, 11.6% of all blocks.

## 3. Step-shape of a success versus a failure

| | successes (158) | agent-failures (64) | env-failures (67) |
|---|---|---|---|
| median steps | 10 | 33 | 0 |
| mean steps | 13.0 | 33.8 | 3.7 |
| median seconds | 166 | 536 | 20 |
| median input tokens | 136,263 | 504,735 | 7,490 |
| median cost | $0.043 | $0.150 | $0.003 |
| median LLM calls | 14 | 43 | 2 |
| steps ÷ benchmark `reference_length` | **1.65×** | **3.86×** | — |

| bucket | success share | agent-fail share | Δ |
|---|---|---|---|
| productive | 63.6% | 48.1% | −15.5 |
| redundant | 10.6% | 21.3% | **+10.7** |
| corrective | 3.2% | 8.9% | +5.7 |
| blocked | 11.4% | 14.7% | +3.3 |
| exploratory-dead-end | 2.4% | 4.7% | +2.3 |
| overhead | 8.9% | 2.4% | −6.5 |

**The published ~2× does not hold here: failures take 3.3× the steps, 3.2× the seconds and 3.7× the tokens of successes.** Two mechanisms explain the excess. (a) The failure modes are *recirculating*, not merely long: redundant doubles and corrective triples, i.e. the agent re-reads and re-undoes rather than advancing. (b) The budget is a token cap, not a step cap — 44 of 64 agent-failures died as `limit_tokens` at a median 505k tokens, almost exactly the 500k `maxInputTokens` limit, so failures are *defined* by burning the budget. Note the inversion in overhead: successes spend a **larger** share on planner-only steps (8.9% vs 2.4%) because a short run's two or three replans are a big fraction of twelve steps — planning is not what failures over-spend on.

Failures also announce themselves early. Median steps-to-first-block is small, and 172 of 289 tasks never reach a `done` at all; when `done` does fire it is always terminal (0 steps ever follow a `done` in the whole corpus).

The r1 human reviews agree on direction and are harsher on magnitude: median `steps_taken` 12 vs `steps_needed_estimate` 6 (2.0× over ideal) and a median of 9 wasted steps per task — reviewers also count *route-level* waste (a longer path that nonetheless worked), which my structural classifier books as productive.

## 4. First divergence (64 of 64 agent-failures)

Every agent-failure in r3 also has an r1 review of the same task, so each first divergence is backed by the r3 action history **and** an independent human root cause. Classification is of the *first* step whose choice determined the rest of the run.

| class | n | share | what it looks like | representative tasks (first bad step) |
|---|---|---|---|---|
| **planner error** | 19 | 30% | re-issues an already-failed route, no memory of dead ends, concludes absence after one route, answers from a snippet, verifies a detail the site never exposes | `11abb668` s2 re-click of "Support & Services"; `239a29bd` s6 `go_back` off the correct article then loops; `271b36ef` declares "no open-box facet" after one search page; `78baf9db` finishes from a search snippet; `92160852` cycles PDFs↔search↔form |
| **missing perception** | 16 | 25% | the control exists but the state never showed it: inner scroll containers, sliders as unnamed spans, native date segments, custom checkboxes, a combobox overlay that swallows the page | `0b51b4fa` s2 filter panel opens, options never listed → 11 blind scrolls; `0e42c3a7` s1 filter dialog read as 251 chars; `949dc965` arrival-time slider as two generic spans; `a6f0434c` s5 and `4f903626` s9 type into a `<span>` date segment three times each; `3adeea76` s9 state holds one element, then 35 scrolls |
| **wrong route** | 11 | 17% | a page or tool that cannot satisfy the task | `1aeca99e` s2 "Launch service (external link)" instead of CalCareers advanced search; `62c8d970` s0–3 keyword-searches for "Steam Deck" instead of the charts page; `cf757a77` uses the site chatbot; `bb5d90e6` uses the site-wide search whose results page has no facets |
| **wrong target** | 7 | 11% | right page, wrong control or uncommitted value — above all autocomplete submitted before a suggestion is chosen | `0632e496` s0 puts "without nuts" in the query instead of the exclude filter; `9c04b71b` s1–3 submits the address before picking the suggestion; `b2f4fde2` searches the wrong city for the same reason; `6b5be176` s0–1 double-types, no suggestion |
| **guard refusal** | 6 | 9% | a legal action refused by our own guard | `157f4a79` s0–3 four `Not done: nothing in the user's request leads to shopdisney.com` on a Disney-toys task; `82eb3bfe` s0–7 same guard on coinmarketcap, task dies at step 10; `11857213` false "covered" verdict inside a scrollable dialog; `c43a7dcc` commit gate on a label regex |
| **site behaviour** | 5 | 8% | environment, not agent | `4464a8421` result grid never renders; `7562d9b4` USPS loading overlay never clears; `199be0b5`/`7072d094`/`c698ff3f` regional variants and geo-defaults |

**Read this as the fix order.** Planner error and missing perception are 45 of 64 (70%) and they are the two classes that produce *long* failures (they are over-represented in `limit_tokens`). Wrong target is small in count but the cheapest to fix: 4 of the 7 are the same bug — an autocomplete typed into and submitted without committing a suggestion.

## 5. What a perfect harness would have done (15 failures)

Ideal sequences are taken from the reviewers' `better_strategy` for the same task — every step in them is an action the traces show was present on the page — and the gap is measured against both the benchmark's own `reference_length` and the reviewer's estimate.

| task | site | ideal sequence (from the trace's own affordances) | actual | ref | ideal | gap |
|---|---|---|---|---|---|---|
| `0632e496` | cookpad | search "gluten-free chocolate chip cookies" → type "nuts" into the results page's **Exclude** filter → report the filtered list | 31 | 4 | 4 | +27 |
| `0b51b4fa` | carmax | search "Toyota Corolla" → Show filters → Year & mileage min 2018 max 2023 → Colors → Red → confirm chips | 28 | 13 | 8 | +20 |
| `0e42c3a7` | google maps | search "gas station Manhattan NY" → Rating 4.0+ chip → open a 4.1+ station → Reviews → Sort → Lowest rating | 49 | 7 | 7 | +42 |
| `11857213` | birkenstock | sort Bestseller → open filter → scroll the size list *inside* the dialog to EU45/UK10.5 → colour Braun → open first result → add to cart | 22 | 12 | 9 | +13 |
| `11abb668` | bestbuy | Find a store → 30010 → Filter by services → Apple Authorized Service Provider → Show Results → Make This Your Store → confirm header | 44 | 10 | 8 | +36 |
| `157f4a79` | disney | search "Lilo & Stitch" → Product Type toys → sort Most Popular → drag/arrow the max-price handle below $20 → read first result | 34 | 9 | 7 | +27 |
| `199be0b5` | dillards | after the batch fails, re-read the page once (form is gone) → find "Recipient" → look for the country/shipping selector → else report the eGift form is absent in the international variant | 40 | 20 | 10 | +30 |
| `1ab384fb` | phet | Build a Nucleus → Play → activate Decay by keyboard → +/- to 4 protons, 2 neutrons → Proton Emission → report | 47 | 11 | 12 | +35 |
| `1aeca99e` | ca.gov | CalCareers → Advanced Job Search → Category "Legal Occupations" → San Diego County → Full Time → min 4000 → search → verify the criteria banner | 50 | 10 | 9 | +41 |
| `239a29bd` | healthline | search short keywords ("gluten-free pregnancy") → open the two best hits → `get_complete_page_content` each once → answer | 40 | 8 | 6 | +34 |
| `271b36ef` | bestbuy | no condition facet on keyword search → switch route: Shop → TVs category → Condition facet → Samsung + 8K | 39 | 4 | 5 | +34 |
| `301f267f` | healthline | /recipes/search empty query → toggle Snacks, High protein, Vegan, Quick → check `aria-pressed` → read cards | 45 | 10 | 6 | +39 |
| `3adeea76` | medicare | Find care providers → Nursing homes → 96817 → pick "Honolulu, HI 96817" → **Escape to close the suggestion overlay** → Search → distance 25 miles → report | 50 | 8 | 6 | +44 |
| `3dca7cbe` | zara | menu → HOME → Rugs → FILTERS → click the visible "BEIGE" text/swatch (not the hidden checkbox) → VIEW RESULTS → confirm chip | 33 | 5 | 7 | +26 |
| `415bf9da` | akc | use the site's own nav to the vet finder → 75228 + 50 miles → report nearest; if no such tool, finish with an honest refusal | 24 | 9 | 6 | +18 |
| **total** | | | **576** | **140** | **110** | **+466** |

Across all 64 agent-failures: 2,143 actual steps vs 495 reviewer-ideal (**4.33×**) and 584 benchmark reference. Across the 158 successes: 2,047 vs 1,243 reference (**1.65×**). The headroom is not evenly spread — **77% of the failure steps are surplus, against 39% for successes.**

Three patterns recur in the ideal sequences and account for most of the gap: (i) the criterion belongs in a *filter*, not the query box; (ii) a dialog or panel must be scrolled *by its own index*, not by the page; (iii) when a route lacks the needed facet, switch route immediately instead of scrolling for it.

## 6. Which proposed change removes which steps

Denominator: 4,649 executed actions, 56.6M input tokens, 67,666 attributed seconds (r3).

| change | definition used | steps | % | tokens | % tok | seconds |
|---|---|---|---|---|---|---|
| **one-shot page reading** | every reading step (scroll/`get_content`/`find_text`/`scroll_to_text`/screenshot) after the first within one page visit | 624 | 13.4% | 8.68M | 15.3% | 8,711 |
| **call the site's own API** | all reading steps plus pagination clicks ("Next", "View more", page numbers) | 1,116 | 24.0% | 14.58M | 25.8% | 16,014 |
| **smaller action space** | drop `wait`, `screenshot`, `find_text`, `scroll_to_text`, `send_keys`, `switch_tab`, `close_tab`, `scroll_up/top/bottom` | 364 | 7.8% | 4.39M | 7.8% | 5,482 |
| **validate-before-act** | blocked steps whose guard is pre-checkable before dispatch (covered, no visible area, stale index, disabled, wrong element type, read-only) | 357 | 7.7% | 5.22M | 9.2% | 5,525 |
| **failed action forces a re-look** | 2nd and later failures in a consecutive run of failures | 157 | 3.4% | 2.47M | 4.4% | 3,215 |
| **per-domain workflows** | cookie/consent/region/"United States"/dismiss clicks in the first 8 steps | 96 | 2.1% | 1.16M | 2.1% | 1,479 |
| **evidence-gated finish** | steps executed after a `done` claim | **0** | 0% | 0 | 0% | 0 |
| **no horizontal scroll** | scroll steps with direction left/right | **0** | 0% | 0 | 0% | 0 |

Breakdown of the action-space cut: `find_text` 74, `wait` 67, `scroll_up` 56, `send_keys` 46, `switch_tab` 36, `scroll_top` 29, `scroll_to_text` 26, `scroll_bottom` 10, `screenshot` 9, `close_tab` 5. Sub-case of the re-look rule: 94 of the 157 are the *identical* action against the *identical* index failing again.

**Overlap matrix (steps claimed by both):**

| | one-shot | validate | site API | action-space | re-look | per-domain |
|---|---|---|---|---|---|---|
| one-shot read | 624 | 16 | **624** | 154 | 10 | 0 |
| validate | 16 | 357 | 16 | 4 | **109** | 22 |
| site API | 624 | 16 | 1,116 | **204** | 10 | 0 |
| action-space | 154 | 4 | 204 | 364 | 1 | 0 |
| re-look | 10 | 109 | 10 | 1 | 157 | 3 |
| per-domain | 0 | 22 | 0 | 0 | 3 | 96 |

**Do not double-count:**
- *Site API ⊇ one-shot page reading* (624/624). Ship one-shot reading first and the API's remaining value is 492 steps of pagination and first-reads.
- *Validate-before-act ∩ forced re-look = 109 of 157.* Validation already prevents most repeat failures; the re-look rule's independent value is only 46 steps.
- *Action-space ∩ site API = 204* (the scroll variants and `find_text` are reading steps).
- *Per-domain workflows is almost disjoint* (0 overlap with reading, 22 with validation) — small but clean.

**Marginal, applied in the ranked order:**

| order | change | +steps | +tokens | +seconds |
|---|---|---|---|---|
| 1 | one-shot page reading | 624 | 8.68M | 8,711 |
| 2 | validate-before-act | 341 | 4.92M | 5,264 |
| 3 | call the site's own API | 492 | 5.90M | 7,303 |
| 4 | smaller action space | 160 | 1.58M | 2,578 |
| 5 | failed action forces a re-look | 46 | 0.53M | 1,140 |
| 6 | per-domain workflows | 74 | 0.88M | 1,145 |
| | **union** | **1,737 (37.4%)** | **22.49M (39.8%)** | **26,141 s (7.3 h)** |

Where the savings land, by outcome group (steps): one-shot reading 415 in agent-failures vs 161 in successes; site API 691 vs 351; validate 199 vs 142; re-look 94 vs 48. **Two-thirds of the reclaimable steps sit inside the 64 tasks that failed** — these changes buy success rate, not just cost, since 44 of those 64 died on the token cap that these same steps consume. Per-domain workflows is the exception (63 of 96 in successes): it buys latency, not outcomes.

Two changes that remove nothing but are not therefore worthless:

- **No horizontal scroll** — zero horizontal scrolls exist in r1, r2-base, r2-cand or r3 (`grep -o '"direction":"[a-z]*"'` returns only down/up/top/bottom). Either it is already gone or it was never used. Removing the affordance costs nothing and is a free simplification of the action space; claim 0 steps for it.
- **Evidence-gated finish** — `done` is terminal in all 289 tasks (0 steps ever follow it), so a gate cannot remove steps; it will *add* one verification step per completed task (~158 steps, ~1.6M tokens). Its payoff is answer quality: in the 248 reviewed tasks, 52 answers were wrong or only partially correct, and the reviews repeatedly name the same cause — finishing from an autocomplete dropdown, a search snippet, or a list that had not rendered (`0059adc6`, `78baf9db`, `b4aa7315`). Price it as +1 step per task against 52 bad answers in 248, not as step savings.

**Sequencing recommendation.** One-shot page reading and validate-before-act together take 965 steps (20.8%) and 13.6M tokens (24%) with almost no overlap, and they hit the two largest first-divergence classes (missing perception, planner error) rather than just trimming cost. Site API is the biggest single number but it is mostly the same steps plus a per-domain integration cost; schedule it third. Re-look and per-domain workflows are cheap follow-ons. Horizontal scroll can be deleted today for free, and the evidence gate should be justified on correctness, never on steps.

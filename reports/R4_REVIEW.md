# Run r4, read end to end — what the agent did, where it failed, what it is worth fixing

**Run:** `mind2web-r4-2953c78`, 300 Online-Mind2Web tasks, Gemini 2.5 Flash on Vertex, builds
`2953c78` → `88fff5b` → `56d39e8` → `9669d1b` (three fixes landed mid-run; every result records
which build ran it). **Judged 54.4%** (124 of 228 scored) by eight reading judges on the same
rubric as r3's 52.3%.

**Method.** Every scored trace was read individually — 235 tasks across four readers, each writing
what the agent did, where it lost the task, what it wasted and what the shortest route would have
been (`reports/parts/r4-read-1..4.md`). Four aggregate analyses ran alongside: every failure
classified at its first divergence (`r4-failures.md`), a paired statistical comparison with r3
(`r4-vs-r3.md`), a wall-clock and token audit (`r4-waste.md`), and a pricing of every missing
capability in points of score (`r4-scope.md`).

---

## 1. The score did not really move

Paired on the 217 tasks scored in both rounds: **52.5% → 55.3%, 26 up and 20 down, McNemar
p = 0.46.** By level, all confidence intervals overlap by about 11 points. The honest statement is
that r4 is not measurably better at succeeding than r3.

Worse, **25 of the 46 flips are tasks where both rounds finished `task.ok`** — the difference was
answer quality or judge variance, not capability.

## 2. What did move, and is statistically real

| Measure | r3 | r4 | |
| --- | ---: | ---: | --- |
| Died at the token cap | 47 | **16** | p ≤ 0.003 |
| Died at the step cap | 6 | **21** | p ≤ 0.003 |
| Total budget exhaustion | 24.4% | **17.5%** | |
| Scroll actions that did not pass | 7.9% | **0.8%** | "locked behind a dialog" 58 → 2 |
| Failed actions per 100 | 14.8 | **12.0** | p = 0.0003 |
| "index no longer available" | 14 | **0** | |
| Back-to-back identical actions | 11.1% | **8.7%** | p = 0.0002 |
| Click pass rate (fix cohort only) | 92.7% | **95.2%** | "did not visibly change" 6.4% → 4.3% |

The failure mode moved rather than disappearing: tasks that used to run out of tokens now run out
of steps. That is progress on budget discipline, not on finishing.

**A correction to an earlier claim of mine.** Provider time per successful task fell 38%, and I
attributed it to the new pacer. The per-build split shows it is **Vertex weather, not our code** —
r4's first build was *worse* than its own r3 baseline. The pacer's effect is unproven.

## 3. Three regressions we introduced

- **`extract`'s schema argument.** Rejected 27 times across 13 tasks; **7 runs died outright.** The
  model invents `selector`/`attribute`/`pattern` keys and single quotes, gets rejected, and retries
  the same thing. Two runs even downgraded the provider's tool payload.
- **The new repeat guard froze 11 tasks** into a stall instead of redirecting them.
- **Intent-check refusals hit 38 tasks, against 8 in r3.**

## 4. Where the agent actually fails

All 111 non-blocked failures, each read end to end and assigned one class at its first divergence:

| First divergence | Tasks | Median steps | Median tokens |
| --- | ---: | ---: | ---: |
| Wrong target — criterion typed into search, autocomplete uncommitted, wrong band ticked | 26 | 24 | 297k |
| Planner error — dead route re-tried, premature "none exist" | 21 | 33 | 374k |
| Missing perception — control listed but zero-area, or absent | 14 | 37 | 658k |
| Action sent but had no effect | 13 | 50 | 563k |
| Site behaviour | 10 | 6 | 90k |
| Wrong route | 10 | 37 | 587k |
| Our own guard refused a legal action | 9 | 27 | 438k |
| Answer wrong or unbacked | 5 | 21 | 316k |
| Tool contract (`extract` schema) | 2 | 18 | 288k |
| Budget, genuinely | 1 | 50 | 434k |

**Raising the caps buys almost nothing.** Of the 39 tasks that ended at a limit, the judges' reasoning
shows only 11 were still on track; 28 had lost the task far earlier. Exactly one failure is a real
budget problem.

**Validation says `passed` when nothing happened.** `input_text: passed` while the slider stayed at
3 TB; `fill_form: passed` after UPS silently resolved two US ZIP codes to Chile; a radius select
that never opened. Our verdict proves the event was dispatched, not that it took effect.

**31.6% of the agent's own `done` verdicts are wrong** (54 of 171) — unchanged from r3.

## 5. Where the effort goes

**Half the run is provider throttle.** Of 20.3 hours: successful model calls 35.4%, paced waits
24.7%, rate-limit backoff 20.3%, failed calls 4.1%, page reads 7.7%, action dispatch 2.3%. 31% of
9,281 model attempts failed, almost all 429. **Every one of the 20 slowest steps in the run is
throttle** — not one slow page, read or action.

**41% of actions bought nothing** (2,068 of ~5,000): 1,682 exact repeats, 796 steps on an unchanged
page, 363 guard refusals, 123 `unknown` verdicts, 82 dead scrolls, 88 re-plans that restated the
goal. The single biggest signature is bare `scroll {"direction":"down"}` — **701 uses, 546 of them
exact repeats**, across 109 tasks, up to 17 in one.

**40 tasks that hit a limit consumed 37% of the run's tokens and produced one success.**

**796 consecutive action pairs (16.7%) were on the same URL with a byte-identical element list** —
provably batchable, worth 8.22M tokens and about 2 hours. 58% of them follow a read-only action.

**The planner's prompt cache is dead: 1.5% cached against the navigator's 37%**, because a volatile
progress block sits in front of the stable prefix. Worth ~11.8M tokens.

## 6. What it is worth fixing, in points of score

Every failure priced by the one capability the judge says would have converted it (denominator 228,
one task = 0.44 points):

| Capability | Tasks | Points | In the plan? |
| --- | ---: | ---: | --- |
| Apply a requirement through the site's own filter/sort, and keep it applied | 26 | **11.4** | partly (2.5, 2.6, 3.6) |
| Click a covered, hidden or inert target | 15 | 6.6 | partly (1.5, 2.1, 2.7 consent only) |
| Find the right page instead of circling | 14 | 6.1 | only dead-route memory |
| Operate custom selects, sliders, carousels, canvas | 10 | 4.4 | partly, gated |
| Don't claim absence or refuse prematurely | 6 | 2.6 | partly (3.4) |
| Verify the answer | 5 | 2.2 | **Stream 6, deferred** |
| Survive `extract`, read a rendered list | 5 | 2.2 | no |
| Our own guards | 5 | 2.2 | partly (2.3, 2.9) |
| Commit an autocomplete choice | 4 | 1.8 | yes (2.3, 1.7) |
| Press apply/submit, do the terminal action | 3 | 1.3 | no |

**The answer layer is the largest single block: 24 tasks, 10.5 points**, where the work was done but
the answer was wrong, partial or unbacked — a name instead of a code, a release date read as an
availability date, a record named that was absent from the filtered grid, a total existing only in
the agent's own notes. Nine of those (3.9 points) a page-reading verifier converts alone.

**Ceiling.** 6 failures are unwinnable and 6 are geo-degraded; 92 of 104 are ours. Hard ceiling
about 94%; realistic with Waves 1–2 plus the verifier, **70–75%**.

## 7. Gaps the plan does not cover

1. **Proposing a new route** from the site's own navigation, not just remembering dead ones (3.5 pts).
2. **Filter persistence** — re-check applied requirements each step, and treat a filter dialog's
   Apply button as part of applying (1.8 pts).
3. **Sliders, carousels, canvas, contenteditable** (2.6 pts) — and **plan item 4.1 deletes
   `drag_element`, the only tool that reaches two of these classes.** Correct before Wave 2.
4. **`extract`'s schema contract** — sanitise the argument, cap at two attempts, fall back to
   `read_page` (1.3 pts plus 7 dead runs).
5. **Non-consent overlays** — 2.7 bundles a consent rule set only (~2.2 pts).
6. **Same-host navigation refused by our own firewall** (0.9 pts).

## 8. Efficiency work, ranked by measured cost

1. **Worker concurrency and quota pacing** — 10.1 hours of the run, no accuracy risk.
2. **Abort a task that is looping** — the 40 budget-burning tasks spent 37% of all tokens for one success.
3. **Let read-only actions continue in the same turn; skip the page read when the fingerprint is unchanged** — 8.2M tokens.
4. **Widen the repeat guard to two-action cycles** — it fired 17 times against 1,682 repeats.
5. **Fix the planner cache ordering** — 11.8M tokens.
6. **A guard refusal should force a re-plan**, not a retry — 3.8M tokens.
7. **Targeted scrolling; never a second scroll after "height did not change"** — 5.6M tokens.

Trimming the element list is deliberately last: everything above removes round trips, not evidence.

## 9. What must not be broken

- **Site-native filters and sorts for superlatives** — the main driver of judged success.
- **`select_dropdown_option` and `fill_form` landed first try every time they were used.** The loops
  happen exactly where the agent clicks instead. Batched `fill_form` gave the fastest runs in the set.
- **The action-failure messages** name the covering dialog *and its dismiss buttons*, list the real
  options, and offer near-match elements. One task self-corrected in a single step because of it.
- **`assert` before `done`** caught fabricated citations; the planner's completion refusal caught an
  answer claiming 67,150 results where the page showed 1,029.
- **Honest empty-result reporting** — several were judged success.
- **Every safety guard** fired proportionately: commit confirmation, invented-data, challenge
  detection, off-site URL, leave-applied.

## 10. Measurement integrity

- **The browser geolocates to India.** Nine tasks were served Pune listings, rupee prices, IGN India,
  and a US ZIP that resolved to Chile. Language and timezone are pinned; the exit IP is not. This is
  the largest non-agent distortion in the score.
- 64 tasks blocked by the site, 1 site-down, excluded as in r3. Ten further failures are bot checks
  or blank renders the harness did not label `site_blocked`.
- The token cap counts uncached input; all 18 cap deaths sit at 500–512k fresh tokens.
- Failures span 80 distinct sites, at most 7 on any one — no single-site artefact.
- Screenshots followed the active tab rather than the agent's tab; fixed after the run (`d7d8c43`).

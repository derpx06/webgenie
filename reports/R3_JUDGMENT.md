# Run r3, judged — 52.3% on 222 scored tasks

**Run:** `mind2web-r3-3fdf2fa` (Online-Mind2Web, 300 slots, build `3fdf2fa`, Gemini 2.5 Flash on
Vertex AI, harness `51cabe5`, limits 50 steps / 40 min / 500k input tokens).
**Judge:** reading judges — eight subagents that read each task's `result.json`, `timeline.txt`,
`trace.jsonl` and trajectory screenshots against `e2e/mind2web/JUDGING.md`. No model API was used
for judging, and no screenshot was scored without being looked at. Per-task verdicts are in
`<task>/judgment-claude.json` with key points, reasoning and cited evidence; the roll-up is
`judgments.json`. Verdicts: 171 high confidence, 63 medium, 0 low.

## Score

| Slice | n | success | rate | 95% CI |
| --- | ---: | ---: | ---: | --- |
| **overall** | 222 | 116 | **0.523** | 0.457 – 0.587 |
| easy | 66 | 47 | 0.712 | 0.594 – 0.807 |
| medium | 99 | 46 | 0.465 | 0.370 – 0.562 |
| hard | 57 | 23 | 0.404 | 0.286 – 0.533 |

**Measurement integrity.** 234 tasks were judged, 222 scored. Excluded from the rate, as
`judge.mjs` excludes them: 66 `site_blocked` (bot checks, "access denied", country blocks), 5
`site_down`, 5 `provider_down`. 12 tasks the judges marked blocked are among the excluded. The
browser ran from this network with `E2E_LANG=en-US`, `E2E_TZ=America/New_York`; tasks served an
Indian edition of a US site are a known residual bias. One excluded task (`82eb3bfe`,
coinmarketcap) was classified `site_blocked` although the site never connected at all — it is
site-down in substance.

## Where the score is lost

| Run outcome | judged success | judged failure |
| --- | ---: | ---: |
| `task.ok` (the agent believed it finished) | 111 | **53** |
| `limit_tokens` | 4 | 45 |
| `limit_steps` | 1 | 6 |
| `task.fail` | 0 | 14 |

Two facts follow.

1. **A third of the agent's own "done" verdicts are wrong.** 53 of 164 finished runs failed the
   rubric. This is the answer-and-verification class, and it is the largest single block of lost
   score.
2. **Budget deaths are nearly all failures.** 51 of 56 runs that hit a limit failed. Failures take
   a median of 358 s and 26 steps against 154 s and 10 steps for successes — 2.3× the time and 2.6×
   the steps.

## What the judges saw, in their own tallies

Recurring causes, named repeatedly across all eight shards:

- **Filters and sorts never applied, or applied wrongly.** A superlative answered by reading a few
  results instead of using the site's sort; a range filter set too broad or too narrow (Airbnb's
  price set as a trip total, Google Shopping's price range mangled, "at least 8 days" filtered as
  "10+"); filters lost by re-searching.
- **Loops until the budget dies.** Clicking an element reported "covered by …" or one whose click
  "did not visibly change the page", repeatedly: 6 of 11 failures in one shard, 5 of 10 in another,
  one run clicking the same index eleven times.
- **Controls that could not be clicked at all** — "no visible area" on filter chips, an unclickable
  sort, an In&Out filter, a date range never set.
- **Answers not backed by the page.** A phone number that appears nowhere in any page state; a row
  number reported as a count; an availability-release date reported as the next available date; a
  price that contradicts the sorted first result. And the mirror image: three runs that *did* the
  task and then reported failure.
- **A required second action skipped** — the item found but never added, the message never sent,
  the story never opened, "View More" never expanded.

Each of these is a Wave 1 or gated item in `reports/PLAN.md`: filter evidence and criterion
placement (2.5, 2.6, 3.6), validate-before-dispatch and loop detection (2.1, 2.2), covered/clipped
marks and scroll containers (1.4, 1.5), the budget with pivot points (3.9), and — for the 53
wrongly-finished runs — the deferred Stream 6 verifier.

## Comparison

The 60-task gate set scored 55% on build `6347e1c`. This is a different, larger and harder set
(300 slots against 60), judged by reading judges rather than `judge.mjs`, so the two numbers are
not comparable and `compare.mjs` refuses to compare across judges. 52.3% ± 6.5 is the number to
beat with the same judge and the same set.

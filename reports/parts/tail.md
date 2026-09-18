
---

## 8. Prioritized change list — the build plan

Ordered by impact ÷ effort. "Impact" is measured where the number is measured and marked
as an estimate otherwise. Every item names what proves it worked.

### Tier 1 — large, cheap, already evidenced

| # | Change | Impact | Effort | Proof |
| --- | --- | --- | --- | --- |
| 1 | **Budget counts fresh input, not cache re-reads** | frees 13 of 60 tasks (22%) that died inside budget; those tasks burned 45% of the round's tokens | done (`77bfd8b`) | `limit_tokens` count on the next gate round |
| 2 | **Suppress a byte-identical page state**: send `[page unchanged since step N]` instead of re-serializing the element list | −43,649 tok/task (−17.7%), measured repeat factor 1.45 | S | token/task on the gate set |
| 3 | **Trim the element line** (href 60 chars, drop implied `role`, shorten `offscreen`) | −19,684 tok/task (−8.0%) | S | same |
| 4 | **Prompt and schema rewrite** — planner 2,458→1,399 tok (−43%), navigator 2,419→1,839 (−24%), tool block 3,448→2,747, no evidenced rule deleted | −1.75M tok/run (−11.8%) | S | same, plus no success regression |
| 5 | **Explicit cache for the planner prefix** (its cache-read rate is 1.6% against the navigator's 98%) | −12,685 tok/task billed-equivalent | S | `cacheReadTokens` per role |
| 6 | **Move `[TODAY]` and the task-start stamp out of the volatile tail** into the system message | unlocks item 5 | XS | prefix byte-stability test |
| 7 | **Drop `about:blank` and the agent's own side-panel URL from the tab list** | −4,664 tok/task | XS | same |
| 8 | **Suppress the hedged duplicate above ~10k input tokens** | −13,107 tok/task (+5.3% invisible to current accounting) | XS | hedge count in traces |

### Tier 2 — the failure modes that actually lose tasks

Ranked by the taxonomy's cost, in wasted steps and dollars across 247 reviewed tasks.

| # | Change | Failure it kills | Cost today |
| --- | --- | --- | --- |
| 9 | **`read_page`** — main-content extraction, section outline, cursor, internal pagination | scroll thrash; "read the page 9 times"; page-text under-use | 710 wasted steps, $3.27 |
| 10 | **Consent/modal handling as a first-class step** — detect the dialog, act on it, never let it swallow the run | consent-modal deadlock | 344 steps, $1.58 |
| 11 | **Visited-set + dead-end memory in the blackboard**, surviving compaction | action loops; dead-end backtracking with no memory | 442 steps, $2.03 |
| 12 | **Pointer targeting for custom controls** (`pointerTarget` gap: "no visible area" on a combobox clicked 38 times) | uninteractable custom controls — 4 of 27 failures, highest task mortality | ~1.43M tok, $0.55 |
| 13 | **Stable refs + never quote an index the model was not shown** (the guard currently refuses the very index the agent's own error message named) | stale/out-of-window refs | 135 steps, $0.62 |
| 14 | **`assert(claim, evidence)` before any success** | untrue answers — 6 of 27 failures | 51 steps, $0.23, and the credibility of every score |
| 15 | **Commit criteria through the site's own controls** (filter/sort, autocomplete selection) | criteria typed but never applied | 219 steps, $1.00 |
| 16 | **Intent check must not refuse a literal substring of the user's own task** | seven refusals to `maxFailures` on one task | 168 steps, $0.77 |

### Tier 3 — harness and measurement integrity

| # | Change | Why |
| --- | --- | --- |
| 17 | Detect `site_blocked` mid-task, not only at the end | 8,074 s spent on already-blocked sites |
| 18 | Guard every `Page.bringToFront` and dropped-frame AX read | 2 terminal harness errors, ~14,000 dropped-frame reads |
| 19 | Mid-task resume after a provider pause | 32% of r1 attempts thrown away |
| 20 | One shared rate limiter across workers; stop running 5 shards into one quota | 43.5% of r1 machine time, 47.6% of calls 429 |
| 21 | Run budget, exit trap, and a `summary.json` that covers the whole selection | r1's summary held one row |
| 22 | Record the served region per task; the Indian egress turns four r2-cand tasks into Indian sites | harness cost charged to the agent's score |

### What the measurements say *not* to do

Screenshots are 0.35% of input (868 tok/task) — leave them alone. `get_complete_page_content`
is 0.5% — the problem is what it returns, not what it costs. Re-asks and schema rejections
are zero in all four runs. Action batching is not the win it looks like: the model already
emits 1.04 actions per call against a limit of 5, so the ceiling is not what constrains it.

### Order of work

Tier 1 lands first and is measured on one gate round (it is mostly deletion, and it clears
the token budget that is currently ending a fifth of all tasks). Tier 2 is the Phase B
tool layer plus the Phase D blackboard, gated the same way. Tier 3 runs alongside, since
it changes only the harness and cannot regress the agent.

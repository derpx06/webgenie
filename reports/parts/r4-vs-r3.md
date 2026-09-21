# r4 (`2953c78`+) vs r3 (`3fdf2fa`) — what actually changed, measured from the traces

Rounds: `chrome-extension/e2e/results/mind2web-r3-3fdf2fa` and `.../mind2web-r4-2953c78`,
300 Online-Mind2Web tasks each, same task file (`sha256 7dedf38…`), same model
(`gemini-2.5-flash` for planner and navigator), same limits (50 steps / 2 400 s / 500 k input tokens),
same reading judge. Read-only analysis; nothing in the run directories was modified.

**Headline: the agent got materially cheaper to run against the provider and changed its whole
read/extract tool set; it did not measurably get better at the benchmark.** Judged success moved
52.3 % → 54.4 % (+2.1 pp), which on this sample is noise (paired McNemar 26 up / 20 down, p = 0.46).

---

## 0. How this was computed

Three sources per task folder: `result.json` (outcome, steps, seconds, `metrics`, `provider`),
`timeline.txt` (actions with arguments, validation verdicts, REPLAN triggers, `act.fail` events),
`judgment-claude.json` / the round's `judgments.json`.

Scored set = the round's judged tasks **minus** the `site_blocked` / `site_down` exclusions listed in
`judgments.json → summary.excluded`. That reproduces the published headline exactly
(r3 116/222 = 52.3 %, r4 124/228 = 54.4 %). Paired set = scored in both rounds = **217 tasks**.
(The 28/22 flip counts in the brief come from the larger judged-in-both intersection of 227, which
still contains 10 tasks the round excluded as `site_blocked`; on the exclusion-consistent 217 the
flips are 26 up / 20 down. Section 6 uses the 217-task set, whose flips are a strict subset.)

Timeline grammar used by the parser:

```
+  <t>s step=<n> action <name> {args} (<ms>)        -> an executed action
+  <t>s step=<n>   validated <name>: <verdict> — <message>
+  <t>s step=<n> ERROR <Agent>: [Action] [i/n] <name> FAILED / args : … / error: …
+  <t>s step=<n> REPLAN trigger=<trigger> reason=…
[event t=<t>s] act.fail <full message>             -> canonical failure/refusal stream
```

A failed action does **not** produce an `action` line, so the unit for §5 is
*attempted step* = executed action + blocked attempt (an `act.fail` whose message is not one of the
validation messages). That unit reconciles with `result.json.steps`: r3 4 195 attempts vs 4 137
recorded steps, r4 4 587 vs 4 550.

Representative commands (the full analysis ran as seven python scripts over the same loader):

```bash
cd /home/manas/Documents/webSurfer/chrome-extension/e2e/results

# headline + exclusions
python3 -c "import json;j=json.load(open('mind2web-r3-3fdf2fa/judgments.json'));print(j['summary'])"

# outcome mix
for r in mind2web-r3-3fdf2fa mind2web-r4-2953c78; do
  jq -r .outcome $r/*/result.json | sort | uniq -c | sort -rn; done

# builds inside r4
jq -r '.build // "null/2953c78"' mind2web-r4-2953c78/*/result.json | sort | uniq -c

# validation verdict corpus
grep -h "validated" mind2web-r4-2953c78/*/timeline.txt \
  | sed 's/.*validated \([a-z_]*\): /\1 /' | cut -c1-80 | sort | uniq -c | sort -rn

# action-failure corpus
grep -h "act.fail" mind2web-r3-3fdf2fa/*/timeline.txt | cut -c1-70 | sort | uniq -c | sort -rn
```

**r4's builds** (`result.json.build`), oldest → newest, and the caveat that runs the whole build
analysis: the builds are confounded with task difficulty, because the later builds picked up the
tasks that earlier passes had left. `9669d1b` ran 41 of the 61 `hard` tasks; the first build got 32
of the 66 `easy` ones. So every per-build number below is paired against **r3's result on exactly
those same tasks**, never against the round average.

| build (r4) | n scored | easy/med/hard | r4 success | r3 success, same tasks |
|---|---|---|---|---|
| `null`/`2953c78` | 80 | 32/33/15 | 62.5 % | 62.0 % |
| `88fff5b` | 13 | 3/8/2 | 46.2 % | 75.0 % |
| `29756bb` | 5 | 2/3/0 | 100 % | 60.0 % |
| `56d39e8` | 21 | 10/8/3 | 76.2 % | 65.0 % |
| `9669d1b` | 109 | 19/49/41 | 43.1 % | 39.6 % |
| all | 228 | 66/101/61 | 54.4 % | 52.5 % |

No build cohort is large enough to carry a success claim on its own (the widest, `9669d1b`,
n = 109, moves 39.6 % → 43.1 %, CI [34.2, 52.5]).

---

## 1. Outcome mix, judged success, success by difficulty

### 1a Outcome mix

All 300 attempts:

| outcome | r3 | r4 |
|---|---|---|
| `task.ok` | 164 | 178 |
| `site_blocked` | 56 | 64 |
| `limit_tokens` | 49 | 18 |
| `task.fail` | 14 | 16 |
| `limit_steps` | 7 | 22 |
| `provider_down` | 5 | 0 |
| `site_down` | 4 | 1 |
| `task.pause` | 0 | 1 |

Scored sets only (the exclusions removed):

| outcome | r3 (n=222) | r4 (n=228) |
|---|---|---|
| `task.ok` | 155 (69.8 %) | 171 (75.0 %) |
| `limit_tokens` | 47 (21.2 %) | 18 (7.9 %) |
| `limit_steps` | 7 (3.2 %) | 22 (9.6 %) |
| `task.fail` | 13 (5.9 %) | 16 (7.0 %) |
| `task.pause` | 0 | 1 (0.4 %) |

Paired (n = 217), with exact McNemar on each class:

| outcome | r3 | r4 | gained | lost | p |
|---|---|---|---|---|---|
| `limit_tokens` | 47 | 16 | 8 | 39 | **0.00001** |
| `limit_steps` | 6 | 21 | 19 | 4 | **0.0026** |
| `task.ok` | 151 | 163 | 32 | 20 | 0.13 |
| `task.fail` | 13 | 16 | 13 | 10 | 0.68 |

**The clearest real change in the whole comparison: the dominant failure mode moved from running
out of tokens to running out of steps.** Token exhaustion fell by two thirds; step exhaustion
tripled. Neither is a win by itself — an exhausted run is judged a failure either way
(`limit_tokens` scored 4/47 in r3 and 0/18 in r4; `limit_steps` 1/7 and 1/22) — but the total
budget-exhaustion rate did fall, 24.4 % → 17.5 %.

Success rate conditional on outcome class:

| outcome | r3 success | r4 success |
|---|---|---|
| `task.ok` | 111/155 (71.6 %) | 117/171 (68.4 %) |
| `task.fail` | 0/13 | 6/16 |
| `limit_tokens` | 4/47 | 0/18 |
| `limit_steps` | 1/7 | 1/22 |

r4 reaches "the agent produced an answer" more often (75 % vs 70 %) but the answers it produces are
judged right slightly less often (68.4 % vs 71.6 %) — the two effects cancel.

### 1b Judged success by difficulty

Full scored sets (Wilson 95 %):

| level | r3 | r4 |
|---|---|---|
| easy | 47/66 = 71.2 % [59.4, 80.7] | 49/66 = 74.2 % [62.6, 83.3] |
| medium | 46/99 = 46.5 % [37.0, 56.2] | 47/101 = 46.5 % [37.1, 56.2] |
| hard | 23/57 = 40.4 % [28.6, 53.3] | 28/61 = 45.9 % [34.0, 58.3] |
| **all** | **116/222 = 52.3 % [45.7, 58.7]** | **124/228 = 54.4 % [47.9, 60.7]** |

Paired set (n = 217, identical tasks):

| level | r3 | r4 |
|---|---|---|
| easy | 46/65 = 70.8 % | 49/65 = 75.4 % |
| medium | 46/97 = 47.4 % | 45/97 = 46.4 % |
| hard | 22/55 = 40.0 % | 26/55 = 47.3 % |
| **all** | **114/217 = 52.5 %** | **120/217 = 55.3 %** |

Paired McNemar: 26 up, 20 down, net +6, χ²(cc) = 0.54, exact binomial **p = 0.46**.
**Within noise.** The confidence intervals overlap by ~11 pp at every level; the hard-level +7.3 pp
rests on 4 net tasks. To call a +2.8 pp difference at ~53 % real with 80 % power you would need
roughly 5 000 paired tasks, or a discordant-pair count several times larger than the 46 observed.

---

## 2. Cost of a run: steps, calls, tokens, money, wall clock, provider time

"Provider time" = `metrics.backoffMs + metrics.failedCallMs` (rate-limit backoff plus the wall time
burned inside calls that failed).

### 2a Medians, full scored sets

| metric | r3 (222) | r4 (228) |
|---|---|---|
| steps | 15.0 | 16.5 |
| wall clock s | 239.4 | 239.0 |
| LLM calls | 20.0 | 22.5 |
| planner calls | 4.0 | 5.0 |
| navigator calls | 15.0 | 17.5 |
| input tokens | 192 138 | 200 613 |
| output tokens | 3 828 | 5 444 |
| cached tokens | 69 898 | 64 998 |
| reasoning tokens | 2 902 | 4 336 |
| cost USD | 0.0581 | 0.0689 |
| backoff ms | 60 800 | 18 100 |
| failed-call ms | 19 234 | 4 315 |
| **provider ms** | **90 806** | **24 642** |
| rate-limit events | 19.5 | 10.0 |
| provider calls | 29 | 32 |
| provider calls failed | 10.5 | 5.0 |

### 2b Medians, paired n=217, with paired sign tests

| metric | r3 | r4 | median Δ | r4>r3 / r4<r3 | sign-test p |
|---|---|---|---|---|---|
| steps | 15.0 | 16.0 | +0 | 102 / 88 | 0.35 |
| wall clock s | 234.2 | 235.3 | −9.0 | 103 / 113 | 0.54 |
| LLM calls | 20.0 | 21.0 | +0 | 107 / 90 | 0.25 |
| input tokens | 191 240 | 197 583 | +537 | 109 / 108 | 1.00 |
| output tokens | 3 611 | 5 262 | +430 | 123 / 94 | 0.057 |
| cost USD | 0.0581 | 0.0689 | +0.003 | 127 / 90 | **0.014** |
| **provider ms** | **87 431** | **24 684** | **−36 152** | 74 / 141 | **<0.0001** |
| act.fail events | — | — | 0 | 74 / 74 | 1.00 |
| rate-limit events | 18 | 10 | −4 | 94 / 117 | 0.13 |
| cached tokens | 68 281 | 62 724 | — | — | — |

Per-step token pressure barely moved (median input/step 13 380 → 13 024; input/call 9 804 → 9 542),
but output per call rose 186 → 221 and the cached share of input fell 36.0 % → 28.6 %.

### 2c Medians on the 94 tasks that succeeded in **both** rounds

| metric | r3 | r4 |
|---|---|---|
| steps | 9.0 | 10.0 |
| wall clock s | 142.9 | 143.3 |
| LLM calls | 12.0 | 13.0 |
| input tokens | 125 339 | 129 681 |
| output tokens | 2 392 | 2 641 |
| provider ms | 58 935 | 22 468 |

### 2d Totals per successful task (sum over the scored set ÷ successes)

| metric | r3 | r4 | Δ |
|---|---|---|---|
| steps | 36.8 | 39.2 | +6.6 % |
| wall clock s | 571.8 | 569.0 | −0.5 % |
| LLM calls | 48.3 | 51.1 | +5.7 % |
| planner calls | 9.6 | 10.7 | +10.8 % |
| navigator calls | 38.7 | 40.4 | +4.4 % |
| input tokens | 489 514 | 531 405 | +8.6 % |
| output tokens | 10 204 | 13 519 | **+32.5 %** |
| cached tokens | 178 975 | 166 885 | −6.8 % |
| reasoning tokens | 8 197 | 10 887 | **+32.8 %** |
| cost USD | 0.1509 | 0.1765 | **+17.0 %** |
| backoff ms | 162 395 | 115 249 | −29.0 % |
| failed-call ms | 66 242 | 23 397 | **−64.7 %** |
| **provider ms** | **228 636** | **138 646** | **−39.4 %** |
| rate-limit events | 47.6 | 43.0 | −9.7 % |

(Paired-set version of the same table: cost/success 0.1509 → 0.1765 (+17.0 %),
provider ms/success 224 359 → 139 221 (−37.9 %), output tokens/success +30.6 %.)

**A success costs 17 % more in money and a third more in output/reasoning tokens than it did in r3,
while costing 38 % less in provider-side stalling.** Wall clock per success is flat because the
provider-time saving is spent on more model work.

### 2e Per build (r4) vs r3 on the same tasks — medians

| cohort | n | steps | seconds | LLM calls | input tokens | provider ms |
|---|---|---|---|---|---|---|
| `null/2953c78` r3 | 79 | 12.0 | 167.7 | 16.0 | 158 399 | 70 001 |
| `null/2953c78` r4 | 79 | 14.0 | 339.4 | 18.5 | 170 352 | 117 495 |
| `88fff5b` r3 | 12 | 18.5 | 299.4 | 26.5 | 243 185 | 123 488 |
| `88fff5b` r4 | 12 | 17.0 | 172.0 | 25.0 | 193 908 | 8 736 |
| `29756bb` r3 | 5 | 9.0 | 159.3 | 11.0 | 137 546 | 91 194 |
| `29756bb` r4 | 5 | 10.0 | 125.0 | 13.0 | 176 741 | 15 444 |
| `56d39e8` r3 | 20 | 9.0 | 141.4 | 13.0 | 116 704 | 55 540 |
| `56d39e8` r4 | 20 | 11.0 | 106.0 | 15.0 | 179 685 | 2 384 |
| `9669d1b` r3 | 101 | 19.0 | 318.3 | 26.0 | 233 719 | 107 568 |
| `9669d1b` r4 | 101 | 21.0 | 218.0 | 30.0 | 296 636 | 10 408 |

The provider-time collapse is *not* a code change: the first r4 build (117 s median) was slower on
the provider than its own r3 baseline, and every later r4 build ran at 2–15 s. That is the Vertex
rate-limit weather (r3's `europe-west1`/`us-east1` runs were rate-limited on 19.5 calls per task
median; the later r4 passes on 10). **Treat the −39 % provider time as an environment difference,
not an agent improvement.**

---

## 3. Action mix and exact-repeat rate

Exact repeat = an executed action whose `(name, argument JSON)` pair already occurred earlier in the
same task. Paired set: r3 3 811 executed actions, r4 4 194.

| action | r3 n | r3 % | r3 repeat % | r4 n | r4 % | r4 repeat % |
|---|---|---|---|---|---|---|
| `click_element` | 1797 | 47.2 | 28.2 | 1853 | 44.2 | 29.8 |
| `scroll` | 760 | 19.9 | 74.2 | 744 | 17.7 | 71.4 |
| `input_text` | 422 | 11.1 | 18.2 | 339 | 8.1 | 21.5 |
| `go_back` | 202 | 5.3 | 74.3 | 191 | 4.6 | 68.1 |
| `find_in_page` | — | — | — | 223 | 5.3 | 26.5 |
| `read_page` | — | — | — | 188 | 4.5 | 34.0 |
| `extract` | — | — | — | 182 | 4.3 | 19.8 |
| `get_complete_page_content` | 173 | 4.5 | 23.7 | — | — | — |
| `done` | 107 | 2.8 | 0.9 | 88 | 2.1 | 3.4 |
| `save_findings` | 86 | 2.3 | 2.3 | 68 | 1.6 | 1.5 |
| `select_dropdown_option` | 49 | 1.3 | 8.2 | 57 | 1.4 | 7.0 |
| `wait` | 57 | 1.5 | 19.3 | — | — | — |
| `assert` | — | — | — | 43 | 1.0 | 0.0 |
| `switch_tab` | 34 | 0.9 | 50.0 | 40 | 1.0 | 55.0 |
| `send_keys` | 39 | 1.0 | 33.3 | 29 | 0.7 | 24.1 |
| `wait_for` | — | — | — | 37 | 0.9 | 16.2 |
| `go_to_url` | 24 | 0.6 | 12.5 | 51 | 1.2 | 31.4 |
| `scroll_to_text` | 29 | 0.8 | 20.7 | — | — | — |
| `view_screenshot` | 8 | 0.2 | 25.0 | 21 | 0.5 | 23.8 |
| `fill_form` | — | — | — | 18 | 0.4 | 0.0 |
| `ask_human` | 16 | 0.4 | 0.0 | 15 | 0.4 | 0.0 |
| `todo_list` | — | — | — | 4 | 0.1 | 25.0 |
| `handle_dialog` | 4 | 0.1 | 50.0 | 3 | 0.1 | 33.3 |
| `close_tab` | 4 | 0.1 | 0.0 | — | — | — |
| **total** | **3811** | 100 | **36.7** | **4194** | 100 | **36.1** |

**The tool set is the single biggest structural difference between the rounds.** r3's single
page-reading tool `get_complete_page_content` (173 uses) was replaced by four narrower ones —
`read_page` (188), `find_in_page` (223), `extract` (182), `assert` (43) — plus `wait_for`,
`fill_form` and `todo_list`, while `wait`, `scroll_to_text` and `close_tab` disappeared. Page
reading roughly quadrupled in call count (173 → 636) while becoming much cheaper per call, which is
exactly the mechanism behind the `limit_tokens` → `limit_steps` shift in §1.

Overall exact-repeat rate is unchanged (36.7 % vs 36.1 %, z = −0.61, p = 0.54); most of it is
legitimate paging (`scroll {"direction":"down"}` repeated down a long list) and `go_back`.
The tighter signal — **back-to-back identical actions** — did drop:

| | r3 | r4 |
|---|---|---|
| back-to-back identical | 424/3811 = **11.1 %** | 364/4194 = **8.7 %** (z = −3.67, p = 0.0002) |
| of which `scroll` | 249 | 229 |
| of which `click_element` | **129** | **86** |
| of which `go_back` | 27 | 17 |

Immediate click repeats fell by a third. That matches the new "you have already done exactly this 3
times on this page" / "this exact action just failed" refusals (§4), which exist only in r4.

Per-build repeat rate (r4 cohort vs r3 on the same tasks): `null` 35.3→33.8, `88fff5b` 42.1→41.5,
`29756bb` 32.0→20.0, `56d39e8` 26.0→20.1, `9669d1b` 38.3→39.4. No build stands out.

---

## 4. Validation verdicts

### 4a Overall (paired)

| | r3 | r4 |
|---|---|---|
| total verdicts | 3 811 | 4 181 |
| `passed` | 3 150 | 3 192 |
| `unknown` | 176 | 108 |
| `failed` | 9 | 42 |
| `not_applicable` | 476 | 839 |
| passed / gated | **94.5 %** | **95.5 %** |
| unknown / gated | 5.3 % | 3.2 % |
| failed / gated | 0.3 % | 1.3 % |

`not_applicable` nearly doubled because the new read/extract/assert tools are ungated.

### 4b Per action type (percentages over *gated* verdicts; n is all verdicts)

| action | r3 n | pass | unkn | fail | r4 n | pass | unkn | fail |
|---|---|---|---|---|---|---|---|---|
| `click_element` | 1797 | 94.3 | 5.7 | 0.0 | 1846 | 95.2 | 4.8 | 0.0 |
| `scroll` | 760 | 92.1 | 7.9 | 0.0 | 744 | **99.2** | 0.7 | 0.1 |
| `input_text` | 422 | 97.9 | 2.1 | 0.0 | 339 | 98.8 | 1.2 | 0.0 |
| `go_back` | 202 | 97.5 | 0.0 | 2.5 | 185 | 99.5 | 0.0 | 0.5 |
| `select_dropdown_option` | 49 | 91.8 | 0.0 | 8.2 | 57 | 82.5 | 0.0 | 17.5 |
| `send_keys` | 39 | 89.7 | 10.3 | 0.0 | 29 | 72.4 | 27.6 | 0.0 |
| `go_to_url` | 24 | 100 | 0 | 0 | 51 | 100 | 0 | 0 |
| `switch_tab` | 34 | 100 | 0 | 0 | 40 | 100 | 0 | 0 |
| `fill_form` | — | | | | 18 | 88.9 | 11.1 | 0.0 |
| `extract` | — | | | | 182 | 156 n/a + **26 failed** | | |
| `assert` | — | | | | 43 | 39 n/a + 4 failed | | |
| `find_in_page` / `read_page` / `wait_for` / `todo_list` | — | | | | 223/188/37/4 | all `not_applicable` | | |
| `get_complete_page_content` / `wait` / `scroll_to_text` | 173/57/29 | all `not_applicable` | | | — | | | |

### 4c The messages that dominate

Validation messages on non-passing verdicts (paired):

| message class | r3 | r4 |
|---|---|---|
| "…was sent, but the page did not visibly change" | 87 | 79 |
| "The page did not scroll: it may be locked behind an open dialog…" | **58** | **2** |
| "The link points to X, but the page stayed…" | 10 | 14 |
| "The field now shows «…»; check whether that is acceptable" | 9 | 6 |
| "the same address with the same content" | 6 | 4 |
| "only changed the address fragment" | 4 | 0 |
| "Navigation produced no observable URL or document change" | 5 | 1 |
| "Option … not found. Available options:" | 2 | 6 |
| `extract` schema rejected (new in r4) | 0 | **27** |

Action-failure (`act.fail`) messages, paired, with rate per 100 executed actions:

| class | r3 | r4 | /100 acts r3 → r4 |
|---|---|---|---|
| "The element is covered by …" (overlay/dialog) | 134 | 114 | 3.52 → 2.72 |
| "The element has no visible area…" | 72 | 92 | 1.89 → 2.19 |
| "Node is detached from document" | 30 | 24 | 0.79 → 0.57 |
| stale index: "index N is not on the current page" | 23 | 17 | 0.60 → 0.41 |
| "Element with index N is no longer available" | 14 | **0** | 0.37 → 0.00 |
| "overlay or interstitial" | 10 | 15 | 0.26 → 0.36 |
| "does not accept text; type into an input…" | 10 | 9 | 0.26 → 0.21 |
| "History entry to navigate to not found" | 9 | 8 | 0.24 → 0.19 |
| "The element is disabled" | 6 | 6 | 0.16 → 0.14 |
| "typing timed out" | 4 | 0 | 0.10 → 0.00 |
| "The field is read-only" | 2 | 2 | 0.05 → 0.05 |
| "The element is still moving (an animation…)" | 0 | 2 | 0.00 → 0.05 |
| **all `act.fail`** | **565** | **505** | **14.83 → 12.04** (z = −3.66, p = 0.0003) |

New refusal/guard classes that exist only (or almost only) in r4:

| guard | r3 events / tasks | r4 events / tasks | r4 success on those tasks |
|---|---|---|---|
| intent check "Not done: …" | 29 / 8 | 49 / **38** | 10/38 |
| URL intent block "Not opened: …" | 0 / 0 | 19 / 3 | 2/3 |
| repeat guard "already done exactly this 3 times" | 1 / 1 | 15 / 11 | 4/11 |
| "this exact action just failed" | 0 / 0 | — / 20 | 5/20 |
| "'done' ignored — never in the same turn as other actions" | 1 / 1 | 12 / 12 | **10/12** |
| `extract` schema rejected | 0 / 0 | 27 / **13** | 4/13 (7 of the 13 ended `task.fail`) |

### 4d Click and scroll validation per build (r4 cohort vs r3 on the same tasks)

| cohort | clicks | click pass % | "did not visibly change" % of gated clicks | single-page-route messages % | scroll non-pass % |
|---|---|---|---|---|---|
| `null/2953c78` r3 | 547 | 96.5 | 2.6 | 0.9 | 5.8 |
| `null/2953c78` r4 | 594 | 96.8 | 2.5 | 0.7 | **0.0** |
| `88fff5b` r3 | 133 | 91.7 | 4.5 | 3.8 | 35.7 |
| `88fff5b` r4 | 157 | 86.6 | 7.6 | 5.7 | **0.0** |
| `29756bb` r3 | 43 | 93.0 | 4.7 | 2.3 | 50.0 |
| `29756bb` r4 | 30 | 93.3 | 6.7 | 0.0 | **0.0** |
| `56d39e8` r3 | 146 | 98.6 | 1.4 | 0.0 | 12.5 |
| `56d39e8` r4 | 126 | 98.4 | 1.6 | 0.0 | **0.0** |
| `9669d1b` r3 | 928 | 92.7 | 6.4 | 1.0 | 6.7 |
| `9669d1b` r4 | 946 | **95.2** | **4.3** | 0.5 | 1.4 |
| all r3 | 1797 | 94.3 | 4.6 | 1.1 | 7.9 |
| all r4 | 1853 | 95.2 | 3.8 | 1.0 | **0.8** |

Two build-attributable readings:

* **Scroll validation is fixed in every r4 build** (7.9 % → 0.8 % non-passing, z = −6.7,
  p < 1e-10; the "page did not scroll: locked behind an open dialog" message goes 58 → 2). This is
  not one of the three late fixes — it is already present in the `2953c78` build.
* **The click fix in `9669d1b`** (pressed-button bitmask) shows up exactly where it should: in that
  cohort click pass rose 92.7 % → 95.2 % and "did not visibly change" fell 6.4 % → 4.3 %, the
  largest click improvement of any cohort, against the cohort's own r3 baseline. Its
  single-page-route rate also halved (1.0 % → 0.5 %) and covered-by failures fell 83 → 54. The
  tab-following part is not visible in the aggregates: `switch_tab` use is flat (15 → 13) and
  `go_back` share unchanged (5.6 % → 5.7 %) in that cohort.
* `88fff5b` and `29756bb` (n = 12 and 5 paired tasks) are too small to read at all.

---

## 5. Waste as a share of attempted steps

Disjoint buckets, assigned in priority order per attempt:

1. **blocked / refused** — the attempt raised an error or was refused by a guard (no `action` line).
2. **redundant repeat (same args)** — an executed action whose `(name, args)` already occurred, for
   a non-paging tool.
3. **repeat: paging / back** — same, for `scroll` / `go_back` / `switch_tab` (usually legitimate).
4. **corrective** — a recovery action (`go_back`, `scroll`, `handle_dialog`, `wait*`, `switch_tab`,
   `view_screenshot`) immediately after an ineffective step.
5. **dead-end** — executed, validated `unknown`/`failed`, nothing visibly happened.
6. **productive** — everything else.

| bucket | r3 n | r3 % | r4 n | r4 % |
|---|---|---|---|---|
| blocked / refused | 384 | 9.2 | 393 | 8.6 |
| redundant repeat (same args) | 668 | 15.9 | 829 | 18.1 |
| repeat: paging / back | 731 | 17.4 | 683 | 14.9 |
| corrective | 16 | 0.4 | 11 | 0.2 |
| dead-end (no visible effect) | 79 | 1.9 | 92 | 2.0 |
| **productive** | **2317** | **55.2** | **2579** | **56.2** |
| total attempts | 4195 | 100 | 4587 | 100 |
| **waste incl. paging repeats** | 1878 | **44.8** | 2008 | **43.8** |
| **waste excl. paging repeats** | 1147 | **27.3** | 1325 | **28.9** |

Neither total moves outside noise (incl. paging z = −0.93, p = 0.35; excl. paging z = +1.61,
p = 0.11 — and both z's overstate significance, since attempts cluster inside tasks).

By outcome, the split is stable and stark in both rounds:

| | attempts | waste incl. paging | waste excl. paging |
|---|---|---|---|
| r3 successes (114) | 1522 | 31.8 % | 22.7 % |
| r3 failures (103) | 2673 | 52.2 % | 30.0 % |
| r4 successes (120) | 1726 | 31.5 % | 22.5 % |
| r4 failures (97) | 2861 | 51.2 % | 32.7 % |

By build (waste excl. paging, r4 cohort vs r3 on the same tasks): `null` 23.4 → 25.3,
`88fff5b` 31.8 → 42.0, `29756bb` 26.3 → 23.5, `56d39e8` 30.8 → 26.3, `9669d1b` 28.6 → 29.9.
No build-attributable change.

---

## 6. The tasks that flipped

On the exclusion-consistent paired set: **26 flipped to success, 20 flipped to failure** (the 28/22
in the brief includes 2 + 2 tasks that their round excluded as `site_blocked`).

The most important structural fact about both groups: **25 of the 46 flips are tasks where both
rounds ended `task.ok`** — 14 of the 26 ups and 11 of the 20 downs. Those flips are not a change in
what the agent could reach; they are a change in *which answer it produced*, judged by a reading
judge that itself has variance. Only 12 ups and 9 downs correspond to a change in outcome class.

### 6a Flipped to success (n=26)

| task | level | r4 build | r3 outcome | r4 outcome | steps r3→r4 | blocked r3→r4 |
|---|---|---|---|---|---|---|
| `0170ca95…` | hard | null | task.ok | task.ok | 6→18 | 0→1 |
| `0632e496…` | easy | 9669d1b | limit_tokens | task.ok | 31→23 | 4→1 |
| `0a0fa834…` | medium | 9669d1b | task.ok | task.ok | 13→9 | 2→0 |
| `11abb668…` | medium | 29756bb | limit_tokens | task.ok | 44→23 | 0→0 |
| `1b867afe…` | hard | 9669d1b | task.ok | task.ok | 10→9 | 1→1 |
| `239a29bd…` | medium | null | limit_tokens | task.ok | 40→9 | 0→0 |
| `246d654f…` | easy | 9669d1b | task.ok | task.ok | 14→6 | 0→0 |
| `29b7372d…` | easy | 29756bb | task.ok | task.ok | 5→5 | 0→1 |
| `354b4ddf…` | medium | null | task.ok | task.ok | 5→9 | 0→1 |
| `627f7a18…` | easy | 56d39e8 | task.ok | task.ok | 6→10 | 0→1 |
| `644a856c…` | medium | null | limit_tokens | task.ok | 27→13 | 0→0 |
| `8689af4d…` | medium | 9669d1b | limit_tokens | task.ok | 31→31 | 14→7 |
| `9af05e39…` | hard | 56d39e8 | task.ok | task.ok | 23→23 | 2→0 |
| `9c04b71b…` | medium | null | limit_tokens | task.ok | 42→30 | 4→5 |
| `9c97bab9…` | medium | null | task.ok | task.ok | 10→7 | 8→0 |
| `a0a18ca6…` | hard | null | limit_tokens | task.ok | 28→28 | 0→0 |
| `a6f0434c…` | easy | 56d39e8 | task.fail | task.ok | 8→10 | 3→2 |
| `b4aa7315…` | hard | 9669d1b | limit_steps | task.ok | 50→19 | 8→4 |
| `ba01ea55…` | hard | 9669d1b | task.ok | task.ok | 15→13 | 0→0 |
| `c577a143…` | hard | 9669d1b | task.ok | task.ok | 14→30 | 0→1 |
| `cf757a77…` | hard | 9669d1b | limit_tokens | task.fail | 37→24 | 2→2 |
| `d1807551…` | medium | 9669d1b | limit_tokens | task.ok | 32→45 | 1→5 |
| `d9a86893…` | medium | 9669d1b | task.ok | task.ok | 2→4 | 0→1 |
| `da8f3823…` | medium | 9669d1b | task.ok | task.ok | 12→10 | 1→1 |
| `e43cbc8a…` | hard | 9669d1b | limit_tokens | task.ok | 32→31 | 1→1 |
| `f2097f92…` | easy | null | task.ok | task.ok | 13→12 | 3→1 |

Group aggregates: r3 outcomes `task.ok` 14 / `limit_tokens` 10 / `limit_steps` 1 / `task.fail` 1 →
r4 `task.ok` 25 / `task.fail` 1. Median steps 14.5 → 13, seconds 212 → 171, blocked attempts per
task 2.08 → 1.38. Replan mix: `step_interval` 75 → 53, `contract_complete` 9 → 18,
`completion_refused` 5 → 11.

Mechanisms the traces actually show, in order of how many tasks they carry:

1. **The token-cheap read tools replaced the whole-page dump (11 tasks).** Every `limit_tokens`
   run in this group is an r3 trace with repeated `get_complete_page_content` or long scroll walks
   at ~500 k input tokens. `239a29bd…` (healthline): r3 spent 40 steps cycling
   `scroll/G/go_back` over the same three articles, 504 k tokens, "Task cancelled"; r4 did
   `click, input_text, click, go_back, click, scroll×3, find_in_page` in 9 steps and 113 k tokens.
   `644a856c…` (amazon): r3 looped `scroll_to_text → click → go_back` four times to 509 k tokens;
   r4 reached the product and added it to the cart in 13 steps. Across the paired set, r3's 85
   `get_complete_page_content` tasks had a median 354 k input tokens vs 156 k for the rest.
2. **The personal-data intent check stopped rejecting data the user supplied (2 tasks, 8→0 and
   1→0 refusals).** `9c97bab9…` (michaels order tracking): r3 was refused eight times with
   "Not done: the user's request does not ask to enter 12345@gmail.com on www.michaels.com" —
   for an email the user's own task string contains — and ended with the form two-thirds filled;
   r4 filled all three fields with one `fill_form` and finished in 7 steps. `9af05e39…` (BBB quote)
   is the same story with "Not typed: «test@example.com» appears nowhere in the user's messages".
3. **`select_dropdown_option` / `fill_form` used on the site's own controls instead of clicking
   around them (5 tasks).** `627f7a18…` (nba.com): r3 clicked a column header twice on a Playoffs
   per-game table and reported a row number (154) as a block count; r4 set PER MODE = Totals and
   STAT CATEGORY = BLK through the selects and read the right leader. `246d654f…`
   (recreation.gov): r3 sorted the wrong campground and answered "there are no 5-star reviews";
   r4 set "Sort by: Most Helpful" in the select and clicked the 5-star bar, 6 steps.
   `0a0fa834…` (carnival) picked the correct duration bucket in r4 where r3 picked 10+ days.
4. **The no-visible-area failure loop got interrupted (1 large task).** `8689af4d…` (apple
   refurbished): r3 burned 13 identical "element has no visible area" failures to the token limit;
   r4 hit 6, then the new "Not done: this exact action just failed" refusal fired, the agent
   changed approach (`find_in_page`, `go_to_url`) and completed in the same 31 steps.
5. **Scroll no longer stalls behind dialogs (visible in `29b7372d…`, `0632e496…`)** — r3's
   "The page did not scroll: it may be locked behind an open dialog" (58 occurrences round-wide,
   2 in r4) is what kept the Google Finance news item off-screen in r3's failed run.
6. One task (`cf757a77…`) counts as a flip to success while ending `task.fail` — the judge accepted
   partial evidence; that is judge behaviour, not agent behaviour.

### 6b Flipped to failure (n=20)

| task | level | r4 build | r3 outcome | r4 outcome | steps r3→r4 | blocked r3→r4 |
|---|---|---|---|---|---|---|
| `0059adc6…` | medium | 88fff5b | task.ok | task.fail | 15→15 | 3→4 |
| `005be9dd…` | easy | null | task.ok | limit_tokens | 13→50 | 2→4 |
| `07bdc595…` | medium | 88fff5b | task.ok | limit_steps | 24→50 | 4→5 |
| `323bd85e…` | medium | null | task.ok | task.fail | 5→18 | 1→2 |
| `330cd04c…` | medium | null | task.ok | task.ok | 8→23 | 1→1 |
| `3ef64f34…` | hard | 9669d1b | task.ok | task.ok | 19→11 | 0→2 |
| `608c595e…` | medium | null | task.ok | limit_steps | 32→50 | 7→9 |
| `60cbbbd5…` | medium | 56d39e8 | task.ok | task.ok | 8→2 | 1→1 |
| `6b2cfae0…` | medium | 9669d1b | task.ok | limit_tokens | 9→28 | 1→2 |
| `9b5dfe54…` | medium | 9669d1b | task.ok | task.ok | 18→10 | 2→0 |
| `9d09bc94…` | medium | 88fff5b | task.ok | task.ok | 10→5 | 0→0 |
| `9ef1a897…` | easy | null | task.ok | limit_tokens | 26→37 | 2→4 |
| `a96fca87…` | easy | 9669d1b | task.ok | task.ok | 10→9 | 2→1 |
| `b962927d…` | medium | 9669d1b | task.ok | task.ok | 12→30 | 1→7 |
| `b99c0296…` | medium | 9669d1b | limit_tokens | limit_steps | 34→50 | 0→1 |
| `bfa2de15…` | hard | null | task.ok | task.ok | 15→45 | 0→1 |
| `c39d6c24…` | hard | 9669d1b | task.ok | limit_steps | 26→50 | 0→1 |
| `c6c9dc60…` | hard | 9669d1b | task.ok | task.ok | 28→21 | 6→1 |
| `e7301bb6…` | medium | null | task.ok | task.ok | 29→30 | 2→0 |
| `f158345f…` | hard | 9669d1b | task.ok | task.ok | 22→24 | 1→2 |

Group aggregates: r3 outcomes `task.ok` 19 / `limit_tokens` 1 → r4 `task.ok` 11 / `limit_steps` 4 /
`limit_tokens` 3 / `task.fail` 2. Median steps 16.5 → 26, seconds 199 → 358, **median input tokens
189 k → 409 k**. Replan mix: `step_interval` 45 → 74, `completion_refused` 3 → **12**,
`progress_stall` 0 → 2, `human_needed` 0 → 2.

Mechanisms:

1. **`extract` schema errors kill runs (2 tasks here, 13 paired tasks, 7 of them `task.fail`).**
   `0059adc6…` (walmart careers) reached the right results page in r4, then issued three malformed
   schemas — "schema is not valid JSON (Bad escaped character at position 115…)" — and died on
   `MaxFailuresReachedError`, emitting the stub answer "I found the following support services jobs
   in Bentonville, Arkansas:" with no job named. This is a pure regression: the tool is new and its
   argument is rejected 27 times across the paired set, with 0 equivalents in r3.
2. **The new read tools invite exploratory loops that burn the step or token budget (7 tasks).**
   `005be9dd…` (qatarairways, an *easy* task r3 solved in 13 steps): r4 ran 50 steps of
   `find_in_page / read_page / switch_tab` around Help pages and never opened the baggage page —
   672 k tokens. `6b2cfae0…` (nba): r4 spent steps 12–26 running `find_in_page "Devin Booker"` on a
   league-wide leaderboard, 644 k tokens, no answer, where r3 had opened his player page and set
   Season Type = Playoffs in 9 steps. `c39d6c24…` (leagueoflegends) burned 50 steps alternating
   `save_findings`/`click` down a skins carousel that r3 walked in 26 clicks.
3. **The anti-repeat guards can freeze a run instead of redirecting it (3 tasks).**
   `323bd85e…` (amtrak, r3 solved in 5 steps): r4 read the right identification page, then the
   "you have already done exactly this 3 times on this page and nothing on it changed" refusal
   fired twice, two `progress_stall` replans followed, and the task ended `task.fail` on a planner
   timeout. Round-wide the guard fires on 11 paired tasks of which only 4 succeed.
4. **Refusals now end tasks the agent used to attempt (2 tasks).** `60cbbbd5…` (BBB scam lookup):
   r4's only action was `go_to_url` to google.com, refused by the URL intent check ("nothing in the
   user's request leads to https://www.google.com"), after which it called `done(success=false)`
   claiming web search was unavailable — 2 steps, 14 k tokens, on a site whose own Scam Tracker r3
   had used successfully. The refusal itself is correct; giving up instead of re-planning is not.
   Intent-check refusals reach 38 paired tasks in r4 vs 8 in r3.
5. **Answer-quality regressions with no mechanical failure (the 11 `task.ok`→`task.ok` downs).**
   `b962927d…` (bandcamp) cleared the `vinyl` facet it had already applied before answering;
   `c6c9dc60…` (ikea) applied 2 of 4 facets and answered anyway; `e7301bb6…` (jcpenney) applied two
   of the three price bands under $20; `a96fca87…` (mega.io) typed 50 into a transfer box whose
   slider stayed at 3 TB. These are filter-state/verification failures, exactly the class that has
   no gate today — validation confirms the click landed, not that the requested constraint is in
   the page's filter state.

---

## 7. What is real and what is noise

**Real (large relative to the sample, and mechanically explained by the traces):**

* The **tool set changed** — `get_complete_page_content`/`wait`/`scroll_to_text` out,
  `read_page`/`find_in_page`/`extract`/`assert`/`wait_for`/`fill_form`/`todo_list` in. Structural,
  not statistical.
* **`limit_tokens` 47 → 16 and `limit_steps` 6 → 21 on the same 217 tasks** (exact p = 1e-5 and
  0.0026). The failure mode moved; total budget exhaustion fell 24.4 % → 17.5 %.
* **Scroll validation is fixed**: non-passing scroll verdicts 7.9 % → 0.8 %, "page did not scroll"
  58 → 2 (p < 1e-10), in every r4 build.
* **Action failures per action fell 14.8 → 12.0 per 100** (p = 0.0003), driven by covered-by
  (3.52 → 2.72) and by "index no longer available" going to zero.
* **Back-to-back identical actions 11.1 % → 8.7 %** (p = 0.0002), with immediate click repeats down
  a third — consistent with the new repeat guards.
* **New failure sources that did not exist in r3**: `extract` schema rejection (27 events, 13 tasks,
  7 of them `task.fail`) and the repeat/stall guards freezing 11 tasks (4 successes).
* **Provider time −39 % per success** (paired p < 1e-4) — real in the data but **attributable to
  Vertex rate-limit conditions, not to the agent**: the first r4 build was *worse* than its own r3
  baseline (117 s vs 70 s median) and the later builds ran at 2–15 s.
* **Cost per successful task +17 %**, output and reasoning tokens per success +31/+33 %
  (paired cost sign-test p = 0.014). r4 thinks more per step.

**Within noise at n = 217 / n = 228:**

* **Judged success, overall and at every level.** +2.1 pp on the full sets, +2.8 pp paired,
  26 up / 20 down, p = 0.46. The hard-level +7.3 pp is 4 net tasks. Nothing here supports a claim
  that r4 is a better agent on this benchmark.
* Steps (p = 0.35), wall clock (p = 0.54), LLM calls (p = 0.25), input tokens (p = 1.00) per task.
* **Waste share**, on either definition (43.8 % vs 44.8 % incl. paging; 28.9 % vs 27.3 % excl.) —
  and both directions of that pair disagree, which is itself a sign of noise.
* Overall exact-repeat rate (36.1 % vs 36.7 %, p = 0.54) and click pass rate (95.2 % vs 94.3 %,
  p = 0.19).
* **Every per-build success rate.** The cohorts are confounded with difficulty and, apart from
  `9669d1b` (n = 109), too small to read; the only build-attributable *mechanical* signal is the
  click fix in `9669d1b` (click pass 92.7 → 95.2, "did not visibly change" 6.4 → 4.3 % against that
  cohort's own r3 baseline).

**Caveats.** Action-level z-tests above treat attempts as independent although they cluster inside
tasks, so their p-values are optimistic; only differences of several σ (scroll validation, act.fail
rate, back-to-back repeats) survive a realistic design effect. Both rounds were judged by the same
reading judge, but 25 of the 46 flips happened without any change in outcome class, so an unknown
part of the ±3 pp band is judge variance rather than agent variance. Finally r4 mixed five builds,
so it is not a single-agent measurement at all: the 54.4 % is an average over five slightly
different agents.

# Live e2e harness

`chrome-extension/e2e/` drives the built extension (`dist/`) in Chromium against real sites and local fixtures, with Vertex AI models authenticated by your gcloud login. It is the only test of the whole agent; unit tests (`pnpm -F chrome-extension test`) cover the pieces.

```bash
pnpm e2e                                  # pnpm build, then turbo e2e -> node chrome-extension/e2e/run.mjs
E2E_SUITE=security pnpm -F chrome-extension e2e
E2E_ONLY=T1,C13 E2E_HEADLESS=1 pnpm -F chrome-extension e2e
E2E_ORACLE=1 E2E_SUITE=all pnpm -F chrome-extension e2e   # no browser agent, no model calls
```

`run.mjs` needs `dist/manifest.json` (build first) and Chromium (`CHROMIUM_PATH`, default `/usr/bin/chromium`).

## Options

| Variable | Default | Meaning |
| --- | --- | --- |
| `E2E_SUITE` | `core` | Suite name, or `all` |
| `E2E_ONLY` | | Comma-separated task ids; overrides the suite (a "subset run") |
| `E2E_REPEAT` | 1 | Attempts per task; extra attempts are labelled `<id>-r2`, … |
| `E2E_HEADLESS` | headed | Any value runs headless |
| `E2E_MODEL` | `gemini-2.5-flash` | Navigator model (and planner, unless the next is set) |
| `E2E_PLANNER_MODEL` | `E2E_MODEL` | Planner model |
| `E2E_PROJECT` / `E2E_LOCATION` | gcloud project / `global` | Vertex AI project and location (`global` gets fewer 429s) |
| `E2E_MAX_INPUT_TOKENS` | 4,000,000 | Whole-run input token cap; later tasks are `skipped_budget` |
| `E2E_TASK_MAX_INPUT_TOKENS` | 400,000 | Per-task cap (a task can set `maxInputTokens`) |
| `E2E_TASKS_PER_BROWSER` | 10 | Tasks before a fresh browser |
| `E2E_UPDATE_BASELINE` | | `1` rewrites `baseline.json` after a run with no regressions (a subset run merges its entries) |
| `E2E_ORACLE` | | `1` checks the checkers instead of the agent (below) |
| `E2E_PRICE_INPUT` / `_CACHED` / `_OUTPUT` | 0.3 / 0.075 / 2.5 | USD per million tokens for cost estimates |

## Suites (`tasks.mjs`)

| Suite | Ids | What it covers |
| --- | --- | --- |
| core | T1–T27 | Basic single tasks on public sites and fixtures |
| complex | C1–C36 | Multi-step tasks |
| hitl | H1–H8 | Asks when the user must decide or provide something, and never otherwise |
| security | S1–S8 | Prompt injection and money; fixture request logs show what the agent actually sent |
| breadth | B1–B8 | Other languages, keyboard-only ARIA widgets, history, long wizards, the firewall |
| endurance | L1–L4 | Long tasks and conversations; a `trend` metric shows where accuracy fell off |
| resilience | R1–R5 | Worker restart, tab closed, no answer, a new task arriving, user pause |
| memory | M1–M2 | A saved route is offered only on the same start page and stores nothing the user wrote |

Fixtures (`fixtures.mjs`) are two local HTTP servers on random ports: a cross-site editor iframe origin and a host origin with shop, checkout, message and delivery pages plus tracked `/order` and `/exfil` endpoints that checkers read.

Human-in-the-loop is scripted: on `act.ask_human` the harness sends the task's next `human[i]` answer (with `secrets` for password fields) as `human_response` if its `expect` pattern matches the question; otherwise the task is cancelled with outcome `asked_human`. `lateAnswer` answers after the task has paused itself, and `during` hooks kill the worker, close the tab, pause/resume or start a second task. Scripted answers feed the `needlessQuestions` / `missedQuestions` counts.

## Outcomes and statistics

- A task passes when its outcome is allowed (`task.outcomes`, default `ok`), its checker passes, and no secret leaked into the page or into extension storage (`secretLeaks`, `storageLeaks`).
- `site_down`: for non-fixture start pages the harness fetches the page twice (20 s timeout, 5 s apart); a network error or HTTP ≥ 500 both times marks the task `site_down`, which is left out of pass rates, health counters, the baseline and the exit code.
- `E2E_ORACLE=1` runs only tasks that define `oracle()`: each checker must fail with no action and pass after the scripted oracle actions.
- Per task (`metrics.mjs`): planner/navigator calls, re-asks, tokens (input, output, cached, reasoning), cost, rate limits, timeouts, backoff time, hedged calls, time to first action, `getState` and per-action latencies, validations, replans.
- Per suite: pass rate with a Wilson 95% interval, pass-every-attempt (pass^k), wrong `done`, needless/missed questions, median duration, backoff share, cost, latency medians, and health counters (schema rejections, not-allowed re-asks, detached debugger, empty DOM, hung tasks, harness errors, leaks, …).
- Ratchet against `baseline.json`: a task that always passed now failing, a lower suite pass rate, or any health counter rising is a regression. Latency increases over 1.25× are regressions only when both runs used `E2E_REPEAT` ≥ 2. A full run exits 1 on regressions; a subset run exits 1 unless every task passed or was `site_down`.
- Output: `e2e/results/<timestamp>/summary.json` (models, git sha, build time, health, comparison, results) and per attempt `<id>.events.jsonl`, `<id>.trace.jsonl`, `<id>.png`, plus `<id>.timeline.txt` on failure.

## Online-Mind2Web (`e2e/mind2web/`)

A reproducible slice of the Online-Mind2Web benchmark with a WebJudge-style judge; see `e2e/mind2web/README.md` for data access and attribution. Scores are indicative only (the judge is Gemini, not the paper's o4-mini).

- `make-slice.mjs --in Online_Mind2Web.json --out slice.json` — seeded, stratified sample (14 hard, 17 easy, 29 medium, one task per site).
- `run.mjs [--limit N] [--only id,id] [--level easy|medium|hard] [--self-check]` — runs the slice through the same harness (`E2E_MODEL`, `E2E_PLANNER_MODEL`, `E2E_PROJECT`, `E2E_LOCATION`, `E2E_HEADLESS`, `CHROMIUM_PATH`). Search engines are firewalled, order/payment confirmations are declined, other questions get "Proceed with any reasonable choice." Limits: 25 steps, 600 s, 150k input tokens. Writes `results/mind2web-<ts>/<task_id>/` (result, screenshots, events, trace).
- `judge.mjs <runDir> [--model gemini-2.5-pro] [--threshold 3] [--concurrency 2] [--dry-run]` — key points, per-screenshot scores, then an outcome call; writes `judgments.json` with success rate and Wilson intervals overall and per level, re-judging only missing or errored tasks.

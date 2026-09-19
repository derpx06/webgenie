# The harness plan — evidence-led and incremental, revision 2

Revision 2 (2026-09-19) folds in the second research round (`reports/research/07`–`12`) and
decision D5. Revision 1 is the approved plan of the same date; what changed is listed at the end.

## Ground rules

- **Extension only** (D1). At runtime the extension talks to the model provider and the sites it
  browses. Bundled open-source code (a public-suffix list, a consent rule set) is inside the
  extension and allowed; anything fetched from a third party at runtime is not.
- **Accuracy before tokens and speed** (D4). A saving ships only if judged success holds on the
  gate set.
- **Model- and provider-agnostic** (D5). Provider behaviour lives in `llmCapabilities.ts` and
  `helper.ts`; the loop, prompts and tools never assume one model family. Vision and coordinate
  grounding are optional capabilities over a text path that always works.
- **Task-agnostic.** No site, domain or benchmark task appears in any rule, prompt or heuristic.
- **Only risky changes are gated** (user decision). "Tests" below means unit tests that fail
  without the change, plus the measured counts it claims recomputed from the next run's traces.

## Where the agent stands (run r3, build `3fdf2fa`, Gemini on Vertex)

| Metric | Value |
| --- | --- |
| Finished (`task.ok`) | 158 of 289 |
| Died at the 500k token cap | 44 — 44 of the 64 agent failures |
| Blocked by the site | 55 (19%) |
| Median steps / tokens / seconds | 12 / 165k / 244 s |
| Steps that are waste | 44.6% |
| Provider share of wall clock | 43% (backoff 29.7%, failed calls 11.6%) |
| Judged success (60-task gate, build `6347e1c`) | 55%, up from 45% |

First divergence of the 64 agent failures: planner error 30%, missing perception 25%, wrong route
17%, wrong target 11%, our own guard 9%, site 8%.

## The central finding of round 2

**The prompts already carried the rules and the agent failed anyway.** r3's templates told the
models to switch away from failed routes, apply criteria through filters, commit autocomplete
suggestions and not answer "none exist" early (07 §0). So the fixes for the largest failure classes
are not more prompt text. They are **state the harness keeps, checks it runs, and feedback given at
the moment of the mistake** — which is also what every high-scoring shipped system does (11) and
what works for weak models as well as strong ones (07, 09).

---

## Stream 1 — Perception

| # | Change | Evidence | Ships |
| --- | --- | --- | --- |
| 1.1 | Page read as the default route to content; scroll is the exception | −624 steps, −8.68M tok in our corpus | **G1** |
| 1.2 | State block re-shaped: text merged with the controls inside it, headings as structure | AgentOccam: shape, not size | **G1** |
| 1.3 | **Native date/time inputs listed as one element** with ISO value and format; their hidden segments never indexed (08 P1) | `a6f0434c` failed in r1 and r3 on "A `<span>` does not accept text" | tests |
| 1.4 | **Scroll containers surfaced** with an index and "n screens below"; `scroll{index}` targets them (08 P2) | 73.8% of scrolls are exact repeats | tests; prompt effect in **G1** |
| 1.5 | **Clipped and covered marks on element lines**: visible box after ancestor clipping (P5), occlusion by paint order (P4), both from the one `DOMSnapshot` call we already make | HTML's gain over the AX tree came from these layout cues (08); "covered" 146 and "no visible area" 93 blocked steps | tests; prompt effect in **G1** |
| 1.6 | **Cursor style as a clickability signal**, `cursor: not-allowed` as disabled (P3) | the one signal that survives React's root event delegation | tests; list length in **G1** |
| 1.7 | **Combobox → its options** serialized right after the field, with the active option (P6) | 4 of 7 wrong-target failures were uncommitted autocompletes | tests; **G1** |
| 1.8 | Virtualized totals (`rows 1–20 of 500`, P7); visible-but-`aria-hidden` controls kept outside modals (P8) | premature absence answers | tests |
| 1.9 | **Reading non-article pages**: fall back from `main` when it holds too little; append the page's own JSON-LD product/offer/event facts (P11) | extractors score ≤ 0.68 F1 on product pages | **G1** |
| 1.10 | Test the never-run tools (`read_page`, `extract`, `notes`, `assert`, …) — does the model pick them? | shipped only in `8bd49b8` | **G1** |
| 1.11 | Viewport-first element list with `find_control` for the rest | cap relief | **G3**, after 1.2 |
| 1.12 | Stable indexes within a task (P9) | 97 stale-index refusals | **G3** (touches replay and memory) |
| 1.13 | Vision stays text-first and capability-gated; no coordinate-click tool unless the model is flagged as trained for grounding (P12) | 08, 11 | tests |

Do not switch the base observation to HTML: +11 to +17.5 points for strong models, up to −18.8 for
weak ones, 8× the tokens (08).

## Stream 2 — Guards, actions and forms

| # | Change | Evidence | Ships |
| --- | --- | --- | --- |
| 2.1 | **Validate before dispatch** (covered, invisible, stale, disabled, read-only, still moving), returning the fix and current candidates; the stale-index message says "[n] is not on the current page; the list below is current" | −341 steps; Playwright actionability; Anthropic's wording (11) | tests |
| 2.2 | **Loop detection on normalized actions** (click by role+name, navigate by host+path template, search by sorted tokens) with nudges at 5/8/12 repeats; a failed action forces a fresh look | 94 of 157 repeat-failures are the identical action (11 B2) | tests |
| 2.3 | **Autocomplete commit check**: after typing into a suggestion field, the result returns the suggestions with indexes; the field stays *uncommitted* until one is chosen or the tree shows it closed with the option text; a requirement is never `applied` by typing alone; the value is read back and a mismatch reported (12 R5, 11 B4) | the most common silent wrong-target failure | tests; the `submit` refusal in **G2** |
| 2.4 | **Toggles and dates set by value**: `desired_state` for checkboxes and switches (checking a checked box is a validated no-op); date inputs set as `yyyy-mm-dd` with input/change events (11, 12 R6) | 53 date-widget steps | tests |
| 2.5 | **Criterion-in-query note**: when a search submit carries a pending requirement's value, the result says the requirement is still pending and belongs in a filter (07 R6) | 11% wrong-target class; filters are 57.7% of Operator's failures | tests |
| 2.6 | **Filter evidence must match exactly**: a range or superlative requirement is `applied` only when the evidence names the bound or a sort control (12 R7) | Online-Mind2Web's judge rubric | tests |
| 2.7 | **Deterministic consent handling**: bundle DuckDuckGo `autoconsent` rules in the content script, opt out by default (user setting); if no rule matches but an IAB CMP reports a visible dialog, put it first in the state (12 R4). Bundled rules only — no remote rule updates (D1) | 344 wasted steps; models close banners in 4.65–17.81% of cases | tests with fixture pages; effect in **G1** |
| 2.8 | **Blocked and error pages mid-task**: challenge detection on every navigation; one reload before the model sees a network/5xx/429 error page; re-read before accepting a "blocked" answer (12 R8) | 8,074 s spent on already-blocked sites | tests |
| 2.9 | **Intent check skipped when provenance is deterministic** (value verbatim in the user's messages, on the start site or a site the task names); a second identical refusal becomes one `ask_human` (12 R2) | 4 task deaths; 17 s per refusal | tests |
| 2.10 | **Every guard verdict traced**, with a per-guard false-refusal rate computed from passing runs (12 R3) | turns "9% of failures are guards" into tunable numbers | tests |

## Stream 3 — The planner

Revision 1's 3.1–3.4 were prompt rules r3 already had; they are replaced by harness state (07).

| # | Change | Evidence | Ships |
| --- | --- | --- | --- |
| 3.1 | **Route ledger**: every route tried (host, path template, kind: site search / facet / category / URL / web search, normalized query) with its outcome, written by the harness and shown first in `[ALREADY TRIED]` (07 R1) | planner re-issues dead routes; Magentic-One ledgers | tests |
| 3.2 | **Goal repeats keyed on the route**, goal-wording similarity as fallback (07 R2) | a reworded goal on the same dead route escapes today | tests |
| 3.3 | **A progress block computed by code** for the planner: steps since last plan, new pages, findings, requirements applied, steps without progress, route kinds tried (07 R3) | weak models cannot self-assess progress | tests |
| 3.4 | **Absence needs two route kinds**: a "none exist" answer is sent back once unless two distinct route kinds ended empty or a filtered listing states zero results; then it is accepted (07 R4). Threshold is an option | inviting absence made GPT-4 call 54.9% of feasible tasks impossible | tests |
| 3.5 | **Return points**: URLs where a requirement was applied or a finding saved; backtracking is `go_to_url(return point)` plus a fingerprint check, not a chain of `go_back` (07 R7) | the one reset a live tab has | tests |
| 3.6 | **Facet check before committing to a route**: pending requirements matched against the page's filter controls; unmatched ones reported to the planner (07 R5) | wrong route 17% | matcher on tests; behaviour in **G2** |
| 3.7 | **Replan at subgoal boundaries**, *with* interval 5 → 7 (revision 1's 3.5) as one experiment (07 R9) | Plan-and-Act 29.6 → 44.2 from more replanning | **G2** |
| 3.8 | **Prune a dead route's raw steps** from the planner's history, keeping its ledger line (07 R8) | removes context, so gated per D4 | **G2** |
| 3.9 | **Visible budget with pivot points**: budget used (steps or tokens, whichever binds); at ~50% without progress switch route kind, at ~80% finish with what was found and tried or ask the user (07 R10, 11 B5). Report pass rate and partial-answer rate side by side | 44 cap deaths | **G2** |
| 3.10 | **Higher reasoning effort only on contested replans** (stall, send-back, repeated route), where the provider supports reasoning control (07 R11) | no-op on models without it | **G2** |

## Stream 4 — Tools: 47 → ~17

| # | Change | Ships |
| --- | --- | --- |
| 4.1 | Delete the unused tools (`go_forward`, `hover_element`, `right_click_element`, `drag_element` — reachable through `eval_js` if ever needed); fold `open_tab` into `go_to_url{new_tab}`, `close_tab` into `switch_tab{action}`, `scroll_to_text` into `scroll{text}`, `wait` into `wait_for`, `get_complete_page_content` into `read_page` (with `LEGACY_ACTIONS` entries) | tests |
| 4.2 | Dropdown merge, **two arms**: (a) into click, (b) into `input_text` as "set this control's value" — every shipped system treats choosing an option as setting a value (11). Both keep the "Option X not found. Available: …" reply | **G3** |
| 4.3 | `eval_js`, `sniff_api`, `fetch_json`, `download`, `read_file`, `upload_file`, `manage_*` off by default behind a capability flag chosen once at task start | tests |
| 4.4 | Tool array fixed for the whole run (cache stability, Manus) | tests |
| 4.5 | **Irreversibility tier on every tool** (`always`/`maybe`/`never`); `COMMIT_DECIDING_TOOLS` and `MUTATING_ACTIONS` derived from it; `tools.test.ts` fails on a tool without a tier (11 B3) | tests |
| 4.6 | `tools.test.ts` asserts the default tool count (flags off) stays ≤ 18 | tests |
| 4.7 | `notes` / `todo_list` / `assert` folded into the per-call `memory` field and the planner, if G1 shows they are not used | **G3** |

## Stream 5 — Site APIs — **deferred** (user decision)

## Stream 6 — Answers and verification — **deferred** (user decision)

The second round strengthened the case for one item here, so it is noted for the user's decision,
not scheduled: an external check that reads the **current page** is the most-replicated win across
shipped systems (Skyvern 68.7 → 85.9% with a validator, Surfer-H −12 points with a weaker one,
Magentic −31% without ledgers: 11), provided it is factored per question part and never shown the
agent's own claim (12 R11; judges are ~70% precise and misled by claims of completion). Research
details are in briefs 11 §B7 and 12 R9–R11. Nothing in Stream 6 is implemented until the user says
so.

## Stream 7 — Provider throughput and latency, by capability

All of it lives in `llmCapabilities.ts` (new fields: `rateLimitSignals`, `endpoints`, `hedge`,
`promptCache`, `minCacheTokens`, `reasoning`) and is read generically in `helper.ts` / `base.ts` (10).

| # | Change | Evidence | Ships |
| --- | --- | --- | --- |
| 7.1 | Honour `Retry-After` and rate-limit headers from the error object, not only message text; never retry spend-cap 429s (10 D) | OpenAI and Anthropic send them; Vertex does not | tests |
| 7.2 | Full jitter in backoff (10 E) | AWS | tests |
| 7.3 | **Hedging as a capability**: off for single-queue local servers (Ollama), otherwise at the model's observed p95 to an alternate endpoint when one exists (10 F) | today a 10 s hedge queues behind the original on Ollama | tests |
| 7.4 | **Per-model latency tracker** setting hedge point and timeout from observed p99 (10 G); replaces the fixed 25 s timeout and revision 1's 12 s guess | timeouts cost 18.2 s/task | tests |
| 7.5 | **Adaptive limiter per (provider, endpoint, model)**: AIMD on request starts, 429 as the signal, seeded from rate-limit headers where the provider sends them (10 C) | first-attempt 429 rises 0.09–0.13 → 0.29 with our own burst rate | tests; size read from **G4** |
| 7.6 | **Retry on a different endpoint** after a 429 or timeout when the capability lists more than one (10 B) | same-endpoint retries fail 71–73%; us-east1 had 162 timeouts vs 13 and 11 in EU | tests; with 7.7 |
| 7.7 | **Endpoint as a capability**, Vertex defaulting to the global endpoint, regional as a user choice for data residency (10 A) | Google's recommended fix; never tried | **G4** (cache hit rate under global routing unknown) |
| 7.8 | Page-read cap 5 s; network-idle cap 5 → 2 s; `wait` early return restored | revision 1 7.4–7.7 | tests |
| 7.9 | Skip the confirm read when a click validated on target-local evidence | an early read raises `unknown` validations | **G1** |
| 7.10 | **Reasoning budget per role**, fixed for a task, with the right control per family (`thinking_level` for Gemini 3, adaptive for new Anthropic models, effort for OpenAI) | reasoning is 80% of output tokens, and output drives latency | **G4**, planner and navigator as separate arms |
| 7.11 | Opt-in priority tier where a provider offers one, shown with its price, never on by default | +80% price on Vertex | user decision after **G4** |

Revision 1's 7.1 (−46 to −103 s) is a ceiling: most 429s are shared capacity (10).

## Stream 8 — Context and caching, by capability

| # | Change | Ships |
| --- | --- | --- |
| 8.1 | **Anthropic prompt caching**: `cache_control` on the stable prefix (today none is sent) | tests (request shape) |
| 8.2 | **OpenAI**: a stable `promptCacheKey` per task and role | tests |
| 8.3 | **Gemini planner cache — probe first**: a two-request probe of implicit caching on the planner's real prefix; build an explicit cache only if the prefix clears the provider's minimum and the probe shows implicit caching missing. Never pad a prompt to reach a minimum without a measured gain (10) | probe (≈ two model calls), then tests |
| 8.4 | Compaction on a token threshold keeping a facts summary and every dead end | tests |
| 8.5 | Old observations become one-line receipts; old screenshots dropped after N turns with a text receipt (11 B6) | tests |
| 8.6 | One navigator template variant for small local models, selected by capability (11 B8) | **portability gate** |

## Stream 9 — Memory that compounds

| # | Change | Ships |
| --- | --- | --- |
| 9.1 | **User-facing "Forget site memory"** clearing routes and playbooks through one `clearAll()` that every store registers with; outside Developer Options | tests |
| 9.2 | **Page-authored fields allow-listed** before storage: known ARIA roles and input types only; path segments charset- and length-limited; the note wrapped as untrusted data (09 M3) | tests |
| 9.3 | **Evidence-gated admission**: a playbook recorded only when the planner's `done` and the done-evidence verdict agree and nothing was sent back at the end; shown only after 2 confirmations from different runs (09 M4) | tests; effect in **G5** |
| 9.4 | **Cause-aware demotion**: only when the playbook was shown and the failure is the agent's; never on auth, billing, bad-request, rate-limit or cancel; counts instead of a 0/1 flag (09 M5) | tests |
| 9.5 | One memory note, not two (routes and playbook merged) (09 M6) | tests |
| 9.6 | Several workflows per domain, keyed structurally, induced from ≥ 2 runs sharing a step prefix, with a precondition and a check (09 M7) | **G5** |
| 9.7 | Memory stays advisory: no selector replay, no generated site APIs (09 M8) | decision |
| 9.8 | Failures stay in the task ledger; across tasks only fixed trap labels (09 M9) | tests |
| 9.9 | A capability switch to suppress cross-task notes for models where the gate shows harm (09 M10) | **G5** on one small model |

## Stream 10 — Durability and safety

| # | Change | Ships |
| --- | --- | --- |
| 10.1 | **`sameSite` on the Public Suffix List** (bundled `tldts`); a separate, looser `sameBrand` for the navigation question that **never widens where a secret may be typed** (12 R1). Fixes the github.io / vercel.app secret-placement bug and the same-brand false refusals | tests, first in Wave 1 |
| 10.2 | Event-sourced steps; idempotency keys in the tool wrapper (MV3 worker lifetime) | tests |
| 10.3 | Outbound-channel control; firewall on by default (lethal trifecta) | tests |
| 10.4 | Commit gate: non-English and icon-only submits; **the side-panel payment dialog must not focus "Yes, book it"** (uncommitted redesign worktree) | tests |
| 10.5 | Screenshots treated as untrusted input | tests |
| 10.6 | AgentDojo/WASP before and after, reporting utility and attack success | Wave 4 |

## Stream 11 — Measurement

| # | Change | Ships |
| --- | --- | --- |
| 11.1 | **Cold memory per task in e2e** (`E2E_MEMORY=cold` default: clear `wg_mem:*` before every task; `warm` seeds from a disjoint run). Today up to 10 tasks and their repeats share memory, so a memory gate would not be clean (09 M1) | tests (oracle run) |
| 11.2 | Measurement-integrity block with every score: excluded tasks, region served, harness-ended tasks, provider time lost, memory mode, provider and model | tests |
| 11.3 | pass@1 with our own judge is the headline; pass^k at k=3 on a 20-task core; never compare with self-reported leaderboard numbers (11 §5) | — |
| 11.4 | Judge calibrated against ~100 human-labelled trajectories | Wave 4 |
| 11.5 | Trace-driven improvement loop with a domain-disjoint held-out split and a lint that rejects edits naming a domain or task (09 M11) | tests for the lint |
| 11.6 | **Portability check**: a 20-task subset on a second provider for every gate that changes model-facing text (D5) | with each gate |

---

## Sequencing

**Wave 0 — know where we stand.**
- Judge run r3 (288 results) by trace reading.
- 11.1 (cold memory) and 11.2 (integrity block), so every later number is clean.
- The 8.3 cache probe (two model calls).
- **G0**: the current build on the 60-task gate set.

**Wave 1 — ships on tests, no gate.**
- Safety first: 10.1, 9.1, 9.2, 4.5, 9.4.
- Perception: 1.3, 1.4–1.8 mechanisms, 1.13.
- Guards and forms: 2.1, 2.2, 2.3 mechanism, 2.4–2.6, 2.8–2.10.
- Planner state: 3.1–3.5, 3.6 matcher.
- Tools: 4.1, 4.3, 4.4, 4.6.
- Provider: 7.1–7.6, 7.8.
- Caching: 8.1, 8.2, 8.4, 8.5.
- Memory: 9.5, 9.8.
- Durability: 10.2, 10.3, 10.5.

**Wave 2 — gated, one change family per gate, in order of expected value.**

| Gate | Contents | Arms |
| --- | --- | --- |
| **G1** Perception and reading | 1.1, 1.2, 1.4–1.7 prompt effect, 1.9, 1.10, 2.7, 7.9 | 1 |
| **G2** Planner behaviour | 3.6 behaviour, 3.7, 3.8, 3.9, 3.10, the 2.3 submit refusal | 1 |
| **G3** Tools and observation size | 4.2 (a) vs (b), 4.7, 1.11, 1.12 | 2 |
| **G4** Provider | 7.7 global endpoint, then 7.10 reasoning budgets | 2–3 |
| **G5** Memory | 9.3, 9.6, 9.9: cold vs warm, plus one small model | 2–3 |

Each gate is the same 60 tasks, judged identically, with `compare.mjs` refusing cross-judge
comparison and **revert if judged success falls** (D4). Every gate that changes model-facing text
also runs the 20-task portability subset on a second provider (11.6).

**Wave 3 — safety and publication.**
- 10.4 and 10.6.
- 11.3–11.5.
- Then the research agent, the 24 hard problems, the dashboard and the docs.

**Cost of the live work.**
- About 60 tasks × 5 h per arm, roughly 9–11 arms, so **45–55 hours of model quota**, against three runs in revision 1.
- The gates are ordered by value and each stands alone, so the work can stop after any gate.
- When to spend the quota is the user's call.

## Verification

- **Every change:** unit tests that fail without it.
- **Every wave:** the counts it claims, recomputed from the new traces with the same scripts:
  - blocked steps by guard class;
  - scroll share;
  - repeat-failure count;
  - first-divergence shares;
  - cap deaths;
  - seconds per task and provider share.
- **Every gate:** the two-sided D4 rule, and the portability subset where required.

## Housekeeping

- The four Wave 1 worktrees from the stopped run hold no work (two scratch test files); discard.
- The side-panel redesign worktree holds 21 uncommitted files; review, fix 10.4's focus bug, then
  commit or discard.
- `chrome-extension/e2e/mind2web/slice.json` stays uncommitted by design.

## Open decisions for the user

1. **Stream 6.** Whether the page-reading verifier should come out of deferral, given the
   cross-system evidence above.
2. **The second provider for portability checks.** A local Ollama model costs nothing and is the
   hardest case; OpenAI or Anthropic is closer to what most users run.
3. **When to spend the gate quota** (45–55 h).

## What changed from revision 1

- 3.1–3.4 replaced: prompt rules → harness state (route ledger, route-keyed repeats, progress block, absence rule, return points).
- 3.5 (interval 5 → 7) no longer ships on tests; gated together with a subgoal replan trigger.
- 4.2 gets a second arm ("set value"); 4.5 irreversibility tiers and 4.6 tool-count ceiling added.
- Perception gains date inputs, scroll containers, clipped/covered marks, cursor, combobox linkage, JSON-LD reading.
- Guards gain autocomplete commit, toggles by value, consent handling, blocked-page handling, deterministic provenance, per-guard precision.
- Streams 7 and 8 rebuilt around capabilities (D5); 7.1's saving restated as a ceiling; the planner cache waits on a probe; Anthropic and OpenAI caching added.
- Memory gains a user-facing clear, input allow-listing, evidence-gated admission and cause-aware demotion; e2e gets cold memory per task.
- Security gains the public-suffix fix, found and verified in this round.
- Live cost rises from three runs to 9–11 arms, because the gates are split by change family so a regression can be attributed.

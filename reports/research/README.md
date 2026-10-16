# Harness research

Two rounds of research on how the best agent harnesses are built, plus three analyses of our own
traces. Every brief cites a source, a date and the mechanism for each claim, and ends with the
sources it could not reach. The plan built from them is `reports/PLAN.md`.

## Round 1 — how harnesses are built (2026-09-19)

| Brief | Covers |
| --- | --- |
| [01 Harness design practice](01-harness-design-practice.md) | Loop architectures, tool design, context engineering, the multi-agent question, verification, budgets |
| [02 Browser agents: state of the art](02-browser-agents-sota.md) | Benchmarks and judges, AgentOccam's ablations, observation and action design, memory (AWM, SkillWeaver, ICAL) |
| [03 Evaluation and token economics](03-evaluation-and-token-economics.md) | Judge reliability, metrics beyond success rate, prompt-cache mechanics, routing, observation sizing |
| [04 Coding-agent harnesses](04-coding-agent-harnesses.md) | SWE-agent's interface ablations, lint-before-apply, bounded windows, long-horizon practice |
| [05 Runtime and platform](05-runtime-and-platform.md) | Durable execution, idempotency, MV3 worker lifetime, human-in-the-loop plumbing |
| [06 Security and safety](06-security-and-safety.md) | Indirect prompt injection, the lethal trifecta, confirmation design, incidents in shipped browsers |

## Round 1 — our own traces

| Analysis | Covers |
| --- | --- |
| [Tool census](analysis-1-tool-census.md) | Every tool's calls, failures, repeats and cost across 649 tasks; which tools overlap |
| [Step waste](analysis-2-step-waste.md) | Every step of run r3 classified; 44.6% waste; failures are 3.3× the steps of successes |
| [Latency](analysis-3-latency.md) | Where the wall clock goes; the provider is 43% of it |

## Round 2 — the gaps round 1 left (2026-09-19)

Scoped under decision D5: every recommendation must hold across models and providers.

| Brief | Covers | Attacks |
| --- | --- | --- |
| [07 Planning and search](07-planning-and-search.md) | Planner/executor splits, lookahead without resets, reflection, route choice, budgets | Planner error 30%, wrong route 17% |
| [08 Perception and grounding](08-perception-and-grounding.md) | AX tree vs HTML vs vision, grounding, hard widgets, observation shape, main-content extraction | Missing perception 25% |
| [09 Memory and self-improvement](09-memory-and-self-improvement.md) | Skill induction and admission, memory types, learning from failure, trace-driven improvement, memory poisoning | Stream 9 |
| [10 Provider throughput and latency](10-provider-throughput-and-latency.md) | Quota semantics per provider, adaptive limiting, hedging, caching by provider, reasoning control, timeouts | Provider 43% of wall clock |
| [11 Frontier agent teardowns](11-frontier-agent-teardowns.md) | Operator/Atlas, Mariner/Gemini Computer Use, Claude in Chrome, Browser Use, Stagehand, Skyvern, Magentic, Nova Act, Manus, Agent S, Surfer-H | Tool set, verification, cross-system patterns |
| [12 Task robustness and answers](12-task-robustness-and-answers.md) | Live-benchmark failure taxonomies, forms and autocomplete, consent walls, answer completeness, false refusals | Wrong target 11%, guards 9%, answer quality |

## Round 3 — the comparable projects, read from their code (2026-10-16)

| Brief | Covers | Attacks |
| --- | --- | --- |
| [14 Comparable solutions](14-comparable-solutions.md) | nanobrowser 0.3 (we are a fork of it), Browser Use, Stagehand, Skyvern, Playwright MCP, Chrome DevTools MCP, the Chrome platform (Prompt API, `chrome.automation`, WebMCP, Chrome 155 debugger policy) | Postconditions, a code-gated `done`, durable element ids and diffs, batch policy, a model-free fixture suite |

## What the research agrees on

Findings that at least two independent briefs reached from different sources:

1. **Rules the model keeps ignoring must become state the harness keeps and checks.** The r3
   prompts already had the "switch route", "use the filter" and "commit the autocomplete" rules and
   the failures happened anyway (07 §0). The fixes that work in shipped systems are ledgers,
   deterministic checks and feedback at the moment of the mistake (07, 11, 12; MAST in 07).
2. **Accessibility tree plus refs, screenshots on demand, is the portable design.** HTML helps only
   strong models at 8× the tokens (08); screenshot-first designs belong to vendors with a trained
   grounding model and do not transfer to local models (08, 11).
3. **Autocomplete and date fields need deterministic follow-through.** The commit is visible in the
   tree (12), Skyvern and Browser Use handle it in code (11), and our date failure is a perception
   bug we can see in the traces (08).
4. **Filters decide success on this benchmark.** 57.7% of Operator's Online-Mind2Web failures are
   filter or sort errors, and the judge fails runs that searched instead of filtering (07, 12).
5. **The action set is ~9-17 tools, rare tools off by default, fixed for the run** (02, 11; Manus
   on cache stability in 01 and 11). Choosing an option is *setting a value*, not a click (11).
6. **An external check that reads the current page is the most-replicated win** (Skyvern +17,
   Surfer-H +12, Magentic −31% without it: 11), but only when it is factored and never shown the
   agent's claim (02, 12). Self-critique without external feedback hurts (01, 07).
7. **Memory helps only when admission is strict.** Storing everything is worse than none (09);
   memory is a poisoning surface (06, 09).
8. **Most of our rate limiting is shared capacity, not our quota** (10), so pacing has a ceiling;
   the other levers are endpoint choice and not retrying into the same failing endpoint.
9. **Headline scores are not comparable** across judges, attempts and harnesses (02, 03, 11).
   Report pass@1 with our own calibrated judge.

## Where the briefs changed the plan

- Plan 3.1 (show the ledger to the planner) already shipped after r3 and was never measured (07).
- Plan 3.5 (planner interval 5 → 7) is reversed to a gated experiment paired with a subgoal
  replan trigger: the strongest replanning ablation says *more* replanning at the right moments (07).
- Plan 4.2 gets a second arm: merge the dropdown tool into "set value", not only into click (11).
- Plan 8.2 (explicit planner cache) waits on a two-request probe: Vertex applies its 2,048-token
  minimum to explicit caches too, and the planner also missed at 3,177 tokens (10).
- Plan 7.1's −46 to −103 s is a ceiling, not an estimate (10).

## Verified against our code

Claims the briefs made about WebGenie that were checked in the source or traces before entering
the plan:

- `sameSite()` (`validation/service.ts`) has no public-suffix list: `alice.github.io` and
  `bob.github.io` count as one site, and it gates where a `{{secret_N}}` may be typed (12).
- `RouteMemory.clear()` and `SiteSkills.clear()` are called only from tests: the user has no way to
  clear saved routes or playbooks (09; broader than the brief stated).
- Task `a6f0434c` fails with "A `<span>` does not accept text" in both r1 and r3: the model typed
  into a native date input's hidden segment (08).
- No `cache_control` is ever sent, so Anthropic users get no prompt caching (10).

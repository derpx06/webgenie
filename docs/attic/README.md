# Attic

These documents describe an earlier codebase, or proposals that were never built. They are kept because they are history,
not because they are true. **Do not read them as documentation of what WebGenie does.**

What changed underneath them: perception used to inject seven scripts into every page and build an HTML tree keyed on
`highlightIndex`; it now reads the accessibility tree of every frame over CDP and injects nothing. `ContextRouter`,
`compactHistory` and `layoutHash` do not exist. Memory stores routes only, never typed text.

- `memory_system.md` is the most misleading: it is written in the present tense about `wg_mem:episodes`,
  `wg_mem:selectors`, a "FAST PATH" and a context router, none of which was built.
- `mem0_sdk_integration_plan.md` proposes a hosted service, which the project's rule (nothing outside the extension except
  the model provider) rules out.
- `extension_delays_analysis.md`, `DOM_PIPELINE_COMPARISON_REPORT.md` and the four `codebase_walkthrough_*` files analyse code
  that has since been rewritten; their line numbers point at files that no longer look like that.
- `OOD_REFACTORING_PLAN.md` proposes a refactor of the same deleted pipeline.

For what is true now, read `CLAUDE.md`, `docs/agent.md`, and the reports in `reports/` (`PRODUCTION.md`, `PLAN.md`,
`R4_REVIEW.md`).

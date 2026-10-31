# Architecture notes

**These are design notes and proposals, and many describe code that no longer exists or was never written.** The index that
used to be here listed three files that were never in the repository and described a page-injection engine that has since
been replaced. Treat everything in this folder as a record of thinking, and check it against the source before relying on it.

## What is true now

- `CLAUDE.md` at the repository root is the current description of the architecture, commands and conventions.
- `docs/agent.md` is the long-form description of the agent loop.
- `docs/e2e.md` covers the live test harness, and `chrome-extension/e2e/` the offline gate that needs no model.
- `reports/` holds the measurements and plans: `PRODUCTION.md`, `PLAN.md`, `R4_REVIEW.md`, `TOKEN_BUDGET.md`, and the research
  briefs in `reports/research/`.

## What changed underneath these notes

Perception used to inject scripts into every page and build an HTML tree keyed on `highlightIndex`. It now reads the
accessibility tree of every frame over CDP (`Accessibility.getFullAXTree` plus one `DOMSnapshot` per frame session) and
injects nothing. Memory stores routes only, never typed text. There is no separate validator agent: verification is the code in
`chrome-extension/src/background/agent/validation/` plus the planner's completion check.

## Attic

`docs/attic/` holds the documents that are actively misleading, with a note on why. `memory_system.md` there describes a
memory system in the present tense that was never built.

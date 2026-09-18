# Decisions

Every decision that changed the shape of the work, with the reasoning and what was
rejected. Written as the work happened, newest last.

## D1 — Everything ships inside the extension; the model is the only outside dependency

**Date:** 2026-09-18
**Decision:** The product is the Chrome extension. At runtime it talks to the model
provider and to the sites it browses, and to nothing else. No server, no cloud worker, no
Python package, no telemetry collector, no third-party search or scraping API.

**Why:** The user set this constraint directly ("everything should be in the extension
only", "nothing from outside except the model"). It is also the honest shape for this
product: the agent's power comes from driving a real browser the user is already signed
into, and every external hop would move their session data off their machine.

**Rejected:**
- *A Python SDK on Playwright*, which the task spec asked for. It would re-implement
  perception, validation, safety gates, memory and prompts that three benchmark rounds
  have already shaped, and would start from a measured 0% where the current agent is at
  55%.
- *A REST/websocket control plane*. Useful for multi-tenant serving, but it is a network
  service, and the port API the extension already exposes covers programmatic driving.
- *Routing the benchmark through a US VPN or a US cloud browser* to recover the ~18% of
  tasks that geo-block this network. It is outside infrastructure, and the blocked tasks
  can be reported honestly instead.

**Consequences:** §7 of the spec is delivered as an in-extension TypeScript API plus the
existing local Node harness; §8's dashboard becomes an extension page reading the trace
store directly; research search is browser-driven rather than an API; PDF export uses
Chrome's own `Page.printToPDF`; `data_analysis` is deterministic TypeScript rather than
pandas. Recorded in the plan's interpretation table.

## D2 — The Node harness in `chrome-extension/e2e/` stays, as developer tooling

**Date:** 2026-09-18
**Decision:** Keep the puppeteer-based harness (`e2e/run.mjs`, `e2e/mind2web/*`) and keep
investing in it, but treat it as local evaluation tooling rather than part of the shipped
product.

**Why:** It is the only way to run 300 live tasks reproducibly, it already carries the
outcome classification, judging, analysis and archiving that the evaluation phase needs,
and it never runs on a user's machine in production. D1 constrains the product, not the
test bench.

**Rejected:** *Moving evaluation inside the extension.* It would make every benchmark run
depend on a human clicking, and would put benchmark-only code in the shipped bundle.

## D3 — Both agent families share one tool layer

**Date:** 2026-09-18
**Decision:** The research agent is a second loop and prompt set over the same perception
and tool layer as the browser agent, not a separate codebase.

**Why:** Research is browsing plus bookkeeping: the expensive parts (main-content reading,
typed extraction, stable refs, caching, token discipline) are exactly the same, and a
shared layer means one place to fix a bug and one place to measure a token saving. The
mode (`quick`/`standard`/`deep`) is a parameter for the same reason.

**Rejected:** *A standalone research pipeline.* Faster to write in isolation, but it would
fork the perception code and double the maintenance and the evaluation surface.

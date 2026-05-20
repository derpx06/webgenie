# WebGenie — Deep Architecture Documentation

> A complete reverse-engineered technical breakdown of how WebGenie works internally.
> Engineering-grade depth — equivalent to internal browser engine documentation.

---

## Documents

| File | What it covers |
|---|---|
| [PART1_EXECUTION_LIFECYCLE.md](./PART1_EXECUTION_LIFECYCLE.md) | Background SW kernel · Executor step loop & cancellation · Dual-agent model (Navigator + Planner) · AgentContext · MessageManager & token-budget enforcement · Error taxonomy (fatal / retriable / action-level) · ExecutionState event bus |
| [PART2_DOM_ENGINE.md](./PART2_DOM_ENGINE.md) | DOMService script injection · DOMElementNode virtual tree · `highlightIndex` system · 3-stage element location pipeline (CSS → XPath → heuristic) · SHA-256 branch-path hash change detection · Stale-index recovery · Network quiescence · Click & input primitives · Anti-detection scripts |
| [PART3_ORCHESTRATION.md](./PART3_ORCHESTRATION.md) | BrowserContext / CDP bridge · TabOrchestrator 5-component stack · TabEventBridge (single listener set) · TabRegistry persistence · ActivityEngine WorkflowStage mapping · Content script ambient UI (border / capsule / cursor) · Full action schema system · `ask_human` HITL · End-to-end `new_task` data flow trace · SW resilience model · 12 architecture invariants |

---

## Key Concepts Quick-Reference

### The Executor Step Loop
```
while (!done && step < maxSteps && !cancelled):
  1. Run Planner every N steps → get next_steps plan
  2. Snapshot DOM → build LLM state message
  3. cutMessages() → enforce token budget
  4. Run Navigator → parse action[]
  5. Execute actions (with DOM-hash stability checks between each)
  6. Check for done action → terminate or loop
```

### Element Resolution (3-Stage Pipeline)
```
index lookup in selectorMap
  → CSS selector (XPath-derived + class + stable attributes)
  → validate via computed XPath comparison
  → fallback: raw XPath via ::-p-xpath(...)
  → fallback: heuristic (stable attrs → text → role+text)
  → stale-index: SHA-256 hash remap via HistoryTreeProcessor
```

### Event Flow
```
AgentContext.emitEvent()
  → Executor subscribers → port.postMessage() → Side Panel UI
  → TabOrchestrator.onAgentEvent()
      → ActivityEngine.processEvent()
          → deriveWorkflowStage()
          → TabRegistry.update()
          → broadcastAgentStatus() → content scripts
```

### WorkflowStage → Glow Colour
| Stage | Colour | Speed |
|---|---|---|
| planning | violet | 4s |
| researching | blue | 4s |
| typing | light blue | 2s |
| clicking | cyan | 1.5s |
| comparing | teal | 3s |
| waiting | amber | 6s |
| completed | green | 8s |
| error | red | 1s |

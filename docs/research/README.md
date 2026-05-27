# WebGenie Research & Evolution Documentation

Generated: May 2026

This directory contains two research series:

---



## Key Takeaways

### Highest-Impact Changes (1 week effort → ~80% Gmail success)
1. **Popup watchdog** — 5 lines in `page.ts`, eliminates dialog-blocking agent freezes
2. **`evaluation_previous_goal` propagation** — LLM already generates this; just propagate it
3. **`memory` scratchpad propagation** — same; gives agent persistent task notes
4. **AX attribute enrichment** — add `aria-label`, `role`, `data-testid` to `buildDomTree.js`
5. **Per-step timeout** — 10 lines in `executor.ts`, converts hangs to recoverable errors

### WebGenie's Unique Strengths (preserve these)
- Multi-tab orchestration with Chrome tab groups — no reference repo has this
- Extension-native DOM via `chrome.scripting` — works even when CDP disconnects
- `chrome.tabs.get()` as authoritative URL source — prevents `about:blank` DOM blindness
- Dual-agent (Planner + Navigator) separation — industry best practice

### Reference Systems Summary
| System | Best Feature |
|---|---|
| **nanobrowser** | Extension-native DOM, closest to WebGenie's architecture |
| **browser-use** | `evaluation_previous_goal` + watchdog sidecars + AX tree DOM fusion |
| **Stagehand** | ActCache self-healing (0-cost repeat execution) |
| **WebRover** | Deep research FSM with RAG-based multi-source synthesis |

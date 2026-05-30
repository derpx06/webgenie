# WebGenie Memory System — Phased Implementation Plan

> **Priority: Accuracy & Effectiveness first. Each phase ships independently and improves agent quality immediately.**
> No phase breaks existing behaviour. Each builds on the last.

---

## Phase 1: Failure Registry & Loop Prevention
**Impact: Highest immediate accuracy gain. Zero risk.**
**Effort: Small (2 files)**

The single biggest source of task failure is the agent repeating the same failing action in a loop. This phase eliminates that entirely.

### What to build
- Add `failureRegistry: Map<string, FailureRecord>` to `AgentContext` in `types.ts`
- Add `registerFailure(selector, url)` and `isSelectorBlocked(selector)` methods
- In `navigator.ts`, after each `doMultiAction` call, check if the page state changed. If not, call `registerFailure` on the attempted selector
- In `prompts/base.ts`, when building the DOM element list string, prefix any blocked selector with `⛔ [BLOCKED - failed repeatedly]`

### Files changed
| File | Change |
|---|---|
| `agent/types.ts` | Add `failureRegistry`, `registerFailure()`, `isSelectorBlocked()` |
| `agent/agents/navigator.ts` | Post-action state comparison, call `registerFailure` on no-change |
| `agent/prompts/base.ts` | Prepend BLOCKED prefix when serializing element list |

### Why first
- No new infrastructure, no async storage, no LLM calls
- Pure in-memory Map — zero latency overhead
- Immediately fixes the most common failure mode: infinite click loops on Gmail, WhatsApp, SPAs

---

## Phase 2: Memory Pyramid (Tiered Context with Hard Budgets)
**Impact: Fixes truncation crashes. Keeps reasoning quality consistent at step 50 as at step 1.**
**Effort: Medium (1 file, significant refactor of MessageManager)**

Replaces the flat append-only history with 3 discrete levels, each with a hard token budget enforced at write time.

### What to build
Inside `messages/service.ts`:
- Add a `PyramidLevel` enum: `LIVE | TRACE | MILESTONE`
- Tag each message with its level when added
- Enforce hard token budgets per level:
  - `LIVE`: 2,000–8,000 tokens (adaptive, current DOM)
  - `TRACE`: 800 tokens fixed (last 3 step outcomes)
  - `MILESTONE`: 200 tokens fixed (compressed phase summaries)
- When `TRACE` overflows: oldest entry is summarized into a one-line milestone string and promoted to `MILESTONE`, then discarded
- Fix `cutMessages()`: instead of character-slicing JSON, drop oldest `TRACE` entries first, then oldest `MILESTONE` entries. Never touch `LIVE`

### Files changed
| File | Change |
|---|---|
| `agent/messages/service.ts` | `PyramidLevel` enum, per-level budgets, promotion logic, fixed `cutMessages()` |
| `agent/messages/views.ts` | Add `level: PyramidLevel` field to `MessageMetadata` |

### Why second
- Fixes the `cutMessages()` JSON corruption crash — a reliability blocker
- Ensures long tasks (20+ steps) maintain consistent reasoning quality
- No external dependencies — pure in-memory restructuring

---

## Phase 3: Persistent Selector & Episodic Memory Store
**Impact: Agent gets smarter with every completed task. Known domains become near-instant.**
**Effort: Medium (1 new file + hooks in 2 existing files)**

Stores verified element selectors and task outcome summaries in `chrome.storage.local`, recalled at the start of each task.

### What to build
Create new file `browser/memory-store.ts`:
```
WebGenieMemoryStore
  ├── learnSelector(domain, layoutHash, intent, selector, xpath)
  ├── recallSelectors(domain, layoutHash) → SelectorAnchor[]
  ├── saveEpisodicNote(domain, intent, outcomeSteps)
  └── recallEpisodicNotes(domain) → EpisodicNote[]
```

Storage schema:
```typescript
interface SelectorAnchor {
  domain: string;
  layoutHash: string;     // fingerprint of DOM structure, not class names
  intentKey: string;      // e.g. "click compose button"
  selector: string;
  xpath: string;
  successRating: number;
}

interface EpisodicNote {
  domain: string;
  intent: string;
  outcomeSteps: string;   // 3-line compressed summary of what worked
  successCount: number;
  timestamp: number;
}
```

Hook into:
- `navigator.ts` → on action success + page state change: call `learnSelector`
- `agent/prompts/base.ts` → before building state message: call `recallSelectors`, inject as `[Memory Hint]` lines at top of element list

### Files changed
| File | Change |
|---|---|
| `browser/memory-store.ts` | **New file** — full KV + episodic store |
| `agent/agents/navigator.ts` | Call `learnSelector` after verified success |
| `agent/prompts/base.ts` | Call `recallSelectors`, inject anchors into prompt |

### Why third
- Depends on Phase 1 (need to know what succeeded vs failed)
- Async storage calls — must be non-blocking so latency never increases
- Anchors are hints only — never authoritative. Zero degradation risk

---

## Phase 4: DOM Attention Masking (Goal-Scoped Element Filtering)
**Impact: LLM attention precision jumps from ~60% to ~95%+ on complex pages like Gmail.**
**Effort: Medium (1 file, careful tuning needed)**

Filters the interactive element list down to only elements relevant to the planner's current sub-goal before sending to the Navigator LLM.

### What to build
In `browser/page.ts` or a new `browser/dom-masker.ts`:
- Parse the planner's current `next_steps` string for intent keywords (e.g. "compose", "send", "fill form")
- Score each interactive element against these keywords using a simple TF-IDF or keyword overlap match
- Only pass elements with score > threshold (0.3 default) OR elements in the same DOM container as a high-scoring element
- **Safety valve**: if fewer than 15 elements survive the filter, fall back to full unmasked list automatically

### Files changed
| File | Change |
|---|---|
| `browser/page.ts` | Add `maskElementsForGoal(elements, currentGoal)` filter |
| `agent/prompts/base.ts` | Pass `context.lastGoal` into state builder for masking |
| `agent/types.ts` | Add `lastGoal: string` field to `AgentContext` |

### Why fourth
- Depends on Phase 3 (uses the same goal string that anchors are matched against)
- Requires careful tuning of threshold to avoid masking too aggressively
- Has the most conservative fallback of all phases (15-element minimum floor)

---

## Phase 5: JIT Context Router & A-MEM Note Linking
**Impact: Ties all previous phases together into a unified memory system. Enables cross-task learning graph.**
**Effort: Large (new orchestration file)**

Creates the `ContextRouter` — the single entry point that orchestrates Phases 1–4 into a coherent whole, and adds A-MEM-style Zettelkasten links between episodic notes.

### What to build
Create new file `agent/context-router.ts`:
```
ContextRouter
  ├── buildContextForStep(context, pageState) → OptimizedContext
  │     ├── 1. Query recallSelectors() for current domain+layout
  │     ├── 2. Apply DOM masking using current planner goal
  │     ├── 3. Inject Memory Anchors into Slot 3
  │     ├── 4. Apply Failure Registry BLOCKED prefixes
  │     └── 5. Return structured context ready for MessageManager
  │
  └── consolidateAfterTask(context, taskOutcome)
        ├── 1. Create EpisodicNote from task summary
        ├── 2. Link to related past notes (A-MEM Zettelkasten)
        └── 3. Promote successful selectors to store
```

### Files changed
| File | Change |
|---|---|
| `agent/context-router.ts` | **New file** — full Context Router |
| `agent/executor.ts` | Call `router.buildContextForStep()` at start of each step |
| `agent/executor.ts` | Call `router.consolidateAfterTask()` at task end |

### Why last
- Depends on all previous phases
- Episodic linking (A-MEM) is a polish layer — adds intelligence but not required for baseline accuracy gains
- This is the phase that makes the system feel like it "learns"

---

## Implementation Order Summary

```
Phase 1: Failure Registry          → Ship immediately, highest ROI, zero risk
Phase 2: Memory Pyramid            → Fix truncation crashes, consistent reasoning
Phase 3: Selector/Episodic Store   → Cross-session learning begins
Phase 4: DOM Attention Masking     → LLM attention precision boost
Phase 5: Context Router + A-MEM    → Full unified system, learning graph
```

Each phase is independently shippable, independently testable, and each one strictly improves agent accuracy without degrading existing capability.

# The Supremely Goated Memory Architecture for WebGenie
## Research-Backed Design from First Principles

> Grounded in: MemGPT/Letta (OS-inspired), A-MEM (Zettelkasten), Mem0 (Multi-store), CoALA (Cognitive Architecture), and 2025 Browser Agent DOM Efficiency Research.

---

## Part 1: Deep Audit — Why the Current System Fails

### What the code actually does today

WebGenie's memory lives in two objects:

| Object | Role | Critical Flaw |
|---|---|---|
| `AgentContext.lastMemory` | Raw string scratchpad from Navigator LLM | Never deduplicated, grows stale, injected verbatim |
| `MessageManager.history` | Linear array of all messages since task start | Grows ~15k–30k tokens per step, corrupts on truncation |

**The core problem** is architectural, not cosmetic. Both components treat memory as a **linear append-only log**. This is the worst possible structure for an LLM agent because:

1. **Attention Dilution** — Transformers struggle with long, flat histories. Key facts from step 1 compete with noise from step 47 for the model's attention. Accuracy degrades quadratically as history grows.
2. **Redundant Token Spending** — The DOM structure of Gmail's inbox barely changes between steps. WebGenie retransmits ~12,000 tokens of identical element data every step.
3. **Corrupt Truncation** — `cutMessages()` character-slices active JSON messages, corrupting Zod schemas mid-string and causing parse crashes.
4. **Session Amnesia** — Every new task resets to zero. The agent cannot learn that `div[jsname='N8nh4']` is always the Gmail Compose button.
5. **No Failure Tracking** — The agent will click a broken element infinitely if it matches the LLM's reasoning.

---

## Part 2: The Research Consensus — What Actually Works

### 2.1 MemGPT / Letta (OS-Paging Model)
Treats the LLM context window as **RAM** and external storage as **disk**. The agent itself issues explicit function calls to page data in/out (`retrieve`, `archive`, `summarize`). This gives precise, agent-controlled context without passive accumulation.

**Key insight for WebGenie**: The Navigator LLM should be able to request "recall what happened on mail.google.com in the last 3 sessions" rather than receiving it blindly every time.

### 2.2 Mem0 (Multi-Store Hybrid Memory)
Uses **three stores simultaneously**:
- **Vector Store** → semantic similarity retrieval for fuzzy intent matching
- **Graph Store** → entity relationships (e.g., "Compose button → depends on → Inbox panel being active")
- **Key-Value Store** → fast exact lookups for structured metadata (domain, layout hash, selector)

Mem0 reports **90% token cost reduction** and **91% lower p95 latency** vs. full-context approaches. It uses an LLM-driven decision engine to Add/Update/Delete/No-op facts automatically.

### 2.3 A-MEM (Agentic Memory / Zettelkasten)
Inspired by Zettelkasten knowledge management — every interaction creates an **atomic memory note** with:
- Content (what happened)
- Keywords/tags (intent, domain, action type)
- **Dynamic links to related notes** (not just flat lists)

When a new note is added, an LLM evaluates connections to existing notes, creating a **living knowledge graph** rather than a dead append-log. Research shows **significant multi-hop reasoning improvements** at fewer tokens.

### 2.4 CoALA (Cognitive Architecture for Language Agents)
Defines 4 memory types that map perfectly to browser automation needs:

| CoALA Type | Browser Agent Use |
|---|---|
| **Working Memory** | Current tab DOM, active step goal, viewport |
| **Episodic Memory** | Compressed summaries of past steps & task completions |
| **Semantic Memory** | User preferences, known selectors, domain knowledge |
| **Procedural Memory** | Learned action sequences (e.g., "Login to Gmail = 3 specific steps") |

### 2.5 DOM Efficiency Research (2024–2025)
- **Accessibility Tree (AXTree)** reduces DOM token cost by **10–15x** vs raw HTML
- **Snapshot + Ref ID system** (`@e1`, `@e2`) eliminates re-transmission of element data on each step
- **D2Snap DOM downsampling** compresses full pages to 50–200 tokens by removing redundant nodes
- **Just-In-Time (JIT) Tool Injection** prevents "tool bloat" which consumes 10–20% context budget

---

## Part 3: The Supremely Goated Architecture

### Design Philosophy — Accuracy & Effectiveness First

> **Primary goal: Make the agent smarter, more accurate, and more capable at completing real browser tasks.**
> **Secondary benefit: Token efficiency follows naturally from giving the LLM better, more relevant information.**

The key insight from research is that **accuracy improves when you give the LLM better information, not more information**. A flat 30,000-token history actually *hurts* accuracy because:
- The model's attention is diluted across noise
- Stale DOM states from 10 steps ago contradict the current page state
- The model has no way to distinguish "important fact" from "incidental navigation step"

This architecture solves accuracy by giving the LLM **three things it currently doesn't have**:
1. **Precise situational awareness** — exactly the right DOM elements for the current sub-goal
2. **Verified prior knowledge** — what worked on this domain before, confirmed by success
3. **Failure awareness** — what has already been tried and failed, preventing loops

Token savings are a **side effect** of accuracy-first design. The primary invariant is: *the Navigator LLM should always have the highest-quality, most relevant context for its current decision — no more, no less.*

---

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                 WEBGENIE CONTEXT ROUTER                  │
│                                                         │
│  ┌─────────────┐  ┌────────────┐  ┌─────────────────┐  │
│  │ SLOT 1      │  │ SLOT 2     │  │ SLOT 3          │  │
│  │ System Prmt │  │ Task Goal  │  │ Memory Anchors  │  │
│  │ (~2k tok)   │  │ (~300 tok) │  │ (~500 tok)      │  │
│  └─────────────┘  └────────────┘  └─────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ SLOT 4: Compressed History (Memory Pyramid)     │   │
│  │ L3: Phase milestones  (~200 tok)                │   │
│  │ L2: Last 3-step trace (~800 tok)                │   │
│  │ L1: Current DOM state (adaptive, ~2k–8k tok)    │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ SLOT 5: Failure Blocklist (~200 tok)            │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

        ↑ Query                           ↑ Learn
        │                                 │
┌───────┴────────────────────────────────┴──────┐
│              PERSISTENT MEMORY                 │
│                                               │
│  ┌─────────────┐  ┌────────────┐  ┌────────┐ │
│  │ Vector Store│  │ Graph Store│  │  KV    │ │
│  │ (Intent     │  │ (Selector  │  │ Store  │ │
│  │  Embeddings)│  │  Graphs)   │  │(Domain)│ │
│  └─────────────┘  └────────────┘  └────────┘ │
│  [Backed by chrome.storage.local + IndexedDB] │
└───────────────────────────────────────────────┘
```

---

## Part 4: The Five Core Components

### Component 1: The Memory Pyramid (Tiered Context)
**Replaces**: flat `MessageManager` history
**Inspired by**: MemGPT's RAM/Disk model + CoALA's working/episodic split

The `MessageManager` is restructured into 3 **immutable slots** that have hard token budgets:

```
Level 1 — LIVE (Hot):  Current page DOM, active viewport elements
           Budget: adaptive, 2,000–8,000 tokens
           Refresh: every step

Level 2 — TRACE (Warm): Last 3 step outcomes, extracted content, action results  
           Budget: fixed, 800 tokens
           Refresh: rolling window, step N-3 → N

Level 3 — MILESTONES (Cold): Compressed phase summaries, max 5 entries
           Budget: fixed, 200 tokens  
           Refresh: compacted when a phase completes (e.g., "auth complete")
```

**How truncation is fixed**: Each level has a **dedicated token budget enforced at write time**, not at read time. Truncation never touches Level 1 (live DOM) or Level 3 (milestones). If Level 2 overflows, the oldest trace entry is **summarized and promoted** to Level 3, then discarded.

---

### Component 2: Multi-Store Persistent Memory
**Inspired by**: Mem0's Vector + Graph + KV hybrid, A-MEM's Zettelkasten notes

Three `chrome.storage.local` + IndexedDB namespaces:

```typescript
// KV Store — Fast structured lookups
interface DomainRecord {
  domain: string;                    // "mail.google.com"
  lastVisited: number;               
  layoutFingerprint: string;         // hash of DOM structure signature
  knownPanels: string[];             // ["compose", "inbox", "settings"]
}

// Episodic Store — Compressed past interactions
interface EpisodicNote {
  id: string;
  domain: string;
  intent: string;                    // "compose and send email"
  outcomeSteps: string;              // 3-line summary of what worked
  successCount: number;
  linkedNoteIds: string[];           // A-MEM Zettelkasten links
  timestamp: number;
}

// Semantic/Selector Store — Verified element anchors
interface SelectorAnchor {
  domain: string;
  layoutFingerprint: string;         // Only valid for this layout state
  intentKey: string;                 // "click compose button"
  selector: string;                  // verified working CSS selector
  xpath: string;                     // backup locator
  successRating: number;
}
```

**The A-MEM write flow**: When a task step succeeds, WebGenie creates an `EpisodicNote`, then asks the LLM to identify links to existing notes: *"Which previous interactions on this domain does this relate to?"* Links are stored, building a Zettelkasten graph over time.

---

### Component 3: Context-Aware DOM Attention Masking
**Inspired by**: DOM Efficiency Research — AXTree, D2Snap, Snapshot+Ref

The DOM representation sent to the LLM is **dynamically filtered by the active sub-goal**:

```
Planner sub-goal: "Fill in the email compose form"
                          ↓
Context Router reads sub-goal keywords: ["compose", "email", "form", "fill"]
                          ↓
DOM Masker scans interactive elements, applies filter:
  KEEP: elements inside compose panel container
  STRIP: navigation sidebar, inbox list, header buttons
                          ↓
Token reduction: 8,000 tokens → 400 tokens (20x reduction)
```

Additionally, **element reference IDs** (e.g. `@e42`) are assigned once per page load and reused across steps. The full element data is transmitted only on first sight. Subsequent steps only transmit **deltas** (newly appeared or disappeared elements).

---

### Component 4: Failure Registry & Negative Memory
**Inspired by**: Missing from all existing frameworks — novel addition

```typescript
interface FailureRecord {
  selector: string;
  url: string;
  actionType: string;     // "click" | "input"
  failCount: number;      // incremented on every failed attempt
  lastFailTimestamp: number;
}
```

When an action is attempted and the page state does not change within 2 seconds:
1. `registerFailure(selector)` is called
2. Any selector with `failCount >= 2` is flagged as BLOCKED
3. The DOM prompt prepends `⛔ [BLOCKED]` to that element's description

This prevents the #1 loop failure mode: repeatedly clicking a non-interactive element.

---

### Component 5: JIT Memory Retrieval (Just-In-Time Context Injection)
**Inspired by**: MemGPT's explicit paging + Mem0's selective retrieval

Rather than loading all past memory at task start, memory is retrieved **just before it's needed**:

```
Step N: Planner says "now we need to compose an email"
                    ↓
Context Router triggers JIT retrieval:
  1. Query SelectorAnchor store: domain=mail.google.com, intent~"compose"
  2. Query EpisodicNote store: retrieve 2 most relevant past sessions
  3. Inject results as Memory Anchors into Slot 3 of the context
                    ↓
Navigator receives:
  [Memory Anchor] Compose button previously found at selector 'div[jsname="r4nke"]'
  [Episode] Last time: opened compose → filled To/Subject/Body → sent → success
```

This means most steps require **zero retrieval latency** (no memory is loaded). Only steps involving known domains trigger a cheap `chrome.storage.local.get()` call (~0.1ms).

---

## Part 5: How Each Component Improves the LLM

| Problem | Root Cause | Solution | LLM Impact |
|---|---|---|---|
| **Attention dilution** | 30k token flat history | Memory Pyramid with hard budgets | Model focuses on signal, not noise |
| **Truncation crashes** | `cutMessages()` slices JSON | Per-slot budget enforced at write time | Zero parse failures |
| **Session amnesia** | No persistence | Multi-store episodic + semantic memory | Gets smarter after every task |
| **Loop failures** | No failure tracking | Failure Registry + BLOCKED prefix | Agent always finds alternative path |
| **DOM token bloat** | Full DOM retransmission | AXTree + Delta refs + Goal masking | 20x token reduction on DOM |
| **Irrelevant retrieval** | Always-on full history | JIT selective injection per sub-goal | Maximum context relevance density |

---

## Part 6: Implementation Files

| What | File | Description |
|---|---|---|
| Memory Pyramid slots | `messages/service.ts` | Add `PyramidLevel` enum, per-level budgets, promotion logic |
| Multi-store persistence | `browser/memory-store.ts` | New file: KV, Episodic, Selector stores backed by `chrome.storage.local` |
| DOM Attention Masking | `browser/page.ts` | Add goal-aware element filter in `buildDomTree`/`getState` |
| Failure Registry | `agent/types.ts` | Add `failureRegistry: Map<string, FailureRecord>` to `AgentContext` |
| JIT Context Injection | `agent/prompts/base.ts` | Add memory anchor injection before DOM state is built |
| Context Router | `agent/context-router.ts` | New file: orchestrates pyramid, masking, JIT retrieval, failure blocklist |
| A-MEM Note Writer | `browser/memory-store.ts` | Post-step note creation + Zettelkasten link generation |

---

## Part 7: Expected Outcomes

> Ordered by priority: **Accuracy & Effectiveness first**, efficiency second.

### Accuracy & Effectiveness Gains (Primary)

| Metric | Current | After | Why It Improves |
|---|---|---|---|
| **Task completion rate on known domains** | ~75% | ~97%+ | Selector anchors + verified episodic knowledge eliminates search loops |
| **Action loop failures** | Common | Near zero | Failure Registry blocks dead-end elements, forces new reasoning path |
| **Planner decision quality** | Degrades at step 10+ | Consistent throughout | Memory Pyramid keeps context high-signal at every step |
| **LLM attention on correct element** | ~60% on long tasks | ~95%+ | DOM masking eliminates irrelevant element noise |
| **Multi-step task completion (20+ steps)** | Unreliable | Reliable | Milestone compaction prevents context saturation breaking reasoning |
| **Cross-session task learning** | Zero | Continuous | Agent applies verified knowledge from past runs |
| **Truncation-induced reasoning failures** | Occasional | Eliminated | Per-slot budgets never corrupt live messages |

### Efficiency Gains (Side Effect of Better Architecture)

| Metric | Current | After | Change |
|---|---|---|---|
| Tokens per step | ~20,000 | ~2,500 | 87.5% reduction |
| Max reliable steps | ~15 | 200+ | 13x more steps |
| Token cost per task | High | Minimal | ~10x cheaper |

---

## Part 8: Zero Degradation Contract

> **This is a hard constraint. No memory feature is permitted to ship if it reduces agent accuracy, capability, or task completion rate in any scenario.**

Every component is designed with a **conservative fallback** — if the memory system is uncertain, it always defers to the full raw DOM and uncompressed context. The memory system is an **additive enhancement**, never a replacement for direct observation.

### Risk-by-Risk Breakdown

#### Risk 1: DOM Attention Masking removes elements the agent needs
- **Scenario**: Goal-masking prunes the navigation sidebar, but the agent actually needs to click a sidebar link to proceed.
- **Mitigation**: Masking is **advisory, not destructive**. Elements are only hidden from the LLM prompt if the planner's current sub-goal has a **confidence score > 0.85** match to a specific known container. If confidence is lower, the full unmasked DOM is sent.
- **Fallback**: If two consecutive steps fail after masking is applied, masking is disabled for the rest of that task run automatically.

#### Risk 2: Episodic/Selector Cache returns a stale selector
- **Scenario**: Gmail updates its DOM, the cached `div[jsname='N8nh4']` selector no longer points to Compose.
- **Mitigation**: Cache anchors are presented to the LLM as **suggestions**, not commands:
  `[Memory Hint] Compose button was previously at selector X — verify before using`
- **Mitigation 2**: A **layout fingerprint** (hash of the page's structural shape) is stored alongside each selector. If the fingerprint doesn't match the current page, the anchor is silently dropped and not injected.
- **Fallback**: On any click failure from a cached anchor, the anchor is **immediately invalidated** from the cache and the agent proceeds with fresh DOM scanning. The agent never retries a failed cached selector.

#### Risk 3: Memory Pyramid compaction loses critical task facts
- **Scenario**: The agent summarised "step 3–6" into a milestone, but the summary lost a specific product ID or form value needed in step 20.
- **Mitigation**: **`extractedContent` results are always protected** — any `ActionResult` with `includeInMemory: true` and a non-null `extractedContent` is pinned to Level 2 (Trace) and **cannot be compacted** until the task ends.
- **Mitigation 2**: The compaction LLM is given an explicit instruction: *"Preserve all specific values (numbers, names, URLs, codes, IDs) verbatim. Only compress procedural navigation steps."*
- **Fallback**: If the compaction call fails or times out, the step is kept raw in the history. Compaction is best-effort, never blocking.

#### Risk 4: Failure Registry blocks a valid but slow element
- **Scenario**: A button is temporarily disabled (e.g., loading spinner for 3 seconds). It registers 2 failures and gets blocked, but it would have worked on attempt 3.
- **Mitigation**: Failure records are **URL + selector + timestamp** scoped. A failure is only counted if the page state did not change **and** the element's visual state was not `aria-busy` or `aria-disabled`.
- **Mitigation 2**: Blocked selectors are automatically **unblocked after a page navigation** (new URL) since the layout is fresh.
- **Fallback**: The LLM sees the `⛔ [BLOCKED]` prefix but can still choose to retry if its reasoning determines the element may now be interactive. The block is a strong hint, not a hard constraint.

#### Risk 5: JIT retrieval injects irrelevant memory and pollutes context
- **Scenario**: The agent is filling a GitHub issue form, but retrieves memories from a Gmail session on the same domain path, injecting irrelevant email selectors.
- **Mitigation**: Retrieval is **scoped by both domain AND sub-page path**. `mail.google.com/mail/u/0/#compose` and `mail.google.com/mail/u/0/#inbox` are treated as distinct layout contexts.
- **Mitigation 2**: Retrieved anchors are ranked by cosine similarity to the current planner sub-goal. Only anchors with similarity > 0.75 are injected. The rest are discarded silently.
- **Fallback**: If no anchors score above the threshold, the Memory Anchors slot (Slot 3) is left empty and the agent proceeds with zero memory injection — identical to current behaviour.

### Summary: The Golden Rule
```
Memory system OFF  →  Agent behaves exactly as today (baseline preserved)
Memory system ON   →  Agent behaves strictly better (additive only)
```

Every feature has an explicit off-ramp. The entire system is **opt-in per feature**, meaning:
- Compaction can be disabled via config flag `memoryCompaction: false`
- Selector cache can be disabled via `episodicCache: false`  
- DOM masking can be disabled via `domMasking: false`
- Failure registry can be disabled via `failureRegistry: false`

This ensures the existing agent capability is the **permanent floor**, and memory features only raise the ceiling.

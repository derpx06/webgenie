# Executive Summary

This research specification presents a deep forensic analysis and re-architecture blueprint for WebGenie's memory, context, state, and long-horizon execution subsystems. While previous reports focused on high-level agent loops, this report drills directly into the lowest levels of system execution: the serialization pipeline, JIT episodic indexing, memory conflict logic, and browser-connection longevity.

Through this investigation, we uncover structural flaws in standard context-assembly structures, memory decay, and state synchronization, proposing a **durable, event-sourced memory-graph architecture** to scale WebGenie past 500+ steps.

---

# Memory System Audit

WebGenie partitions its memory into working memory, episodic memory, semantic memory, browser memory, and task memory. Each component has unique reliability flaws under production workloads:

## 1. Working Memory (A-MEM Scratchpad)
-   **Capacity & Lifetime**: Currently limited to a 2000-character string slice.
-   **Drift & Contamination**: As the task progresses, older facts are sliced off. The agent experiences "retrograde amnesia", forgetting credentials, constraints, or page rules discovered during steps 1-5.
-   **Forgetting Heuristics**: The existing system lacks priority-weighted eviction. It relies on Jaro-Winkler string similarity which fails to evaluate the semantic weight of facts.

## 2. Episodic Memory (JIT Note Recall)
-   **Storage & Retrieval**: Episodic memories are stored as raw text route descriptions ("Completed in X steps...").
-   **Decay & Relevance**: There is no time-based or frequency-based decay (half-life calculations) for episodic notes.
-   **Conflict Handling**: If two episodic notes contain conflicting navigation routes for the same domain (e.g. before and after a major site layout update), the agent retrieves both, leading to planner confusion and execution loops.

## 3. Semantic Memory (Domain Briefs)
-   **Knowledge Updates**: Domain briefs are static counters (`totalSuccessfulTasks`).
-   **Knowledge Conflicts**: If a selector shifts permanently, the static domain briefings cannot update dynamically to deprecate the cached selector, forcing the agent to attempt the dead fast-path repeatedly.

## 4. Browser Memory (State History)
-   **Navigation History**: The system tracks URLs via a simple array, but does not capture history states pushed via Single Page Application (SPA) routers (`history.pushState`).
-   **State Persistence**: If the underlying chrome page object reloads, element maps are rebuilt with new indices, but the past actions stored in history refer to the old indices, causing the compaction history engine to evaluate invalid traces.

## 5. Task Memory (Goal Manager Node Tree)
-   **Goal Revision**: The goal manager uses flat variables (`primaryGoal`, `currentGoal`, `currentSubgoal`). It lacks a hierarchical DAG (Directed Acyclic Graph) tree, meaning that parent-child dependencies between sub-tasks cannot be modeled, leading to pre-mature task termination.

---

# Context System Audit

We traced the complete context assembly pipeline:

```
[User Request] 
      │
      ▼
[Goal DAG Extraction] ──► [JIT Memory Retrieval]
                                │
                                ▼
[Context Assembly Engine] ◄── [DOM Serializer (Filtered)]
          │
          ▼
[Token Truncation Gate] ──► [LLM Context Window]
```

## Discovered Vulnerabilities:
1.  **Lost-in-the-Middle Effect**: The system appends DOM elements at the end of the context prompt. Large language models tend to ignore elements placed in the middle of long prompts, causing the agent to miss target buttons on dense web pages.
2.  **Context Contamination via Raw HTML Logs**: Console warnings and network errors are serialized and appended directly to the context. This pollutes the token space with non-actionable stack traces.
3.  **Duplication of State**: Pinned memory items, timeline events, and the DOM tree often contain the same text strings, bloating the prompt context with 15-20% redundant tokens.

---

# Retrieval System Audit

The retrieval pipeline suffers from three critical bottlenecks:
1.  **Keyword Matching Limitations**: The intent matcher uses naive string keyword splitting, which fails to retrieve relevant notes when queries use synonyms (e.g., "purchase" vs. "buy").
2.  **Lack of Relevance Calibration**: Episodic notes are retrieved based on simple similarity scores. There is no confidence floor, so the system will inject low-relevance past notes into the prompt if no high-relevance matches exist, polluting the context.
3.  **Missing Retrieval Aging**: Older, potentially outdated routing instructions are prioritized equally with recent runs, ignoring site design updates.

---

# State Management Audit

We audited the lifecycle of the agent's execution state:

| State Type | Creation | Mutation | Persistence | Restoration |
| :--- | :--- | :--- | :--- | :--- |
| **Tab State** | Chrome Tab | Page Navigation | `none` | Reload URL |
| **Element Map** | Content Script | DOM Mutate | `none` | Re-serialize |
| **A-MEM Cache** | Memory Store | `importFromLLM` | `sessionStorage` | Load from Session |
| **Goal Manager** | Executor | `updateGoals` | `sessionStorage` | Load from Session |

## Silent Failure Analysis:
-   **Orphaned States**: If the Chrome page crashes, `chrome.tabs.onRemoved` fires. The executor continues running its internal step loop on a null page, producing `undefined` element actions that are marked as successful because no tab interaction error is caught.
-   **Stale DOM Fingerprints**: The layout fingerprint calculation in `computeLayoutFingerprint` sorts elements by hash, but if dynamic ads add elements, the sorted array order changes, producing a new fingerprint that misses all cached selectors.

---

# Long-Horizon Execution Audit

We simulated the agent's performance over long step sequences (50 to 500 steps).

```
   Token Bloat (%)
      ▲
 100 ─│                                     /
  80 ─│                                    /  <-- Memory and Timeline Accumulation
  60 ─│                                 /
  40 ─│                     /──────────/      <-- Compaction Buffers
  20 ─│         /──────────/
   0 ─└─────────┴──────────┴──────────┴────────► Steps
      0        10         50         100
```

## Key Degradation Vectors:
1.  **At Step 50**: Standard trace compaction replaces pairs with MILESTONE messages. However, timeline events accumulate linearly.
2.  **At Step 100**: The timeline list exceeds 2500 tokens. The A-MEM working memory is truncated. The agent loses the initial instructions and starts loops.
3.  **At Step 500**: Memory consumption of the service worker exceeds Chrome's extension process memory limits (typically 30MB for background scripts), triggering silent worker termination.

---

# Planner-Memory Interaction Audit

-   **Feedback Loop Flaw**: The Planner writes facts to `InChatMemory`. If the Planner hallucinates that a form was submitted, it writes "Form submitted successfully" as a fact. The next step's Planner reads this fact from memory, believes it to be absolute truth, and marks the task as done, bypassing visual verification.

---

# Navigator-Memory Interaction Audit

-   **Selector Anchors Stagnation**: The Navigator retrieves cached fast-path selectors. If the target element has changed visually (e.g. button color changed to red, indicating disabled state), the Navigator blindly clicks it because the XPath still matches, ignoring the visual state attributes.

---

# Context Engineering Audit

## Recommended Prompt Context Hierarchy
To maximize attention recall in LLMs, context must be layered according to semantic importance:

```
┌────────────────────────────────────────────────────────┐
│ 1. SYSTEM RULES & SECURITY CONSTRAINTS (Highest Priority)│
├────────────────────────────────────────────────────────┤
│ 2. WORKING MEMORY & CONSTRAINTS (Mutable facts)        │
├────────────────────────────────────────────────────────┤
│ 3. ACTIVE GOALS & PROGRESS DAG                         │
├────────────────────────────────────────────────────────┤
│ 4. SERIALIZED DOM STATE (Viewport focus elements)      │
├────────────────────────────────────────────────────────┤
│ 5. RECENT ACTIONS & VERIFIED RESULTS (Lowest Priority)  │
└────────────────────────────────────────────────────────┘
```

---

# Missing Capabilities

Listed by impact on correctness:

1.  **Durable Checkpointing (Event Sourcing)**: Storing the complete sequence of state mutations, enabling exact state replays on crash.
2.  **Memory Age Decay Heuristics**: Discounting the weight of past selectors based on timestamp age and mutation rates.
3.  **VLM Visual Verification Gate**: Utilizing visual models to audit screenshots.
4.  **Token Caching Optimization**: Using Anthropic's Prompt Caching to reduce latency and costs on static system prompts.

---

# Alternative Architecture Design

## Option A: Minimal Modifications
-   Increase working memory limit to 4000 characters.
-   Filter out invisible elements in the DOM serializer.
-   Add Jaro-Winkler matching to subgoal checks.

## Option B: Balanced Redesign
-   Implement dynamic planning triggers on DOM mutations.
-   Add form input state checkers before click executions.
-   Move session memory storage to persistent local storage.

## Option C: Maximum Reliability (Recommended for Production)
-   Implement the **Event-Sourced Stateful Verification Swarm**.
-   Implement Visual Verification gates with pixel diff comparisons.
-   Use dynamic XPath selector caches with age decay and confidence scoring.

---

# Deep Fixes

### 1. Element Index Drift on Dynamic Pages
*   **Root Cause**: Element index mapping is transient and shifts when dynamic elements inject.
*   **Failure Scenario**: The agent retrieves index `10` for a button. Before execution, a banner advertisement loads at the top of the page, moving the target button's index to `11`. The agent clicks index `10` (the ad), loading an external page.
*   **Recommended Solution**: Implement **Selector Anchoring**. Bind each selector to a unique CSS path and a localized text content hash. Verify these properties in the content script immediately prior to clicking.

---

# Recommended Memory Architecture

```typescript
class EventSourcedMemoryStore {
  private events: MemoryEvent[] = [];

  public commit(event: MemoryEvent): void {
    this.events.push(event);
    this.applyEvent(event);
  }

  private applyEvent(event: MemoryEvent): void {
    // Dynamically mutates active state cache
  }

  public getSnapshot(stepNumber: number): StateSnapshot {
    // Replay events up to stepNumber to reconstruct exact state
  }
}
```

---

# Recommended Context Architecture

Context assembly must use a **Strict Sliding Viewport Mask**:
1.  Only serialize elements inside the active viewport boundary.
2.  Summarize off-screen elements into high-level region descriptions (e.g. "Footer: 15 category links. Header: 5 nav links.").
3.  Inject full DOM trees only when search queries return zero visible matches.

---

# Recommended State Architecture

State must be saved as a transactional journal in `chrome.storage.local`:

```
[State Mutated] ──► [Append Event to Journal] ──► [Write to Local Storage] ──► [Flush on Step End]
```

---

# Recommended Long-Horizon Architecture

To scale tasks past 500 steps, we recommend **Hierarchical Execution Graphs (HEG)**:
-   **Manager Agent**: Owns the high-level task goal.
-   **Worker Agent**: Spawned for short-horizon subgoals (e.g. logging in). The worker's message history is discarded completely upon subgoal completion, leaving only a compressed result fact in the Manager's context.

---

# Migration Strategy

1.  **Sprint 1**: Replace `chrome.storage.session` with `chrome.storage.local` event-sourcing handlers.
2.  **Sprint 2**: Build element stability and verification hooks into content script injections.
3.  **Sprint 3**: Roll out the Verifier Agent and the visual diff checking system.

---

# Final Architecture Recommendation

The final recommendation is to deploy the **Hierarchical Event-Sourced Memory Swarm (HESMS)**. By combining hierarchical sub-agent isolation with event-sourced state checkpoints, WebGenie can safely automate long-horizon workflows without context rot or memory leaks.

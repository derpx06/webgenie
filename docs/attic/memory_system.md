# WebGenie Memory System Architecture Documentation

This document describes the design, mechanics, and integration of the **Three-Tier Hybrid Memory System** implemented in WebGenie. This architecture enables WebGenie to transition from stateless DOM-scanning tasks to a persistent, self-reflecting, context-aware browser agent.

---

## 1. Architectural Overview

The memory system is structured as a hierarchical network of three distinct subsystems, each serving a unique role in the agent's cognition:

```
                  ┌────────────────────────────────────────────────────────┐
                  │                      USER REQUEST                      │
                  └──────────────────────────┬─────────────────────────────┘
                                             │
                                     [1] Start Task
                                             │
                                             ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                    Executor Loop                       │
                  └──────────┬───────────────────────────────────▲─────────┘
                             │                                   │
                [2] Read     │                                   │ [5] Persist
                Memory       │                                   │ memory field
                             ▼                                   │
     ┌───────────────────────────────────────────────┐           │
     │                 Prompt Engine                 │           │
     │ ├─ Domain Briefing (Tier 3)                   │           │
     │ ├─ Previous Goal Evaluation (Reflection)      ├───────────┘
     │ ├─ Durable Working Scratchpad (Tier 1)        │
     │ ├─ Intent-Matched Episodes (Tier 2)           │
     │ └─ Fast-Path Selectors (Tier 3)               │
     └───────────────────────┬───────────────────────┘
                             │
                        [3] Send
                        Context
                             │
                             ▼
                    ┌─────────────────┐
                    │  Navigator LLM  │
                    └────────┬────────┘
                             │
                        [4] Action
                        Sequence
                             │
                             ▼
                    ┌─────────────────┐
                    │ Browser Control │
                    └─────────────────┘
```

---

## 2. The Three-Tier Memory Hierarchy

### Tier 1: Durable Working Memory (Scratchpad)
* **Purpose**: Persist the agent's step-by-step thinking scratchpad (`memory` output field) without letting it get compacted or pruned by token-budget window limits.
* **Storage Location**: `chrome.storage.session` using the key `${sessionId}:wm`. This keeps the scratchpad alive across Chrome service worker restarts.
* **Mechanics**:
  - The `MessageManager` stores this scratchpad value in a private class member `workingMemory` separate from the message history list (`history`).
  - At the end of every step, the `NavigatorAgent` takes the JSON output `brain.memory` and calls `setWorkingMemory(memory)`.
  - When preparing the context for the next turn, `BasePrompt` reads from `messageManager.getWorkingMemory()` and appends it to the reflection block under `[Agent memory]`.

---

### Tier 2: Episodic Memory OS (A-MEM Zettelkasten)
* **Purpose**: Capture end-to-end task history summaries ("episodes") and recall relevant routes in future tasks.
* **Storage Location**: `chrome.storage.local` under the key `wg_mem:episodes`.
* **Subsystem Details**:
  1. **Page-Path Scoping**: Episodes are saved with `domain` and `pagePath` (e.g. `/inbox` vs `/compose`) to avoid cross-page contamination.
  2. **Intent Keyword Overlap**: Instead of loading *all* episodes for a domain (which wastes token budget), the system extracts non-stopword keywords from both the current goal and stored episodes, computing Jaccard similarity:
     $$\text{intentSimilarity}(A, B) = \frac{|Keywords(A) \cap Keywords(B)|}{|Keywords(A) \cup Keywords(B)|}$$
  3. **Exponential Time-Decay**: To prevent the agent from using stale selectors on a redesigned site, the relevance score decays over time with a 15-day half-life:
     $$\text{decayFactor}(t) = \max\left(0.5, e^{-\frac{\Delta t}{21.7}}\right)$$
  4. **Composite Ranking**: Candidate episodes are recalled by sorting by:
     $$\text{Score} = \text{successCount} \times \text{decayFactor}(t) \times (1 + \text{intentSimilarity})$$
  5. **Zettelkasten Graph Links**: Bidirectional relationships are forged between the new episode and past episodes *only if* they share semantic keywords (`intentSimilarity > 0`).

---

### Tier 3: Procedural Selector Anchors & Domain Intelligence
* **Purpose**: Store verified element selectors linked to stable DOM states, and track domain-level visits.
* **Storage Location**: `chrome.storage.local` under `wg_mem:selectors` and `wg_mem:domains`.
* **Subsystem Details**:
  - **Selector Anchors**: Scoped by `domain + pagePath + layoutHash`. The `layoutHash` fingerprint is generated by hashing the DOM branch-paths of all interactive elements. By seeding this hash with the URL page path, identical DOM subtrees on different pages produce unique fingerprints.
  - **💡 FAST PATH Hints**: Recalled selectors are injected into the prompt as directive commands:
    `💡 FAST PATH: To "click compose", use xpath //... (proven 3x, last used today)`
    The system prompt has a dedicated **Memory Usage Protocol** instructing the LLM to prioritize these hints over slow DOM scanning.
  - **Domain Session Priming**: Tracks overall success rate and key panels for a domain. When the agent first navigates to a domain, a briefing is injected to speed up step 1:
    `[Domain Intelligence] You have completed 8 tasks on mail.google.com. Known panels: compose, inbox.`

---

## 3. Operational Code Integration

The memory upgrades are integrated across 6 primary files in the extension background script:

### 1. `memory-store.ts`
* Implements keyword extraction, intent similarity scoring, and exponential time-decay calculation.
* Exposes `recallByIntent(domain, currentIntent, topN, pagePath)` to return scored episodic notes.
* Accumulates `totalSuccessfulTasks` incrementally inside the domain KV store.

### 2. `context-router.ts`
* Exposes `primeDomainContext(domain)` for generating domain briefings.
* Formats procedural selector hints in the directive `💡 FAST PATH` pattern.
* Scopes layout fingerprints using the URL page path to isolate state per sub-page.
* Updates `consolidateAfterTask` to only link notes that have keyword similarity > 0.

### 3. `messages/service.ts`
* Introduces the separate `workingMemory` field.
* Exposes `setWorkingMemory()`, `getWorkingMemory()`, `appendWorkingMemory()`, and `loadWorkingMemory()` to manage the persistent session key `${sessionId}:wm`.

### 4. `prompts/templates/navigator.ts`
* Injects a **Memory Usage Protocol** detailing:
  - Try `💡 FAST PATH` hints first.
  - Treat `[Past Sessions]` as proven routes.
  - Rely on `[Domain Intelligence]` for instant orientation.
  - Update `[Agent memory]` scratchpad systematically.
  - Adapt if `[Previous goal evaluation]` indicates failure.

### 5. `prompts/base.ts`
* Pulls `durableMemory` directly from `messageManager.getWorkingMemory()` to bypass compaction.
* Inject order: Domain Intelligence → Previous Goal Evaluation → Working Memory → Episodic Context → Fast-Path Hints.

### 6. `navigator.ts` & `executor.ts`
* `executor.ts` calls `loadWorkingMemory()` alongside history loading.
* `navigator.ts` writes the returned structured field `brain.memory` to `setWorkingMemory()` after each step and records `brain.evaluation_previous_goal` to `context.lastEvaluation`.

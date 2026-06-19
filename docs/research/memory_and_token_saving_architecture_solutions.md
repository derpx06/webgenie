# Specification: Memory, Token-Saving, and Accuracy Optimization Architecture

This specification outlines the architectural solutions and design blueprints to address context bloat, memory leakages, selector degradation, and state-binding failures in WebGenie. It provides actionable solutions to optimize token consumption, ensure exact verification, and establish durable episodic recall.

---

## 1. Architectural Solutions: Memory & State Remediation

### A. Context-Aware Semantic Slot Memory
*   **The Problem**: The current `InChatMemory.resolveConflicts()` uses Jaro-Winkler string similarity with a fixed threshold of `0.85`. This naive calculation lacks semantic logic, causing it to incorrectly deactivate opposing facts (e.g., "Do not click sign in" vs. "Click sign in") while failing to consolidate values that are structurally different but semantically identical (e.g., "price = $10" and "price is ten dollars").
*   **The Solution**: Transition from a flat array of memory items to a **Structured Semantic Slot Registry**. Memory items are stored as key-value properties under defined schemas:
    
    ```typescript
    interface MemorySlot {
      key: string;            // e.g., "auth.username", "checkout.budget"
      value: any;             // e.g., "john_doe", 150.00
      constraintLevel: 'HIGH' | 'MEDIUM' | 'LOW';
      lastUpdated: number;
    }
    ```
    
    Instead of relying on Jaro-Winkler similarity on raw content strings, updates are routed to specific slot keys. If a new value is written to an existing slot, the previous value is marked as historical, preventing conflict overlaps.

### B. Distance-Based Goal Completion Auditing
*   **The Problem**: The `GoalManager.completeGoal()` checks exact lowercase matches (`trim().toLowerCase()`) between the proposed subgoal and active goals. If the planner makes minor spelling or phrasing updates, the subgoal remains active, leading to memory leaks and loop failures.
*   **The Solution**: Implement **Semantic Vector / Cosine Distance Matching** for goal resolution, falling back to a token-level Jaccard similarity if vector embeddings are unavailable:
    
    ```typescript
    export function tokenJaccardSimilarity(s1: string, s2: string): number {
      const set1 = new Set(s1.toLowerCase().split(/\W+/));
      const set2 = new Set(s2.toLowerCase().split(/\W+/));
      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      return intersection.size / union.size;
    }
    ```
    
    Goals are marked complete if the similarity score is `> 0.82`. If the similarity falls between `0.60` and `0.82`, a quick validation call is sent to a lightweight model, or the user is prompted for confirmation.

---

## 2. Token-Saving Architecture Blueprint (Context Engineering)

Web agents are highly susceptible to "token walls" and context bloat because page snapshots and action logs are sent repeatedly with every step. The following solutions optimize context usage and reduce token burn by up to 75%.

```
                             [ RAW PAGE STATE ]
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │    Accessibility AXTree      │  <-- Prunes 80% of DOM nodes
                      └──────────────┬───────────────┘
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │  Visual Viewport Filtering   │  <-- Excludes offscreen elements
                      └──────────────┬───────────────┘
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │    Attention Safety Floor    │  <-- Retains key utility controls
                      └──────────────┬───────────────┘
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │     History Compaction       │  <-- Compresses older logs
                      └──────────────────────────────┘
```

### A. Semantic Accessibility Tree (AXTree) Serialization
Rather than serializing raw HTML DOM structures, WebGenie must parse the page layout into a **Semantic Accessibility Tree (AXTree)**.
*   **Why it saves tokens**: An HTML structure contains massive amounts of non-interactive styling divs, scripts, and trackers. The AXTree exposes only semantic roles (buttons, inputs, status regions) and names.
*   **AXTree Serialization Format**:
    
    ```json
    {
      "index": 12,
      "role": "combobox",
      "name": "Search products",
      "value": "Laptop",
      "interactive": true,
      "bounds": [120, 450, 400, 30]
    }
    ```
    
    This format reduces a typical page representation from 80,000 tokens to under 4,000 tokens.

### B. Visual Viewport & Boundary Filtering
*   **Viewport Scoping**: Prior to serialization, filter out all elements whose bounding boxes lie outside the active browser viewport.
*   **CSS Visibility Auditing**: Exclude elements that have `display: none`, `visibility: hidden`, `opacity: 0`, or are hidden behind overlapping modals.
*   **Attention Safety Floor**: Enforce a floor of 30 interactive elements. If viewport pruning leaves fewer than 30 elements, dynamically expand the viewport scope (e.g. scroll down or zoom out) to prevent context starvation.

### C. Hierarchical Context Triage
Organize the LLM context window into three distinct memory regions:

| Region | Content | Compaction Policy |
| :--- | :--- | :--- |
| **Core State** | System Prompts, Primary Goals, Active Constraints. | **Immutable**; always remains at the top of the context. |
| **Working State** | Active Tab URL, current AXTree representation, last 3 actions. | **Dynamic**; updated on every step. |
| **Episodic State** | Completed steps, past session notes. | **Compacted**; summarized using a sliding window. |

### D. Progressive History Compaction
*   **Compaction Threshold**: When the active message context exceeds 75% of the model's target context limit, trigger the compaction engine.
*   **Compaction Algorithm**:
    1.  Retain the last 3 steps in full detail (action request, raw tool response, error logs).
    2.  Consolidate steps `N-3` back to `0` into a bulleted summary:
        
        ```markdown
        Step 1-4 Summary: Navigated to example.com, filled out email field with "user@test.com", clicked next, and successfully bypassed cookie consent prompt.
        ```
        
    3.  Prune intermediate trace messages, styling details, and raw error stacks.

---

## 3. High-Accuracy Execution & Verification

### A. Dual-Loop Verification (Action-Observation Feedback)
To prevent "Done Hallucinations" (where the agent assumes a task is complete because it clicked a submit button, ignoring client-side validation errors), implement a separate verification loop:

```
[ Navigator Action ] ──► [ Execution ] ──► [ Capture Post-Step State ] ──► [ Verifier Audit ]
                                                                                   │
    ┌──────────────────────────────────────────────────────────────────────────────┘
    ▼
[ Success ] ──► Commit Checkpoint & Proceed
[ Failure ] ──► Rollback to Event Log Checkpoint & Re-plan
```

*   **Verifier System**: The Verifier runs on a separate execution context with a specialized audit prompt.
*   **Verification Verification Checks**:
    -   *Visual Check*: Compare pre-action and post-action screenshots using structural similarity (SSIM) to verify element updates.
    -   *DOM Check*: Inspect the post-action AXTree for validation messages (e.g., "password incorrect", "required field").
    -   *URL Check*: Confirm that the active tab's URL matches the expected state.

### B. Selector Self-Healing and Fast Path Cache
To achieve sub-100ms execution times for repetitive actions, implement a self-healing selector caching mechanism based on **Stagehand's ActCache** pattern:

1.  **Layout Fingerprint Calculation**:
    Compute a stable fingerprint of the active page layout:
    $$\text{Fingerprint} = \text{Hash}(\text{Sorted relative XPaths}) + \text{Hash}(\text{URL path})$$
2.  **Fast Path**:
    If the active page's fingerprint matches a cached selector entry, bypass LLM reasoning and execute the action directly using the cached XPath.
3.  **Selector Validation**:
    Before executing the cached selector, verify the target element matches the expected semantic properties (e.g., role, text label).
4.  **Slow Path (Self-Healing)**:
    If the cached selector fails or the element is not found, trigger the LLM to locate the element, execute the action, and update the cache with the new locator.

### C. Native React/Vue Event Simulation
In modern single-page applications, setting input value properties programmatically (e.g., `element.value = 'text'`) bypasses the framework's synthetic virtual DOM state bindings. 
*   **The Fix**: Manually simulate and dispatch native input and change events to ensure the framework binds the value:
    
    ```javascript
    function forceReactInputBind(element, value) {
      const lastValue = element.value;
      element.value = value;
      const event = new Event('input', { bubbles: true });
      // React 15/16 tracker bypass
      const tracker = element._valueTracker;
      if (tracker) {
        tracker.setValue(lastValue);
      }
      element.dispatchEvent(event);
    }
    ```

---

## 4. Implementation Roadmap

### Phase 1: Context & AXTree Serialization (Sprint 1)
*   Deploy AXTree extraction in `chrome-extension/src/background/browser/dom/views.ts` to replace raw HTML serialization.
*   Implement viewport and CSS visibility filtering.

### Phase 2: Slot Memory & Cosine Similarity (Sprint 2)
*   Replace Jaro-Winkler conflict resolution in `InChatMemory` with structured Slot Memory mapping.
*   Update `GoalManager` with Jaccard-based semantic goal completion checks.

### Phase 3: Action Caching & Verification Swarm (Sprint 3)
*   Implement the Selector self-healing cache in the Navigator registry.
*   Deploy the separate Verifier agent with visual SSIM and DOM error checking.

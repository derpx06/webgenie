# WebGenie Codebase Walkthrough & System Architecture Manual
## Part 4: Actions Execution & Reliability Engineering

This document details WebGenie's execution layers, focusing on action mapping, validation gates, multi-action sequencing, and error recovery systems.

---

## 1. Structured Actions Architecture

WebGenie maps target interactions to JSON schemas that coordinate with LangChain's structured tool output APIs.

```
       ┌──────────────────────────────────────────────────────────┐
       │                    Navigator Agent                       │
       │  Outputs: JSON actions list e.g., [{"click": {"element": 42}}] │
       └──────────────────────────┬───────────────────────────────┘
                                  ▼
       ┌──────────────────────────────────────────────────────────┐
       │                      Executor FSM                        │
       │  Invokes: doMultiAction(actions)                         │
       └──────────────────────────┬───────────────────────────────┘
                                  │ (Iterates & Evaluates)
                                  ▼
       ┌──────────────────────────────────────────────────────────┐
       │                   Action Builder &                       │
       │                   Action Registry                        │
       ├──────────────────────────────────────────────────────────┤
       │                  Individual Handlers                     │
       │  - click_element                                         │
       │  - input_text                                            │
       │  - keypress                                              │
       │  - scroll_to_element                                     │
       │  - done                                                  │
       └──────────────────────────────────────────────────────────┘
```

### 1.1 Action Registration (`ActionBuilder` & `NavigatorActionRegistry`)

Actions are defined in `chrome-extension/src/background/agent/actions/builder.ts` and managed by the registry (`chrome-extension/src/background/agent/agents/navigator/registry.ts`).

Each action implements the `Action` interface:
```typescript
export interface Action<T extends z.ZodType = z.ZodType> {
  name(): string;
  description(): string;
  schema(): T;
  getIndexArg(args: z.infer<T>): number | null;
  call(args: z.infer<T>): Promise<ActionResult>;
}
```

### 1.2 Action Handlers API Reference

WebGenie defines the following action schemas and handlers:

1. **`click_element(index: number)`**
   * **Purpose:** Triggers a click event on an element.
   * **Logic:** Finds the element by `index` in the active `DOMState.selectorMap`, scrolls it into view using `scrollIntoViewIfNeeded`, and dispatches a CDP-level click via `cdpClick(tabId, x, y)`.
2. **`input_text(index: number, text: string)`**
   * **Purpose:** Types text into an input field.
   * **Logic:** Focuses the target element, clears its current contents by sending `Backspace` events, and writes the new text using `cdpInsertText`.
3. **`select_option(index: number, value: string)`**
   * **Purpose:** Selects an option in a dropdown menu.
   * **Logic:** Evaluates a script inside the target frame to update the element's `value` property and dispatch change events.
4. **`keypress(index: number, key: string)`**
   * **Purpose:** Simulates pressing control keys (e.g. `Enter`, `Tab`, `Escape`, `ArrowDown`).
   * **Logic:** Focuses the element and dispatches keydown and keyup events through CDP.
5. **`scroll_to_element(index: number)`**
   * **Purpose:** Scrolls the viewport to align with the target element.
   * **Logic:** Calls `scrollIntoView` on the element's coordinates.
6. **`scroll_page(direction: 'up' | 'down')`**
   * **Purpose:** Scrolls the page page-by-page.
   * **Logic:** Evaluates `window.scrollBy` inside the target document using the viewport height.
7. **`open_new_tab(url: string)`**
   * **Purpose:** Opens a URL in a new tab.
   * **Logic:** Invokes `chrome.tabs.create`, validates the URL against firewall rules, and registers the tab in `TabOrchestrator`.
8. **`hover_element(index: number)`**
   * **Purpose:** Hover mouse pointer over the element.
   * **Logic:** Dispatches a mouseMoved event to the element's center coordinates.
9. **`done()`**
   * **Purpose:** Signals task completion.
   * **Logic:** Sets `result.isDone = true` to stop the FSM execution loop.

---

## 2. Multi-Action Sequencing & State Verification

The Navigator can execute multiple actions in a single step (e.g., clicking a text box, typing characters, and pressing Enter) to speed up execution.

### 2.1 State Verification

To prevent the agent from executing stale actions (for example, attempting to click a button that disappeared after a previous click in the same sequence), `doMultiAction` verifies the DOM state between actions:

```typescript
const newState = await browserContext.getState(this.context.options.useVision);
const newPathHashes = await calcBranchPathHashSet(newState);
if (!newPathHashes.isSubsetOf(cachedPathHashes)) {
  const msg = `Something new appeared after action ${i} / ${actions.length}`;
  results.push(new ActionResult({ extractedContent: msg, includeInMemory: true }));
  break;
}
```

#### How State Mutation Detection Works:
1. **DOM Tree Traversal:** `calcBranchPathHashSet(state)` walks the DOM tree from the root node.
2. **Path Hashing:** For each node, it generates a hash combining the node's tag type and parent-relative position.
3. **State Comparison:** Before running the next action, the system generates a new set of hashes. If the new set is not a subset of the previous set, it indicates the page layout has changed. The sequence is aborted, returning control to the main loop to re-plan.

### 2.2 Done Safety Guardrail

If the agent clicks a submit button and calls the `done` action in the same step, it may stop before the page updates or returns an error.

To prevent this, `doMultiAction` implements a validation check:
* If the `done` action is chained after other actions in the same sequence, it is ignored:
  ```typescript
  if (actionName === 'done' && i > 0) {
    const msg = "The 'done' action was ignored. You MUST NEVER call 'done' in the same turn as other actions.";
    results.push(new ActionResult({ extractedContent: msg, includeInMemory: true }));
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
    break;
  }
  ```
* This forces the agent to verify the results of its actions in the next turn before ending the task.

---

## 3. Failure Registry & Self-Correction

The `FailureRegistry` (implemented inside `AgentContext`) tracks and handles repeated interaction failures.

### 3.1 Composite Failure Keys

If a click on an element does not change the page state (due to event capture conflicts or rendering issues), the agent might repeat the action, leading to a loop.

The `FailureRegistry` maps failures to a composite key combining the page URL and element attributes:
```typescript
const key = `${url}|${selector}`;
```
Using the URL in the key prevents failures on one page (e.g., a "Next" button issue) from blocking similar elements on another page.

### 3.2 Failure Threshold & Block Annotation

* **Threshold Check:** If an action on an element does not change the page state, its failure count increments. Once it reaches `FAILURE_THRESHOLD` (default is 2), the element is flagged as blocked.
* **Prompt Annotation:** During DOM prompt generation, blocked elements are prepended with a warning:
  ```
  ⛔ [BLOCKED - repeated no-op] [42] button "Submit"
  ```
* **System Directive:** The system prompt instructs the agent to avoid elements flagged with `⛔ [BLOCKED]`. This guides the model to find alternative paths (such as using keypress events or targeting parent containers).
* **Automatic Reset:** When the browser navigates to a new URL, `clearFailuresForUrl(url)` clears the failure records for the previous page, giving elements a clean state.

---

## 4. History Replay Engine

The `HistoryReplayer` (`chrome-extension/src/background/agent/agents/navigator/replay.ts`) allows users to rerun a sequence of recorded actions.

```
       ┌──────────────────────────────────────────────────────────┐
       │                    History Store                         │
       │  Retrieves: Serialized AgentStepHistory json             │
       └──────────────────────────┬───────────────────────────────┘
                                  ▼
       ┌──────────────────────────────────────────────────────────┐
       │                   HistoryReplayer                        │
       ├──────────────────────────────────────────────────────────┤
       │  1. Restores lastMemory & lastEvaluation                  │
       │  2. Maps saved action parameters                         │
       │  3. Matches saved indices to live DOM coordinates        │
       │  4. Reruns actions step-by-step with retry logic         │
       └──────────────────────────────────────────────────────────┘
```

### 4.1 Replay Execution Flow

1. **Setup Context:** Reads the saved execution history and restores the agent's memory state (`lastMemory` and `lastEvaluation`).
2. **Dynamic Selector Resolution:** The replayer does not rely on static coordinate offsets. Instead, it parses saved elements and searches the live page for matches using:
   * Target tag type (`tagName`).
   * Serialized attribute keys (such as `data-webgenie-id`, `id`, `name`, `class`).
   * Deterministic XPath.
3. **Execution & Retry Loop:** Reruns each action step-by-step. If an action fails (e.g. because of slow page rendering), the replayer retries the step:
   * It attempts the step up to `maxRetries` (default is 3) with a configurable delay (default is 800ms) between runs.
   * If a step fails after retrying, the replayer either stops the replay or skips the step, depending on the `skipFailures` setting.
4. **Completion:** Emits a final `TASK_OK` or `TASK_FAIL` event to notify the UI when the replay completes.

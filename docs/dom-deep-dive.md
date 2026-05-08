# WebSurfer DOM Engine Deep Dive

This document explains how the WebSurfer DOM engine works end to end: how the DOM is extracted, which files are responsible for which parts of the pipeline, how highlight indexes are assigned, how element lookup works, how actions survive page re-renders, and how the user-facing cursor/highlight UI fits into the flow.

It is intentionally detailed and file-referenced so it can be used as a maintenance guide when debugging dynamic sites such as Google Calendar, Gmail, or Google Meet.

---

## 1. High-level architecture

The DOM engine is split into two major halves:

1. **Page-side DOM analysis**
   - Injected scripts in [chrome-extension/public/dom](../chrome-extension/public/dom) inspect the live page.
   - They build a compact, typed, indexed tree.

2. **Background-side DOM consumption**
   - The background service worker calls the injected DOM code.
   - It converts the raw tree into typed objects.
   - It uses highlight indexes and selectors to resolve real browser elements.

The full orchestration begins in [chrome-extension/src/background/browser/dom/service.ts](../chrome-extension/src/background/browser/dom/service.ts).

---

## 2. Why the DOM engine exists

Modern websites are not static HTML documents. They are dynamic applications with:

- repeated re-renders
- ephemeral menus and popovers
- nested iframes
- shadow DOM
- delayed hydration
- dynamically replaced nodes
- virtualized lists

A simple `querySelector()` approach is not enough. WebSurfer therefore constructs a **live DOM tree with actionable indexes** and resolves those indexes back to real browser elements when performing actions.

That is why the DOM engine is split into:

- DOM extraction
- visibility and interaction heuristics
- highlight indexing
- selector generation
- action remapping
- runtime verification

---

## 3. DOM extraction entry point

The main entry point is `getClickableElements()` in [chrome-extension/src/background/browser/dom/service.ts](../chrome-extension/src/background/browser/dom/service.ts#L93-L110).

The flow is:

1. The background asks for clickable elements for the current tab.
2. The extension injects the DOM scripts if needed.
3. The page runs `window.buildDomTree(...)`.
4. The result returns a raw DOM tree plus a highlight-index map.

The actual injection logic is also in [chrome-extension/src/background/browser/dom/service.ts](../chrome-extension/src/background/browser/dom/service.ts#L595-L650).

### Important detail

This is executed in the page context, not in a static parser. That means the DOM builder can inspect:

- computed styles
- live bounding boxes
- shadow roots
- iframes
- actual interactive attributes
- browser-provided visibility signals

---

## 4. Raw tree format

The raw tree types are defined in [chrome-extension/src/background/browser/dom/raw_types.ts](../chrome-extension/src/background/browser/dom/raw_types.ts).

The important types are:

- `RawDomTextNode`
- `RawDomElementNode`
- `RawDomTreeNode`
- `BuildDomTreeResult`

### Why this shape is used

The DOM is stored in a flattened map rather than as one nested object only. This makes it easier to:

- assign stable ids
- store highlight indexes
- stitch iframe subtrees back together
- compare nodes across renders
- resolve nodes from the selector map

A `BuildDomTreeResult` contains:

- `rootId`
- `map`
- optional `perfMetrics`

See [chrome-extension/src/background/browser/dom/raw_types.ts](../chrome-extension/src/background/browser/dom/raw_types.ts#L1-L52).

---

## 5. Page-side DOM builder modules

The page-side logic lives in [chrome-extension/public/dom](../chrome-extension/public/dom).

### 5.1 Constants

[chrome-extension/public/dom/constants.js](../chrome-extension/public/dom/constants.js) defines the baseline rules used by the DOM builder.

It contains:

- `INTERACTIVE_TAGS`
- `INTERACTIVE_ROLES`
- `INTERACTIVE_CURSORS`
- `NON_INTERACTIVE_CURSORS`
- `ELEMENT_DENY_LIST`
- `DISABLE_ATTRIBUTES`
- `ALWAYS_ACCEPT_TAGS`
- `HIGHLIGHT_COLORS`
- `CONFIG`
- `FEATURES`

These constants are the first filter. They define what the engine is willing to even consider.

### 5.2 Helpers

[chrome-extension/public/dom/helpers.js](../chrome-extension/public/dom/helpers.js) contains the reusable DOM/geometry helpers.

This file is responsible for:

- cached bounding rects
- cached client rects
- cached computed styles
- viewport expansion checks
- text node visibility
- XPath generation
- quick rejection for obviously offscreen nodes
- `isInteractiveCandidate()`

### 5.3 Interactivity

[chrome-extension/public/dom/interactivity.js](../chrome-extension/public/dom/interactivity.js) decides whether an element is actionable enough to receive a highlight index.

Its main jobs are:

- `isInteractiveElement()`
- `isDistinctInteraction()`
- `isTopElement()`
- `shouldHighlightElement()`

This module is the main gatekeeper for actionability.

A useful mental distinction:

- `isInteractiveElement()` says: “Could the user interact with this?”
- `isDistinctInteraction()` says: “Should this node get its own index even if nested?”
- `isTopElement()` says: “Is this the visible target at the interaction point?”

### 5.4 Highlighting

[chrome-extension/public/dom/highlighting.js](../chrome-extension/public/dom/highlighting.js) creates highlight overlays.

It handles:

- the overlay rectangles
- the numeric labels
- the label positioning
- update logic on scroll/resize
- cleanup

### 5.5 Traversal

[chrome-extension/public/dom/traversal.js](../chrome-extension/public/dom/traversal.js) is the recursive DOM walker.

It:

- skips invalid nodes
- handles the root body
- handles text nodes
- handles shadow DOM
- handles iframes
- decides which nodes are visible and interactive
- builds the node map
- assigns highlight indexes

### 5.6 Bootstrap loader

[chrome-extension/public/buildDomTree.js](../chrome-extension/public/buildDomTree.js) wires all page-side modules together and exposes `window.buildDomTree()`.

That is what the background service calls when it wants a fresh tree snapshot.

---

## 6. DOM traversal in detail

Traversal starts at the page root and recursively visits nodes.

The rough pipeline is:

1. Skip invalid or previously visited nodes.
2. Handle text nodes separately.
3. Treat `document.body` as the logical root.
4. Reject elements in deny-listed tags.
5. Reject elements clearly outside the viewport.
6. Build a `nodeData` object for the element.
7. Capture stable attributes.
8. Decide visibility and interactivity.
9. Assign highlight index if appropriate.
10. Recurse into children, shadow DOM, or iframe documents.
11. Store the node in the flat map.

### Why it is conservative

If traversal is too aggressive, you get:

- extra noise
- wrong indexes
- duplicate clickable nodes
- false positives on wrapper elements

If it is too strict, you get:

- missing buttons
- missing dropdown items
- unclickable app menus
- failed automation on dynamic websites

The implementation tries to stay in the middle.

---

## 7. How highlight indexes are assigned

Highlight indexes are assigned during traversal and are used as the user-facing action indexes.

The index is:

- shown in the overlay label
- stored in the raw tree node
- preserved during conversion into typed nodes
- inserted into the background `selectorMap`

The important point is that the highlight index is not just visual. It is the key that links the UI, the DOM snapshot, and the action system.

The background converts the raw result into typed nodes in [chrome-extension/src/background/browser/dom/service.ts](../chrome-extension/src/background/browser/dom/service.ts#L408-L455).

---

## 8. Typed DOM tree and selector map

The typed DOM classes live in [chrome-extension/src/background/browser/dom/views.ts](../chrome-extension/src/background/browser/dom/views.ts).

That file defines:

- `DOMBaseNode`
- `DOMTextNode`
- `DOMElementNode`
- `DOMState`
- hashing methods
- serialization helpers

### selectorMap

When the background reconstructs the tree, it creates a `Map<number, DOMElementNode>`.

That map is the lookup table used for actions like:

- click by index
- input by index
- dropdown options by index
- select option by index

### Why this matters

The model can speak in highlight indexes, but the browser must act on real nodes. The selector map is the bridge.

See [chrome-extension/src/background/browser/dom/views.ts](../chrome-extension/src/background/browser/dom/views.ts#L80-L220) and [chrome-extension/src/background/browser/dom/service.ts](../chrome-extension/src/background/browser/dom/service.ts#L412-L455).

---

## 9. XPath and selector generation

`DOMElementNode.enhancedCssSelectorForElement()` is defined in [chrome-extension/src/background/browser/dom/views.ts](../chrome-extension/src/background/browser/dom/views.ts#L449-L565).

It combines:

- XPath-derived structure
- stable classes
- stable attributes like `id`, `name`, `type`, `placeholder`, `role`, `aria-label`, `data-testid`

### Why selector generation is hard

Dynamic pages often mutate their class names and internal DOM structure. A selector strategy has to:

- be specific enough to target the right node
- but not so specific that it breaks on every minor re-render

The current design prefers stable attributes and known-safe fields.

---

## 10. Element history and remapping

One of the most important pieces is the history remapping layer in [chrome-extension/src/background/browser/dom/history/service.ts](../chrome-extension/src/background/browser/dom/history/service.ts).

This is used when a page changes and the original index is no longer valid.

### Main functions

- `convertDomElementToHistoryElement()`
- `findHistoryElementInTree()`
- `compareHistoryElementAndDomElement()`
- `hashDomElement()`

### What it compares

The matching logic uses a combination of:

- parent branch path
- attributes hash
- XPath hash

That means the system is trying to locate the same logical element again, not just any similar-looking node.

### Why this is critical

On Google Calendar, opening a dropdown or saving a setting can destroy and recreate the DOM. A previously valid index can vanish even though the user still sees the same button on screen.

History remapping is the recovery path.

---

## 11. Background action execution

The main action handler is [chrome-extension/src/background/agent/actions/handlers/interaction.ts](../chrome-extension/src/background/agent/actions/handlers/interaction.ts).

This file handles:

- `handleClickElement()`
- `handleInputText()`
- `handleGetDropdownOptions()`
- `handleSelectDropdownOption()`

### The resolution strategy

When asked to act on an index, the handler now tries several things:

1. Resolve by the current index.
2. Retry after a short delay.
3. Resolve by XPath if available.
4. Remap the old element from cached history into the latest DOM tree.

That makes the agent much more resilient when the DOM changes between the planning step and the execution step.

### Dropdown behavior

The dropdown handlers are especially sensitive because menu popovers often re-render.

The handler avoids relying on stale indices alone and tries to resolve the live node before interacting.

---

## 12. Browser-level element lookup

The page controller in [chrome-extension/src/background/browser/page.ts](../chrome-extension/src/background/browser/page.ts) is what turns a typed `DOMElementNode` into a real browser `ElementHandle`.

### Lookup order

1. CSS selector from `enhancedCssSelectorForElement()`
2. XPath selector
3. Heuristic matching

### Why CSS can still be wrong

A CSS selector can sometimes match the wrong node if multiple similar nodes exist. That is why the page layer now verifies that the matched element is actually the expected one before returning it.

### Why XPath helps

XPath is often more stable for nested or repeated UI structures, especially when the DOM has similar sibling controls.

### Why heuristics exist

Heuristics are a fallback for cases where the DOM has changed so much that neither CSS nor XPath is enough.

See [chrome-extension/src/background/browser/page.ts](../chrome-extension/src/background/browser/page.ts#L1027-L1388).

---

## 13. Visual cursor and UI feedback

The content script UI in [pages/content/src/index.ts](pages/content/src/index.ts) provides visible feedback for the agent.

It handles:

- the active border effect
- the agent status pill
- the animated cursor
- cursor click feedback

### Why it exists

The visible cursor and status pill help the user understand what the agent is doing in real time.

This is separate from the actual DOM logic. It is a UI feedback layer, not the source of truth for interaction.

### Important distinction

- The cursor can disappear visually.
- The DOM indexes still exist in the background tree.

So turning off the highlight overlay or cursor does **not** delete the interaction map.

See [pages/content/src/index.ts](pages/content/src/index.ts#L430-L560).

---

## 14. Why indexes disappear on dynamic pages

Index loss is usually caused by re-rendering.

Typical examples:

- opening a menu creates a new DOM subtree
- selecting a value closes the popover
- changing a field updates the node order
- a dialog is destroyed and recreated
- an iframe reloads

That means a model may ask for index `482`, but by the time the action is executed, that node no longer exists.

This is why WebSurfer now uses a layered recovery strategy rather than failing immediately.

---

## 15. How Google Calendar is handled

Google Calendar is a difficult target because it relies on:

- nested dialogs
- ephemeral dropdowns
- re-rendered form controls
- dynamic popovers
- complex ARIA semantics

The DOM engine needs to find the right logical control even when the visual element has changed.

The most relevant files for this are:

- [chrome-extension/public/dom/helpers.js](../chrome-extension/public/dom/helpers.js)
- [chrome-extension/public/dom/interactivity.js](../chrome-extension/public/dom/interactivity.js)
- [chrome-extension/src/background/browser/dom/history/service.ts](../chrome-extension/src/background/browser/dom/history/service.ts)
- [chrome-extension/src/background/browser/page.ts](../chrome-extension/src/background/browser/page.ts)
- [chrome-extension/src/background/agent/actions/handlers/interaction.ts](../chrome-extension/src/background/agent/actions/handlers/interaction.ts)

---

## 16. Debugging strategy

If something seems wrong in the DOM engine, the best sequence is:

1. Check whether the node exists in the raw tree.
2. Check whether it has a highlight index.
3. Check whether the selector map contains it.
4. Check whether the page layer can resolve it.
5. Check whether the browser can click it.
6. If it fails, see whether history remapping finds the current equivalent node.

This layered debugging approach is much more useful than looking only at the UI overlay.

---

## 17. Files to read first

If you only read a handful of files, read these:

- [chrome-extension/public/dom/constants.js](../chrome-extension/public/dom/constants.js)
- [chrome-extension/public/dom/helpers.js](../chrome-extension/public/dom/helpers.js)
- [chrome-extension/public/dom/interactivity.js](../chrome-extension/public/dom/interactivity.js)
- [chrome-extension/public/dom/highlighting.js](../chrome-extension/public/dom/highlighting.js)
- [chrome-extension/public/dom/traversal.js](../chrome-extension/public/dom/traversal.js)
- [chrome-extension/public/buildDomTree.js](../chrome-extension/public/buildDomTree.js)
- [chrome-extension/src/background/browser/dom/service.ts](../chrome-extension/src/background/browser/dom/service.ts)
- [chrome-extension/src/background/browser/dom/raw_types.ts](../chrome-extension/src/background/browser/dom/raw_types.ts)
- [chrome-extension/src/background/browser/dom/views.ts](../chrome-extension/src/background/browser/dom/views.ts)
- [chrome-extension/src/background/browser/dom/history/service.ts](../chrome-extension/src/background/browser/dom/history/service.ts)
- [chrome-extension/src/background/browser/page.ts](../chrome-extension/src/background/browser/page.ts)
- [chrome-extension/src/background/agent/actions/handlers/interaction.ts](../chrome-extension/src/background/agent/actions/handlers/interaction.ts)
- [pages/content/src/index.ts](../pages/content/src/index.ts)

---

## 18. In one sentence

WebSurfer’s DOM engine turns the live browser DOM into a typed, highlighted, indexable, and recoverable interaction graph that can survive page mutations and still click the right thing.

---

## 19. What is sent to the LLM

The LLM does not receive the entire raw DOM or the page screenshot as plain HTML.
Instead, it receives a structured task context that usually includes:

- the agent role and system instructions
- the current goal or user request
- the latest browser state summary
- the visible interaction tree or extracted page facts
- the available actions it can choose from
- prior step history and results

The exact shape depends on the agent stage:

### Planner stage

The planner typically gets a cleaned message history plus the current state summary.
See [chrome-extension/src/background/agent/agents/planner/utils.ts](../chrome-extension/src/background/agent/agents/planner/utils.ts).

### Navigator stage

The navigator gets a structured brain/state object and then emits one or more actions.
The allowed action set is built in [chrome-extension/src/background/agent/agents/navigator/registry.ts](../chrome-extension/src/background/agent/agents/navigator/registry.ts).

### A simple example

If the user asks:

> Open the settings page and search for “Bedrock”

The model may see a context similar to this:

- current goal: open settings page and search for Bedrock
- current page: options/settings UI
- visible elements:
   - search input
   - model provider cards
   - navigation buttons
- available actions:
   - `click`
   - `input_text`
   - `select_dropdown_option`
   - `go_to_url`

Then it might produce an action like:

- click the settings search input
- type `Bedrock`

If the user is on a normal webpage, the same idea applies. For example, on a news page the model may receive:

- page title and URL
- a list of visible clickable headlines
- buttons such as search, next page, filter, or menu
- a structured DOM tree with highlight indexes

It still does not need the full HTML source to decide; it relies on the extracted page state and action schema.

### Important distinction

The DOM engine supplies **what exists on the page**.
The planner/navigator supplies **what to do next**.

That separation is what keeps the system modular and makes it easier to debug when a page changes.

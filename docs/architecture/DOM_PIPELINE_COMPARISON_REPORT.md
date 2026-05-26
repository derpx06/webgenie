# DOM Pipeline Comparison Report: WebSurfer vs Nanobrowser

## Scope

This report compares the current WebSurfer DOM pipeline with the attached nanobrowser implementation and identifies the most likely reasons for performance degradation.

No code changes were made.

---

## Executive Summary

The current WebSurfer DOM system is still fundamentally the same interaction model as nanobrowser:

- elements are identified primarily through `highlightIndex`
- fallback resolution uses `xpath`
- stale-node recovery uses history-based hashing
- the DOM tree is filtered, not fully exhaustive

The main performance regression does **not** come from the semantic-signature ideas described in the architecture note. Those claims are not reflected in code.

The most likely regression source is the newer modular DOM bootstrap in WebSurfer, where the injected DOM builder is split across multiple files instead of one bundled script. That increases script injection, parse, and initialization overhead, especially on pages with many frames.

---

## What the Current WebSurfer Code Actually Does

### 1. DOM nodes are still index-based

The runtime still uses `highlightIndex` as the primary lookup key in the selector map.

- [chrome-extension/src/background/browser/dom/views.ts](chrome-extension/src/background/browser/dom/views.ts#L81-L119)
- [chrome-extension/src/background/browser/dom/service.ts](chrome-extension/src/background/browser/dom/service.ts#L400-L455)

### 2. Recovery is history-hash based, not semantic-fingerprint based

WebSurfer hashes DOM elements using:

- parent branch path
- attributes
- xpath

There is no persistent per-node semantic fingerprint built from `tagName + role + ariaLabel + truncatedText + parentStructure`.

- [chrome-extension/src/background/browser/dom/history/service.ts](chrome-extension/src/background/browser/dom/history/service.ts#L67-L97)
- [chrome-extension/src/background/browser/dom/history/view.ts](chrome-extension/src/background/browser/dom/history/view.ts#L1-L20)

### 3. The DOM tree is filtered and measured aggressively

The builder still performs visibility checks, viewport checks, interactivity checks, and layout measurements.

- [chrome-extension/public/dom/helpers.js](chrome-extension/public/dom/helpers.js#L1-L260)
- [chrome-extension/public/dom/interactivity.js](chrome-extension/public/dom/interactivity.js#L1-L260)
- [chrome-extension/public/dom/traversal.js](chrome-extension/public/dom/traversal.js#L1-L260)

---

## Direct Comparison With Nanobrowser

### A. Script injection strategy

This is the clearest structural difference.

**WebSurfer** injects seven files when the DOM builder is missing:

- `dom/constants.js`
- `dom/cache.js`
- `dom/helpers.js`
- `dom/interactivity.js`
- `dom/highlighting.js`
- `dom/traversal.js`
- `buildDomTree.js`

See:
- [chrome-extension/src/background/browser/dom/service.ts](chrome-extension/src/background/browser/dom/service.ts#L596-L626)

**Nanobrowser** injects only one file:

- `buildDomTree.js`

This is the most likely source of extra startup overhead in WebSurfer.

### B. Runtime architecture

Nanobrowser keeps the DOM builder as a single bundled script. WebSurfer splits the same logic into a bootstrap file plus modular helper files.

The WebSurfer bootstrap is small and only wires the modules together:

- [chrome-extension/public/buildDomTree.js](chrome-extension/public/buildDomTree.js#L1-L40)

That modular structure improves maintainability, but it also means more script files must be parsed and initialized before the DOM tree can be built.

### C. Core traversal logic

The traversal behavior itself is effectively the same:

- walk body, nested frames, text nodes, and interactive elements
- compute highlight indices
- build selector maps
- clear caches after execution

So the traversal algorithm is not the main differentiator; the injection and bootstrap split is.

---

## Most Likely Reasons for Performance Degradation

### 1. Multi-file DOM builder injection

WebSurfer now injects more files per page/frame than nanobrowser.

Impact:

- more script parsing
- more module initialization work
- more potential overhead across all frames
- more cold-start cost on the first DOM snapshot

This is the strongest candidate for the slowdown.

### 2. Repeated browser measurement APIs

The DOM builder repeatedly calls expensive APIs such as:

- `getBoundingClientRect()`
- `getClientRects()`
- `getComputedStyle()`
- `elementFromPoint()`
- `checkVisibility()`
- `Range.getClientRects()`

These are visible in the current WebSurfer DOM helpers:

- [chrome-extension/public/dom/cache.js](chrome-extension/public/dom/cache.js#L1-L40)
- [chrome-extension/public/dom/helpers.js](chrome-extension/public/dom/helpers.js#L59-L63)
- [chrome-extension/public/dom/helpers.js](chrome-extension/public/dom/helpers.js#L197-L208)
- [chrome-extension/public/dom/interactivity.js](chrome-extension/public/dom/interactivity.js#L184-L208)

These calls are not new, but they remain a major cost center on large pages.

### 3. Full DOM reconstruction on state fetch

Every state refresh rebuilds a tree, reassigns indices, and re-evaluates frame content.

Relevant code:

- [chrome-extension/src/background/browser/dom/service.ts](chrome-extension/src/background/browser/dom/service.ts#L101-L175)
- [chrome-extension/src/background/browser/dom/service.ts](chrome-extension/src/background/browser/dom/service.ts#L221-L315)

This becomes expensive on pages with many nodes or nested frames.

### 4. Highlight overlay and listener overhead

Each highlighted element may create overlays, labels, and scroll/resize listeners.

- [chrome-extension/public/dom/highlighting.js](chrome-extension/public/dom/highlighting.js#L1-L200)

This is a second-order cost, but it becomes noticeable when many interactive elements are present.

### 5. History hashing for remapping

Recovery uses SHA-256 hashing over element structure and attributes.

- [chrome-extension/src/background/browser/dom/history/service.ts](chrome-extension/src/background/browser/dom/history/service.ts#L29-L97)

This is useful for resilience, but it adds work during stale-node recovery.

---

## What Is Not the Cause

The following architecture-note claims are not implemented in the current codebase:

- persistent semantic fingerprints on every node
- fuzzy semantic recovery / `fuzzy_match_search`
- a hash based on `tagName + role + ariaLabel + truncatedText + parentStructure`

So those ideas should not be treated as the current performance bottleneck.

---

## Conclusion

The current WebSurfer DOM system is functionally close to nanobrowser, but the main performance risk is the split DOM builder injection model.

### Ranked likely causes of slowdown

1. multi-file DOM builder injection in WebSurfer
2. repeated geometry and visibility measurements
3. full tree reconstruction across frames
4. highlight overlay management
5. history-hash recovery work

If the goal is to explain the regression without changing code, the safest conclusion is:

> WebSurfer likely slowed down mainly because it changed the DOM builder delivery model from one bundled script to multiple injected scripts, while keeping the same expensive measurement-heavy traversal logic.

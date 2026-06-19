# Specification: DOM Subsystem Engineering & Performance Optimization Architecture

This specification details the architectural blueprints and low-level code solutions to address structural DOM extraction latency, shadow DOM visibility gaps, cross-origin frame isolation, and dynamic rerendering stutter in WebGenie.

---

## 1. Subsystem Engineering Blueprint: DOM Core Challenges

```
                                [ BROWSER VIEWPORT ]
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
      ┌────────────────────┐                          ┌────────────────────┐
      │     SHADOW DOM     │                          │    CROSS-ORIGIN    │
      │  (Recursive open   │                          │      IFRAMES       │
      │   root traversal)  │                          │  (CDP Frame Tree)  │
      └──────────┬─────────┘                          └──────────┬─────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         │
                                         ▼
                              ┌────────────────────┐
                              │  STABILITY ENGINE  │
                              │ (Debounced Mutate) │
                              └──────────┬─────────┘
                                         │
                                         ▼
                              ┌────────────────────┐
                              │ HYBRID CONTROLLER  │
                              │ (CDP / Content JS) │
                              └────────────────────┘
```

### A. Shadow DOM Traversal Solution
*   **The Problem**: Standard browser scraper scripts rely on `document.querySelectorAll('*')` or native tree-walkers, which are blind to elements nested inside Shadow Roots. This renders the agent blind to modern component libraries (e.g., Salesforce Lightning, custom web components) where key inputs and buttons are encapsulated.
*   **The Solution**: Implement a **Recursive Shadow-Open Tree-Walker** in the injected page content script. It recursively inspects each element's `.shadowRoot` property and flattens the open shadow trees into the serialized output tree:
    
    ```javascript
    function walkDOM(root, elementList = []) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let currentNode = walker.currentNode;
      
      while (currentNode) {
        elementList.push(currentNode);
        
        // Inspect Shadow Root
        if (currentNode.shadowRoot && currentNode.shadowRoot.mode === 'open') {
          walkDOM(currentNode.shadowRoot, elementList);
        }
        
        currentNode = walker.nextNode();
      }
      return elementList;
    }
    ```
    
    This guarantees that nested interactive fields (such as login inputs and custom toggle switches) are fully captured in the agent's accessibility mappings.

### B. Same-Origin & Cross-Origin Iframe Routing
*   **The Problem**: Web pages frequently embed sub-pages via `<iframe>` nodes. If an iframe is same-origin, a content script can query its children via `iframe.contentDocument`. However, if the iframe is cross-origin (e.g., Stripe credit card fields, Google ReCAPTCHA), the browser's Same-Origin Policy (SOP) blocks all JavaScript queries from the host page, leaving the agent blind.
*   **The Solution**: Establish a **CDP-Driven Frame Tree Coordinator**. Instead of relying on a single content script injection, WebGenie must coordinate extraction across multiple execution frames using the Chrome DevTools Protocol (`Page.getFrameTree`):
    1.  Query the browser CDP for all frame IDs and their associated targets.
    2.  For each frame, check accessibility nodes and generate localized selectors.
    3.  When executing actions, use the target Frame ID to switch context before dispatching event coordinates.
    
    ```typescript
    async function executeInFrameContext(page: Page, frameId: string, action: () => Promise<void>) {
      const frame = page.frames().find(f => f.name() === frameId || f.url().includes(frameId));
      if (!frame) {
        throw new Error(`Target frame context ${frameId} not found.`);
      }
      await frame.evaluate(action);
    }
    ```

### C. MutationObserver Stability Engine (Throttling Stutter)
*   **The Problem**: Single-page applications continuously rewrite the DOM due to animations, data polling, and dynamic asset loading. Extracting the page state too quickly yields incomplete layouts, while extracting too slowly introduces unacceptable latency.
*   **The Solution**: Implement a **Debounced Page-Stability Engine** using native browser MutationObservers.
    -   Observe child list modifications, subtree changes, and attribute updates.
    -   **Debounce Window**: Keep a sliding window of `300ms`. If a mutation occurs, reset the timer.
    -   **Telemetry Bypass**: If mutations continue for >`1500ms` (indicating an infinite loop loading animation), bypass the stability lock and capture the DOM, flagging elements as `stale: true`.
    
    ```javascript
    function waitForStability(timeoutMs = 1500, debounceMs = 300) {
      return new Promise((resolve) => {
        let timer;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(onStable, debounceMs);
        });
        
        const timeout = setTimeout(() => {
          observer.disconnect();
          resolve(); // Fallback on infinite dynamic mutations
        }, timeoutMs);
        
        function onStable() {
          clearTimeout(timeout);
          observer.disconnect();
          resolve();
        }
        
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        timer = setTimeout(onStable, debounceMs);
      });
    }
    ```

---

## 2. Content Scripts vs. CDP Performance Tradeoff & Routing

To maximize extraction speeds and minimize main-thread locking, WebGenie must implement a hybrid DOM traversal router.

### Performance Analysis Matrix

| Feature | Injected Content Scripts | Chrome DevTools Protocol (CDP) |
| :--- | :--- | :--- |
| **Execution Latency** | **Fast (Sub-10ms)**; direct memory access to document objects. | **Slower (50-200ms)**; JSON-RPC WebSocket communication. |
| **Sandbox Isolation** | Injected scripts are blocked from page variables (except via DOM). | Complete environment access; bypasses page sandbox. |
| **Security (CSP) Blocks** | Can be blocked by strict page Content Security Policies. | **Bypasses CSP**; runs at the browser privilege level. |
| **Iframe Boundaries** | Blocked by same-origin rules on cross-domain frames. | **Cross-frame transparent**; queries the entire process tree. |
| **Thread Impact** | Blocks page UI paint cycles if serialization is heavy. | Executed asynchronously in browser background process. |

### Hybrid Execution Routing Strategy
1.  **Fast Path (Standard Navigation)**: Use **Content Scripts** for page stability queries, scroll execution, and basic UI mutation observations to maintain low latency.
2.  **Privileged Path (AXTree Extraction)**: Use **CDP (`Accessibility.getFullAXTree`)** to retrieve the accessibility tree. This bypasses CSP restrictions and guarantees same-origin and cross-origin iframe structures are extracted together.
3.  **Visual Verification**: Combine CDP screenshot buffers with coordinate offsets returned from content script boundary calculations.

---

## 3. High-Performance Element Selector & Identity Caching

To ensure selectors survive dynamic page rerenders and structure shifts:

### A. Element Coordinate Anchoring
*   Instead of locating elements using hardcoded indices (which shift) or absolute XPaths (which break on layout redesigns), Navigator targets elements using **Relative Anchor Selector Signatures**.
*   **Coordinate Anchors**: Identify stable parent nodes (e.g. elements with unique, immutable IDs like `#header` or `#nav-bar`) and calculate target positions relative to their coordinates.
*   **Dynamic Healing**: If the target XPath fails:
    1.  Locate the closest sibling element with a stable selector signature.
    2.  Use the sibling's visual boundary coordinates to scan a `100px` radius for the target element.
    3.  Re-bind the new XPath and update the local registry.

---

## 4. Implementation Roadmap

### Sprint 1: Shadow DOM & IFrame Extraction
*   Deploy recursive shadow tree walking in page scripts.
*   Integrate Playwright CDP context switching to resolve cross-origin frame coordinates.

### Sprint 2: Stability Engine & Debouncing
*   Deploy the `waitForStability` helper before taking page snapshots.
*   Enable telemetry bypass rules to handle infinite animated loops.

### Sprint 3: Hybrid Routing
*   Implement CDP AXTree serialization for primary page trees, using Content Scripts for low-latency element coordinate updates.

# WebGenie SOTA Agent Architecture: Block-by-Block Web Research & Integration Blueprint

This document provides a highly detailed, component-level analysis of the state-of-the-art (SOTA) patterns in modern browser agent design based on global web research. It details how WebGenie's 8 core modules can be upgraded using patterns from leading frameworks like **Stagehand (v3)**, **Patchright / Camoufox**, **browser-use**, **Skyvern**, **Tarsier**, **Letta (MemGPT)**, **Mem0**, and **VizLang**.

---

## 1. Executive Summary of SOTA Landscape

Modern browser agents have transitioned from script-like sequential loops to **cognitive systems** that operate directly via DevTools protocols, employ visual-semantic observation spaces, and manage memory like an operating system. The blueprint below illustrates the target architecture:

```mermaid
graph TD
    subgraph Cognitive Layer (FSM & Memory)
        M1[Module 1: Executor FSM] <--> M7[Module 7: Tiered Memory Manager]
        M1 <--> Critic[Critic Validator Agent]
    end
    
    subgraph Browser Management
        M1 --> M2[Module 2: Profile & Session Manager]
        M2 --> M3[Module 3: CDP Page Agent]
    end
    
    subgraph DOM & Tooling
        M3 --> M4[Module 4: AXTree DOMBuilder]
        M4 --> M7
        M1 --> M5[Module 5: JIT Tool Registry]
        M5 --> M6[Module 6: Human-Like Action Handlers]
        M6 --> M3
    end
    
    subgraph Telemetry
        M1 --> M8[Module 8: Visual Timeline & Inspector]
    end
```

---

## 2. Component-by-Component SOTA Analysis & Blueprints

---

### Module 1: Execution Loop FSM (`Executor`)

#### Current WebGenie Implementation
* Uses a sequential loop that alternates between a Planner agent (setting sub-goals) and a Navigator agent (generating step-by-step actions) until a step limit or failure threshold is reached.

#### Global SOTA Web Research Findings
* **Skyvern's Planner-Actor-Validator Loop**: Skyvern decouples execution into three distinct actors: a Planner that breaks down the task, an Actor that executes steps, and a Validator (Critic) that audits results using visual differences and DOM delta analysis.
* **Tree-of-Thoughts (ToT) Backtracking**: Modern agents do not just retry on error. When a failure is validated, the FSM halts, reverts the browser page context to a cached "known-good" checkpoint, and forces the planner to choose an alternative branch, preventing loop deadlocks.

#### WebGenie Advanced Integration Blueprint
* **The Pattern**: Introduce an explicit **Critic Validator** step and a **Checkpoint Stack** inside the loop FSM to handle automated page rollbacks.

```typescript
export interface Checkpoint {
  stepIndex: number;
  goal: string;
  tabId: number;
  historySnapshotId: string; // references CDP history savepoint
  plannerContext: string;
}

export class SOTAExecutorFSM {
  private checkpoints: Checkpoint[] = [];

  async runLoop(task: string): Promise<void> {
    await this.planner.initialize(task);
    
    while (!this.shouldStop()) {
      const currentGoal = this.planner.getActiveGoal();
      
      // 1. Capture checkpoint before executing complex state modifications
      if (this.planner.isCheckpointRequired()) {
        const snapshotId = await this.context.createBrowserSnapshot();
        this.checkpoints.push({
          stepIndex: this.stepCount,
          goal: currentGoal,
          tabId: this.context.getActiveTabId(),
          historySnapshotId: snapshotId,
          plannerContext: this.planner.serializeState()
        });
      }

      // 2. Navigator Action Dispatch
      const actionResult = await this.navigator.executeGoal(currentGoal);
      
      // 3. SOTA Validator / Critic Phase
      const validation = await this.critic.validate(
        currentGoal, 
        actionResult.preSnapshot, 
        actionResult.postSnapshot
      );

      if (validation.status === 'FAILED') {
        logger.error(`Validation failed: ${validation.reason}. Backtracking...`);
        await this.rollbackToLastValidCheckpoint();
      } else {
        this.stepCount++;
      }
    }
  }

  private async rollbackToLastValidCheckpoint(): Promise<void> {
    const lastCheckpoint = this.checkpoints.pop();
    if (!lastCheckpoint) {
      throw new Error("No checkpoints available to backtrack");
    }
    await this.context.restoreBrowserSnapshot(lastCheckpoint.historySnapshotId);
    this.planner.restoreState(lastCheckpoint.plannerContext);
    this.planner.blacklistPath(lastCheckpoint.goal, "Attempted action failed validation");
  }
}
```

---

### Module 2: Browser Context Manager (`BrowserContext`)

#### Current WebGenie Implementation
* Tracks tab IDs and maps them to local page wrappers. Uses a promise-based mutex to prevent concurrent creation errors when launching context pages.

#### Global SOTA Web Research Findings
* **Persistent Contexts & Directory Isolation**: In Playwright and CDP, spawning ephemeral contexts causes cookie loss on restarts. SOTA web systems launch separate instances via `launchPersistentContext(userDataDir)` to preserve session cache, cookies, and local storage.
* **CDP Remote Rehydration**: Cloud-scale agents use persistent WebSocket remote debugging ports (`connectOverCDP`) to remain resilient against extension crashes. If the background process dies, the manager reconnects to the active debugging session and rehydrates tab states instantly.

#### WebGenie Advanced Integration Blueprint
* **The Pattern**: Implement profile-directory-mapped context launchers that serialize `storageState` and synchronize `sessionStorage` alongside cookies.

```typescript
export class SOTABrowserContextManager {
  private activeProfiles = new Map<string, string>(); // maps workspaceId to userDataDir

  async getContextForWorkspace(workspaceId: string): Promise<chrome.debugger.Debuggee> {
    let profileDir = this.activeProfiles.get(workspaceId);
    if (!profileDir) {
      profileDir = `/home/manas/.gemini/antigravity/profiles/${workspaceId}`;
      this.activeProfiles.set(workspaceId, profileDir);
    }
    
    // Setup clean isolation container with dedicated cookie-jars and storage states
    await this.loadWorkspaceCookies(workspaceId);
    return { tabId: this.getCurrentTabId() };
  }

  async serializeSession(workspaceId: string): Promise<void> {
    const cookies = await chrome.cookies.getAll({});
    const storageData = await this.extractPageLocalStorage();
    
    await chrome.storage.local.set({
      [`profile_${workspaceId}_cookies`]: cookies,
      [`profile_${workspaceId}_storage`]: storageData
    });
  }
}
```

---

### Module 3: Page Agent (`Page`)

#### Current WebGenie Implementation
* Employs content script injections (`buildDomTree`) and executes document selectors inside the page window. Retries element clicks if nodes detach.

#### Global SOTA Web Research Findings
* **Pure CDP WebSocket Control (Stagehand v3)**: Stagehand completely removed client-side script execution (bypassing testing wrappers like Playwright/Puppeteer) in favor of raw DevTools Protocol (CDP) WebSocket commands.
* **CSP Bypassing**: Pages with strict Content Security Policies (CSP) block content scripts from injecting custom visual overlay structures or script files. By utilizing debugger commands (e.g. `Fetch` domain, `Page.addScriptToEvaluateOnNewDocument`), agents intercept network requests, remove CSP response headers, and inject utilities safely from the browser system layer.

#### WebGenie Advanced Integration Blueprint
* **The Pattern**: Zero client-side JS injections. All DOM queries and overlays are controlled via native DevTools debugger domain calls.

```typescript
export class SOTAPageAgent {
  private tabId: number;

  async initStealthMode(): Promise<void> {
    // Enable debugger target
    await chrome.debugger.attach({ tabId: this.tabId }, '1.3');
    
    // Bypasses CSP by stripping security headers on the fly
    await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.enable', {
      patterns: [{ urlPattern: '*', resourceType: 'Document' }]
    });
    
    chrome.debugger.onEvent.addListener(async (source, method, params: any) => {
      if (source.tabId === this.tabId && method === 'Fetch.requestPaused') {
        const responseHeaders = params.responseHeaders || [];
        // Filter out strict security policies
        const cleanHeaders = responseHeaders.filter(
          (h: any) => !['content-security-policy', 'x-frame-options'].includes(h.name.toLowerCase())
        );
        await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: cleanHeaders
        });
      }
    });
  }
}
```

---

### Module 4: DOM Tree & Selector Map (`DOMBuilder`)

#### Current WebGenie Implementation
* Scrapes the full HTML tree via content scripts, flattens elements into a numeric string list, and maps element indexes to XPaths for browser actions.

#### Global SOTA Web Research Findings
* **Accessibility Tree (AXTree) Dominance**: Stagehand and browser-use utilize the `Accessibility.getFullAXTree` CDP protocol. Since screen-reader trees only expose interactive and content-carrying nodes (buttons, inputs, status fields) and strip layouts (wrapper divs, spans), the representation is **10x–15x smaller** than raw HTML, drastically reducing token usage and model confusion.
* **Tarsier Visual ID Tagging**: Tarsier takes a screenshot, overlays visual coordinate tag boxes (e.g. `[14]`) onto interactable elements, and presents the annotated screenshot alongside the parsed semantic AXTree.
* **Goal-Aware DOM Masking**: Prunes irrelevant sections of the AXTree that do not match keywords in the active sub-goal.

```
Raw DOM Node -> Deeply nested structure
  └─ div.nav-container -> div.sidebar -> div.menu-item -> a href="/billing"
  
Accessibility Node -> Clean semantic representation
  └─ link role="link" name="Billing & Subscription" bounds=[x, y, w, h]
```

#### WebGenie Advanced Integration Blueprint
* **The Pattern**: Combine native CDP `AXTree` extraction with goal-aware keyword pruning and coordinate-tagging overlays.

```typescript
export class SOTADOMBuilder {
  async buildSemanticAXTree(tabId: number, goal: string): Promise<DOMState> {
    // 1. Fetch full AXTree natively from Chromium
    const axResponse = await cdpBridge.send<any>(tabId, 'Accessibility.getFullAXTree', {});
    
    // 2. Parse AXTree into interactive nodes
    const interactiveNodes = this.filterInteractiveAXNodes(axResponse.nodes);
    
    // 3. Apply Goal-Aware Masking
    const goalKeywords = this.extractKeywords(goal);
    const maskedNodes = interactiveNodes.filter(node => 
      this.isNodeRelevantToGoal(node, goalKeywords)
    );
    
    return this.buildSelectorMap(maskedNodes);
  }

  private filterInteractiveAXNodes(nodes: any[]): any[] {
    // Keeps only nodes with valid roles (button, textfield, combobox, link)
    const interactiveRoles = ['button', 'link', 'checkbox', 'combobox', 'textbox', 'listbox'];
    return nodes.filter(n => n.role && interactiveRoles.includes(n.role.value));
  }
}
```

---

### Module 5: Action Registry (`NavigatorActionRegistry`)

#### Current WebGenie Implementation
* Maintains a static list of all browser tools defined as Zod schemas and injects all tool descriptions into the prompt at every step.

#### Global SOTA Web Research Findings
* **Context-Sensitive Action Masking**: Constrains the available action space dynamically. SOTA agents do not expose input or key-typing tools if no active text field is present in the current DOM state, and hide tab management actions during simple page navigation.
* **LLM Tool Routing (LangGraph)**: Utilizes a routing node that maps intent to tool clusters (e.g., separating "Data Extraction" tools from "Navigation" tools), preventing tool description bloat from saturating context budgets.

#### WebGenie Advanced Integration Blueprint
* **The Pattern**: JIT Action filtering matching active DOM node requirements before tool schema compilation.

```typescript
export class SOTANavigatorActionRegistry {
  private allTools = new Map<string, ActionSchema>();

  getToolsForState(domState: DOMState): ActionSchema[] {
    const tools: ActionSchema[] = [this.allTools.get('wait')!, this.allTools.get('done')!];

    // Dynamically inject tools based on DOM elements available on the active page
    const hasInputs = Array.from(domState.selectorMap.values()).some(
      node => node.tagName === 'INPUT' || node.tagName === 'TEXTAREA'
    );
    
    if (hasInputs) {
      tools.push(this.allTools.get('input_text')!);
      tools.push(this.allTools.get('send_keys')!);
    }

    if (this.hasDropdowns(domState)) {
      tools.push(this.allTools.get('select_dropdown_option')!);
    }

    return tools;
  }
}
```

---

### Module 6: Action Handlers

#### Current WebGenie Implementation
* Triggers clicks and keyboard events using synthetic Puppeteer/Webdriver wrappers directly.

#### Global SOTA Web Research Findings
* **Bot-Detection Stealth (Patchright / Camoufox)**: Modern systems (Cloudflare, Akamai, Datadome) flag synthetic events that lack human-like kinetic behaviors. 
* **Bezier Trajectories**: Clicks must interpolate cursor coordinates along randomized **Bezier curves** (simulating mouse speed and acceleration profiles).
* **Keyboard Typing Jitter**: Emulates variable delays (50ms–200ms) between keystrokes to mimic human typing and avoid trigger-happy bot detection.

#### WebGenie Advanced Integration Blueprint
* **The Pattern**: Dispatch inputs via native CDP input events, interpolating mouse coordinate movements with Bezier paths.

```typescript
export class SOTAActionHandlers {
  async humanClick(tabId: number, x: number, y: number): Promise<void> {
    const startX = this.currentX;
    const startY = this.currentY;
    
    // 1. Generate Bezier Curve points
    const path = this.interpolateBezierPath(startX, startY, x, y);
    
    // 2. Dispatch Mouse Move events along path with randomized micro-delays
    for (const point of path) {
      await cdpBridge.send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y
      });
      await this.delay(Math.random() * 5 + 2);
    }
    
    // 3. Mouse Down & Up
    await cdpBridge.send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x, y,
      button: 'left',
      clickCount: 1
    });
    await this.delay(Math.random() * 80 + 40); // hold click duration
    await cdpBridge.send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y,
      button: 'left',
      clickCount: 1
    });

    this.currentX = x;
    this.currentY = y;
  }
}
```

---

### Module 7: Memory & Context Manager (`AgentContext`)

#### Current WebGenie Implementation
* Maintains a flat, linear array of historical messages, slicing them by characters if they overflow the token budget.

#### Global SOTA Web Research Findings
* **Letta (MemGPT) Memory Paging**: Splits memory into L1 (Working - live page state), L2 (Trace - last 3-5 steps), and L3 (Milestone - compressed summaries of past phases). Writes are budget-enforced at runtime, preventing JSON truncation corruption.
* **Mem0 Multi-Store & Selector Caching**: Stores selector patterns, layout fingerprints, and intents in a local KV store. When returning to a known domain (e.g. GitHub, Gmail), it retrieves cached successful selectors, bypassing expensive LLM calls and executing actions in sub-100ms.
* **A-MEM Zettelkasten Graphs**: Connects memories as a semantic knowledge graph (linking intent notes dynamically) for multi-hop retrieval.

```
┌────────────────────────────────────────────────────────┐
│                   MEMORY PYRAMID                       │
│                                                        │
│   Level 1: Working Memory (Live Viewport AXTree)       │
│   Budget: 4,000 tokens                                 │
│                                                        │
│   Level 2: Rolling Traces (Last 3 Action Results)      │
│   Budget: 1,000 tokens                                 │
│                                                        │
│   Level 3: Compacted Milestones (Phase Summaries)      │
│   Budget: 500 tokens                                   │
 └────────────────────────────────────────────────────────┘
```

#### WebGenie Advanced Integration Blueprint
* **The Pattern**: Implement a three-tiered context compiler with write-time token checks and a persistent, domain-indexed selector cache.

```typescript
export class SOTAMemoryManager {
  private activeTrace: string[] = [];
  private milestones: string[] = [];
  
  compilePromptContext(domSnapshot: string): string {
    const l1 = `[Current DOM]:\n${domSnapshot}`;
    const l2 = `[Step Trace (Last 3 Steps)]:\n${this.activeTrace.slice(-3).join('\n')}`;
    const l3 = `[Milestones Complete]:\n${this.milestones.join('\n')}`;
    
    // Ensure strict budget constraints
    return `${l3}\n\n${l2}\n\n${l1}`;
  }

  async compactTrace(): Promise<void> {
    if (this.activeTrace.length >= 5) {
      // Compress oldest steps using on-device LLM
      const summary = await this.onDeviceSummarizer(this.activeTrace.slice(0, 3));
      this.milestones.push(summary);
      this.activeTrace = this.activeTrace.slice(3);
    }
  }
}
```

---

## Module 8: Logger & Test Panel

### Current WebGenie Implementation
* Writes structural execution logs to service-worker consoles and a debugging dashboard.

### Global SOTA Web Research Findings
* **VizLang / LangGraph Tracing**: Renders visual state graphs showing active nodes, step durations, and execution routes side-by-side.
* **WebPerf / Trace Viewers**: Observes DOM mutations, CPU long-tasks, and screenshot diffs in real-time, providing developers with immediate visual feedback of the agent's actions.

### WebGenie Advanced Integration Blueprint
* **The Pattern**: Stream structured step logs and screenshot buffers directly to a custom Side-Panel UI with an interactive visual step timeline.

---

## 3. Integration & Evolution Roadmap

To transition WebGenie to this SOTA architecture, implementation should proceed in four focused phases:

1. **Phase 1: Pure CDP Integration** (Migrate `Page` to native debugger connections, eliminating content script dependencies).
2. **Phase 2: Semantic AXTree** (Rebuild `DOMBuilder` to parse Accessibility trees and apply goal-aware masking).
3. **Phase 3: Stealth Inputs** (Implement Bezier cursor movements and randomized typing latency in action handlers).
4. **Phase 4: Memory Pyramid & Cache** (Build Letta-style tiered memory compaction and Mem0-style local selector caches).

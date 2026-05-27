# WebGenie Repository Evolution Blueprint
## Part 1 of 3: Architecture Review & Capability Inventory

---

## 1. Executive Summary

WebGenie is a production-grade Chrome extension browser agent with a dual-agent architecture (Planner + Navigator), native tab orchestration, and a Chrome-scripting-based DOM layer. It is architecturally sound and competitive with nanobrowser — and is already superior in the multi-tab orchestration dimension. However, it has meaningful gaps in agent intelligence, memory, reliability, and DOM richness that limit its performance on complex, long-horizon tasks like Gmail automation.

**Current Strengths:**
- Dual-agent separation (Planner strategic / Navigator tactical) — industry best practice
- Extension-native DOM: `chrome.scripting.executeScript` works regardless of CDP state
- `_validWebPage` + `_revalidateFromTab()` — authoritative URL tracking via `chrome.tabs.get`
- Tab group orchestration per task — unique capability not present in any reference repo
- Activity engine + WorkflowStage visual feedback — production UX
- History replay system — deterministic task re-execution
- Robust error classification (AuthError, RateLimitError, URLNotAllowedError)

**Primary Gaps:**
- Navigator lacks `evaluation_previous_goal` self-reflection → agent silently continues after failures
- No mutable working memory field → long tasks lose context coherence
- No task completion verification gate → false-positive done signals
- No popup/dialog watchdog → unexpected dialogs silently block the agent
- DOM layer: no AX (accessibility tree) enrichment, no hidden-element hints
- No selector caching → every interaction requires full DOM scan + LLM resolution
- No message compaction → long tasks overflow context window
- Loop detection is coarse (exact output match) → misses semantic loops

---

## 2. Architecture Review

### 2.1 System Map

```
chrome-extension/src/background/
├── index.ts                      ← Service worker bootstrap + event wiring
├── agent/
│   ├── executor.ts               ← Outer orchestration loop
│   ├── agents/
│   │   ├── planner.ts            ← Strategic agent (goal tracking)
│   │   ├── navigator.ts          ← Tactical agent (page interaction)
│   │   └── base.ts               ← Shared BaseAgent
│   ├── actions/
│   │   ├── builder.ts            ← Wires browser actions to agent registry
│   │   └── schemas.ts            ← Zod schemas for all actions
│   ├── prompts/
│   │   ├── planner.ts            ← PlannerPrompt (system + user message builders)
│   │   └── navigator.ts          ← NavigatorPrompt
│   ├── messages/service.ts       ← MessageManager (context window management)
│   └── event/                    ← EventManager, typed events, Actors, ExecutionState
├── browser/
│   ├── context.ts                ← BrowserContext (tab lifecycle manager)
│   ├── page.ts                   ← Page (Puppeteer + chrome.scripting abstraction)
│   ├── dom/
│   │   ├── service.ts            ← getClickableElements, getMarkdownContent
│   │   ├── views.ts              ← DOMElementNode, DOMState types
│   │   └── history/service.ts    ← HistoryTreeProcessor (element history tracking)
│   └── util.ts                   ← isNewTabPage, isUrlAllowed
└── core/
    ├── activity-engine/engine.ts ← AgentEvent → WorkflowStage translator
    ├── tab-orchestrator/         ← Task→tab assignment + chrome.tabGroups management
    ├── tab-registry/             ← Tracks per-tab metadata (state, purpose, workflowStage)
    └── task-groups/manager.ts    ← Chrome tab group CRUD

packages/storage/
└── lib/tab-orchestration/store.ts ← Zustand store for tab orchestration UI state

pages/side-panel/                 ← React UI (chat, AgentSight, TabOrchestrator panel)
pages/options/                    ← Settings page
```

---

### 2.2 Executor (`agent/executor.ts`)

**Purpose**: The outermost orchestration loop. Manages the planner-navigator cycle.

**Responsibilities:**
- Initializes Planner, Navigator, MessageManager, EventManager, ActionBuilder
- Runs the main `for(step...)` loop up to `maxSteps`
- Decides when to invoke Planner (`shouldRunPlanning`)
- Invokes Navigator for execution
- Handles pause/stop/error states
- Emits final `TASK_OK / TASK_FAIL / TASK_CANCEL` events
- Stores replay history if `replayHistoricalTasks` is enabled

**Design:**
```typescript
for (step = 0; step < allowedMaxSteps; step++) {
    if (await this.shouldStop()) break;
    
    if (this.shouldRunPlanning(step, navigatorDone)) {
        latestPlanOutput = await this.runPlanner();
        if (planOutput.result?.done) break;  // Planner-confirmed done
    }
    
    navigatorDone = await this.navigate();
    // Navigator done → next planner run will validate
}
```

**Strengths:**
- Clean separation of planning vs execution cadence
- `shouldRunPlanning` logic handles: step-0 (always plan), navigator-done (validate), stall (every N steps)
- `consecutiveFailures` counter triggers `MaxFailuresReachedError` before max_steps
- Pause/resume support via `this.context.paused` polling

**Architectural Constraints:**
- **No verification before accepting `done`**: When planner says `done=true`, execution stops immediately. No independent page-state check confirms the task actually succeeded.
- **`consecutiveFailures` resets on any success**: A failure followed by a trivial success resets the counter, potentially masking persistent underlying issues.
- **No per-step timeout**: A single Navigator step can hang indefinitely (waiting for a dialog, for example) with no escape mechanism.

**Scalability Considerations:**
- Single-threaded (JS service worker). Multi-task concurrency requires separate Executor instances, each with separate BrowserContexts. The current design supports this via TabOrchestrator's per-task tab assignment.

---

### 2.3 Planner (`agent/agents/planner.ts`)

**Purpose**: Strategic re-orientation agent. Answers "what is the overall state of this task and what should the navigator do next?"

**Design:**
```typescript
interface PlannerOutput {
    observation: string;  // Current page state assessment
    thought: string;      // Internal reasoning
    response: string;     // Sub-goal for navigator (injected into navigator's system prompt)
    done: boolean;        // Task completion signal
    final_answer?: string;
}
```

**Run cadence (executor.ts `shouldRunPlanning`):**
```typescript
if (step === 0) return true;                                // Always plan first
if (navigatorDone) return true;                            // Validate completion
if (stepsSinceLastPlan >= planningInterval) return true;   // Periodic cadence
if (hasRecentProgressStall()) return true;                 // Exact-match loop detected
```

**Strengths:**
- Planner sees the full state (DOM + screenshot) before replanning
- `response` field becomes the navigator's sub-goal, injected into system context
- `hasRecentProgressStall` catches repetitive navigator behavior

**Architectural Constraints:**
- **Planner `done=true` is unverified**: The planner relies on DOM state and message history to judge completion. It cannot independently verify that the action actually succeeded (e.g., "email was sent" vs "compose window still open").
- **No planning memory**: The planner receives the current message window but has no scratchpad to accumulate task-level notes across planning cycles.
- **Static planning interval**: `planningInterval` is fixed. No adaptive cadence based on task complexity or navigator confidence.

---

### 2.4 Navigator (`agent/agents/navigator.ts`)

**Purpose**: Tactical execution agent. Selects which browser actions to execute each step.

**Output schema (NavigatorOutput):**
```typescript
interface NavigatorOutput {
    current_state: {
        evaluation_previous_goal: string;  // Exists in prompt schema...
        memory: string;                    // ...but not currently propagated
        next_goal: string;
    };
    action: AgentAction[];
}
```

> ⚠️ **Critical Gap**: `evaluation_previous_goal` and `memory` ARE in the prompt schema (the LLM generates them) but the executor does NOT extract and propagate them. The LLM writes to these fields every step, but the system reads only `action[]` and `done`. The self-reflection and memory exist at the LLM level but are silently discarded.

**Execution flow:**
```
prepareExecution()
  → addStateMessageToMemory()      (DOM + screenshot + action results)
  → invoke(messages)               (LLM call with structured output)
  → normalizeActions(output.action)
  → doMultiAction(actions)         (execute browser actions sequentially)
  → finalizeExecution()            (push to history)
```

**Multi-action safeguards (in `doMultiAction`):**
- `done` cannot be chained with other actions in the same step
- Between actions, checks if DOM changed significantly (branch path hash comparison)
- Max 3 action errors before aborting the step
- 1000ms delay between actions (prevents race conditions)

**Strengths:**
- Structured output with JSON schema validation + multiple fallback parsers (raw content, tool_calls)
- Branch path hash comparison catches unexpected page changes mid-step
- History replay via `executeHistoryStep` (with retries)
- Error classification pipeline in `handleAgentError`

**Architectural Constraints:**
- **`evaluation_previous_goal` silently discarded**: The most valuable self-reflection field is generated but never used.
- **`memory` field not carried forward**: Each step starts cold from the raw message window.
- **1000ms fixed delay**: Optimal for some sites (too slow for fast SPAs, too fast for slow sites).
- **`removeLastStateMessageFromMemory` on success**: State message is removed after each step and re-injected fresh. This prevents the model from referencing specific elements from the previous state.

---

### 2.5 BrowserContext (`browser/context.ts`)

**Purpose**: Tab lifecycle manager. Creates, tracks, and switches between Page objects.

**State:**
```typescript
_currentTabId: number | null         // Active tab for agent
_attachedPages: Map<tabId, Page>     // CDP-attached pages
```

**Key operations:**
- `getCurrentPage()` → returns the active Page (creates/attaches if needed)
- `_getOrCreatePage(tab, forceUpdate)` → Page factory with force-refresh support
- `navigateTo(url)` → `chrome.tabs.update` → `waitForTabEvents` → new Page
- `openTab(url)` → `chrome.tabs.create` → `waitForTabEvents` → new Page
- `switchTab(tabId)` → `chrome.tabs.activate` → force-recreate Page
- `waitForTabEvents(tabId, options)` → waits for `status=complete` (non-fatal timeout)

**Post-session fixes applied:**
- `waitForTabEvents` resolves on `status=complete` only (no more triple-AND race condition)
- Non-fatal timeouts in `openTab` and `navigateTo`
- `switchTab` forces `forceUpdate=true` to purge stale cached Pages
- `_revalidateFromTab()` promotes `_validWebPage` once tab has a real URL

**Architectural Constraints:**
- **No tab change listener**: `chrome.tabs.onUpdated` is not monitored outside of explicit `waitForTabEvents` calls. If the user manually navigates mid-task, `BrowserContext` does not detect it.
- **Single active page model**: The context tracks one `_currentTabId`. Multi-tab parallel execution would require a redesigned context.
- **No timeout on `getState()`**: If `_updateState()` hangs (e.g. on an infinitely loading page), the agent loop has no per-step escape.

---

### 2.6 Page (`browser/page.ts`)

**Purpose**: Encapsulates a single browser tab. Manages Puppeteer attachment, state caching, and all DOM/interaction operations.

**State machine:**
```
CREATED (from newtab URL)
  _validWebPage = false
  _puppeteerPage = null
  → _revalidateFromTab() → detects real URL → _validWebPage = true
  → attachPuppeteer() → _puppeteerPage = PuppeteerPage
  → getState() → _updateState() → selectorMap populated

CREATED (from real URL)
  _validWebPage = true (immediately)
  → attachPuppeteer() → immediate
  → getState() → ready
```

**`_updateState()` flow:**
```typescript
// 1. Get authoritative URL from chrome.tabs.get (NOT puppeteer.url())
const tab = await chrome.tabs.get(this._tabId);
const tabUrl = tab.url ?? this._state.url;

// 2. Take screenshot if useVision=true
if (useVision) screenshot = await this._puppeteerPage.screenshot();

// 3. Get DOM via chrome.scripting (NOT puppeteer evaluate)
const domState = await getClickableElements(tabId, tabUrl, ...);

// 4. Log DOM to console for debugging [DOM→LLM]
// 5. Update _state (url, title, domState, screenshot)
```

**Interaction methods:**
- `clickElementNode(node)` → locate by CSS → puppeteer click → fallback to `el.click()`
- `inputTextNode(node, text)` → locate → clear → type char by char
- `scrollContainer(direction)` → puppeteer scroll
- `locateElement(node)` → 3-tier: CSS selector → XPath → heuristic attributes

**Strengths:**
- Authoritative URL: `chrome.tabs.get` prevents `about:blank` false negatives
- `_revalidateFromTab()` handles newtab→real page promotion
- `refreshValidWebPage` is monotonically-promoting (never demotes)
- Multiple click fallback strategies
- Anti-detection scripts via `evaluateOnNewDocument`

**Architectural Constraints:**
- **`_waitForStableNetwork` with fixed thresholds**: 500ms idle window is right for most pages but too short for some SPAs.
- **No visual verification after click**: After `clickElementNode`, the agent doesn't verify whether the click had the expected effect before returning.
- **Heuristic locator is fragile for highly dynamic SPAs**: If text content and aria-label both change on navigation, all 3 tiers fail.

---

### 2.7 DOM Service (`browser/dom/service.ts`)

**Purpose**: Extracts the interactive element tree from the current page via `chrome.scripting`.

**Flow:**
```
getClickableElements(tabId, url, showHighlights, ...)
  → _buildDomTree(tabId, url, ...)
      → isNewTabPage(url) check → return empty tree
      → chrome.scripting.executeScript(tabId, buildDomTree.js)
          → injects buildDomTree.js (compiled JS bundle)
          → buildDomTree() walks DOM
          → assigns highlight indices [0], [1], [2]...
          → returns { elementTree, selectorMap }
      → parse RawDomTreeNode → DOMElementNode tree
      → return [elementTree, Map<index, DOMElementNode>]
```

**Capabilities:**
- Full DOM walk with visibility checking (bounding box, CSS display/visibility)
- Highlight overlays drawn directly in page (numbered labels)
- XPath + CSS selector per element
- Viewport expansion support (include slightly-off-screen elements)
- `getMarkdownContent` for text-heavy pages
- `getReadabilityContent` for article extraction

**Gaps:**
- No AX tree enrichment (no `aria-role`, semantic names from browser's accessibility engine)
- No shadow DOM traversal (custom elements break selector generation)
- No JS event listener detection (elements clickable only via JS, not `onclick` attribute, may be missed)
- No hidden element hints (elements below viewport threshold are silently excluded)
- No iframe content (cross-origin iframes not accessible)

---

### 2.8 Activity Engine (`core/activity-engine/engine.ts`)

**Purpose**: Translates agent execution events into UI-visible workflow stages.

**Design:**
```
AgentEvent → deriveWorkflowStage(event) → WorkflowStage
ExecutionState → tabOrchestrationStore.updateTabState()
                → broadcast AGENT_STATUS to content scripts
```

**WorkflowStage mapping:**
```
TASK_START / STEP_START (Planner) → PLANNING
ACT_START (type/fill)             → TYPING
ACT_START (click/scroll)          → CLICKING
ACT_START (navigate/goto)         → RESEARCHING
ACT_START (extract/read)          → COMPARING
ACT_ASK_HUMAN                     → WAITING
TASK_OK/STEP_OK                   → COMPLETED
TASK_FAIL/STEP_FAIL               → ERROR
TASK_CANCEL                       → IDLE
```

**Unique capability**: Each tab in the browser shows a glow animation that reflects the agent's current stage. The side panel TabOrchestrator UI mirrors this in real-time.

**Gap**: Stage inference from `details.includes('click')` is fragile string matching. If the action description changes format, stage detection breaks.

---

### 2.9 Tab Orchestrator + Tab Registry

**Tab Orchestrator** (`core/tab-orchestrator/`):
- Assigns tasks to specific tabs
- Creates Chrome tab groups (colored, named) per task
- Tracks `TabEntry`: `{ tabId, purpose, state: TabState, workflowStage }`
- Broadcasts cursor animation positions to content scripts

**Tab Registry** (`core/tab-registry/registry.ts`):
- In-memory `Map<tabId, TabEntry>`
- Source of truth for per-tab metadata
- Queried by ActivityEngine to update visual state

**This is WebGenie's most distinctive feature** — no reference repo has this level of multi-tab awareness. It enables:
- Visual per-tab state (IDLE / RESEARCHING / TYPING / COMPLETED / ERROR)
- Chrome tab group management (visual grouping in browser UI)
- Cross-task tab isolation

---

## 3. Capability Inventory

### Navigation Capabilities

| Capability | Status | Maturity |
|---|---|---|
| Navigate to URL | ✅ | High |
| Open new tab | ✅ | High |
| Switch tab | ✅ | High |
| Close tab | ✅ | Medium |
| Go back / Forward | ✅ | High |
| Wait for page load | ✅ | High (non-fatal timeouts) |
| Detect tab URL changes | ⚠️ Partial | Medium (only during explicit waits) |
| Handle redirects | ✅ | High |
| Cross-origin navigation | ✅ | High (fixed in this session) |

### Interaction Capabilities

| Capability | Status | Maturity |
|---|---|---|
| Click element by index | ✅ | High |
| Type text into input | ✅ | High |
| Scroll page | ✅ | High |
| Select dropdown option | ✅ | Medium |
| Handle checkboxes/radios | ✅ | Medium |
| Drag and drop | ❌ | Missing |
| Right-click / context menu | ❌ | Missing |
| Keyboard shortcuts | ⚠️ Partial | Low |
| File upload | ❌ | Missing |
| Handle popup dialogs | ❌ Missing watchdog | Critical gap |
| Handle CAPTCHAs | ❌ | Missing |

### Extraction Capabilities

| Capability | Status | Maturity |
|---|---|---|
| Interactive element tree | ✅ | High |
| Markdown page content | ✅ | Medium |
| Readability extraction | ✅ | Medium |
| Screenshot | ✅ | High |
| AX tree / semantic roles | ❌ | Missing |
| Structured data extraction | ❌ | Missing (no schema-driven extract) |
| Cross-frame content | ❌ | Missing |

### Planning & Intelligence

| Capability | Status | Maturity |
|---|---|---|
| Strategic planning | ✅ | High |
| Tactical execution | ✅ | High |
| Loop detection | ⚠️ Partial | Medium (exact match only) |
| Dynamic replanning | ✅ | Medium |
| Self-reflection | ❌ Generated but not used | Critical gap |
| Working memory | ❌ Generated but not used | Critical gap |
| Task completion verification | ❌ | Missing |
| Goal tracking | ✅ | Medium |

### Memory & Context

| Capability | Status | Maturity |
|---|---|---|
| Message window | ✅ | High |
| Action result memory | ✅ | Medium |
| Execution history | ✅ | High |
| History replay | ✅ | Medium |
| Mutable scratchpad | ❌ | Missing |
| Message compaction | ❌ | Missing |
| Cross-session memory | ❌ | Missing |
| Selector cache | ❌ | Missing |

### Recovery & Reliability

| Capability | Status | Maturity |
|---|---|---|
| Consecutive failure limit | ✅ | High |
| Non-fatal timeouts | ✅ | High (fixed this session) |
| Click fallbacks (3-tier) | ✅ | High |
| Page re-validation | ✅ | High |
| Popup auto-dismiss | ❌ | Missing |
| Fallback LLM | ❌ | Missing |
| Per-step timeout | ❌ | Missing |
| Stale handle recovery | ✅ | High |

---

*Continues in Part 2: Reliability Evolution, Planning Intelligence, Browser Intelligence, Memory & Context, Long-Horizon Tasks*

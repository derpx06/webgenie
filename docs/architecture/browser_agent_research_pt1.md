# Browser Agent Ecosystem — Deep Architecture Research
## Part 1 of 3: System Architecture Analysis

---

## Repository Overview

| Repo | Language | Browser Layer | Orchestration | Strengths |
|---|---|---|---|---|
| **nanobrowser** | TypeScript | Puppeteer-over-CDP (Chrome extension) | Planner+Navigator dual-agent | Extension-native, multi-tab aware |
| **browser-use** | Python | Playwright + CDP directly | Single Agent with planning | Richest feature set, production-grade |
| **Stagehand** | TypeScript | Playwright + Browserbase | act/extract/observe SDK | Self-healing cache, CUA support |
| **WebRover** | Python | Playwright over CDP | LangGraph FSM | Deep research mode, RAG integration |

---

## 1. nanobrowser

### High-Level Architecture

```
Chrome Extension
├── background/               ← Service worker (the "brain")
│   ├── index.ts              ← Task entry point, wires everything
│   ├── agent/
│   │   ├── agents/
│   │   │   ├── planner.ts    ← Strategic planner agent
│   │   │   └── navigator.ts  ← Tactical executor agent
│   │   ├── executor.ts       ← Outer loop orchestrator
│   │   ├── prompts/          ← Planner + Navigator prompts
│   │   └── actions/          ← Action registry + schemas
│   ├── browser/
│   │   ├── context.ts        ← BrowserContext (tab manager)
│   │   ├── page.ts           ← Page abstraction (Puppeteer + chrome.scripting)
│   │   └── dom/
│   │       ├── service.ts    ← getClickableElements (chrome.scripting)
│   │       ├── buildDomTree.js  ← Injected JS — the real DOM walker
│   │       └── views.ts      ← DOMElementNode, DOMState types
│   └── core/
│       ├── tab-orchestrator/ ← Multi-tab routing per task
│       └── task-groups/      ← Chrome tab group management
└── pages/
    └── side-panel/           ← Chat UI, streaming event renderer
```

### Execution Flow

```
User Task
  └─► Executor.execute()
        ├─► Planner.execute()        [strategic: what to do next?]
        │     └─ reads BrowserState (DOM + screenshot)
        │     └─ emits: next sub-goal, tasks[]
        └─► Navigator.execute()      [tactical: how to do it?]
              └─ reads BrowserState
              └─ emits: actions[] (click, type, navigate, scroll…)
              └─ ActionBuilder executes each action
                    └─ BrowserContext.navigateTo / Page.clickElementNode…
```

**Key design decisions:**
- **Dual-agent** (Planner + Navigator): Navigator stays tactical and grounded; Planner provides high-level re-orientation every N steps or when Navigator signals done.
- **Extension-native**: uses `chrome.scripting.executeScript` for DOM (works even when Puppeteer CDP disconnects). `chrome.tabs` as the authority for URL, not Puppeteer's `page.url()`.
- **Tab orchestrator**: each task gets its own tab (or reuses registered one), tracked via Chrome tab groups.

### Planner Design

```typescript
// PlannerAgent produces:
{
  observation: string,   // what the planner sees
  thought: string,       // internal reasoning
  response: string,      // sub-goal for navigator
  done: boolean,         // task completion flag
  final_answer?: string  // output to user
}
```

- Runs at step 0, every `planningInterval` steps, and when Navigator signals completion.
- **Loop detection**: compares last 3 model outputs — exact repetition triggers re-planning.
- **Stall detection** (`hasRecentProgressStall`): breaks loops before max_steps is reached.

### Navigator Design

```typescript
// NavigatorAgent produces:
[
  { action: 'click', index: 5 },
  { action: 'type', index: 3, text: 'hello' },
  { action: 'navigate', url: 'https://...' },
  ...
]
```

- Up to `maxActionsPerStep` actions per LLM call.
- Uses `ActionBuilder` pattern: actions are registered schema-first, executed by the builder.
- `addStateMessageToMemory()` injects current page DOM + screenshot into context before each call.

### Browser Controller (BrowserContext + Page)

**BrowserContext** manages:
- `_attachedPages: Map<tabId, Page>` — live puppeteer-attached pages
- `_currentTabId` — currently active page
- `navigateTo`, `openTab`, `switchTab`, `closeTab`
- `waitForTabEvents` — waits for `status=complete` with non-fatal timeout

**Page** manages:
- `_puppeteerPage` — Puppeteer CDP handle (may be null if tab not yet attached)
- `_validWebPage` — gates all DOM operations; auto-promoted via `_revalidateFromTab()`
- `_state: PageState` — cached DOM state (selectorMap, elementTree, url, title, screenshot)
- `getState()` → `_updateState()` → `getClickableElements()` → chrome.scripting injection

**Critical reliability fix (this session):**
- `url()` method and `getClickableElements()` now use `chrome.tabs.get()` as authoritative URL source instead of `puppeteer.url()` which returns `about:blank` during cross-origin navigation transitions.

### DOM Interaction Layer

```
chrome.scripting.executeScript(tabId, buildDomTree.js)
  ├── walks the real DOM tree
  ├── identifies interactive elements (inputs, buttons, links, [role], etc.)
  ├── assigns sequential highlight indices [0], [1], [2]...
  ├── computes XPath + CSS selectors for each element
  └── returns: { selectorMap: Map<index, DOMElementNode>, elementTree }

Page.locateElement(elementNode)
  ├── tries CSS selector (enhancedCssSelectorForElement)
  ├── falls back to XPath
  ├── falls back to heuristic matching (aria-label, data-testid, text)
  └── returns ElementHandle for click/type
```

**Heuristic locator** (WebGenie addition): when CSS+XPath fail (SPA re-renders), tries:
1. Stable attributes: `data-testid`, `aria-label`, `placeholder`, `id`, `name`
2. Text content match (exact)
3. Fuzzy: `role` + first 5 chars of text

---

## 2. browser-use

### High-Level Architecture

```
browser_use/
├── agent/
│   ├── service.py        ← Agent class (4100 lines) — the monolith core
│   ├── message_manager/  ← Context window management + compaction
│   ├── prompts.py        ← SystemPrompt builder
│   ├── judge.py          ← Task completion judge (separate LLM call)
│   └── views.py          ← AgentOutput, AgentState, AgentHistory types
├── browser/
│   ├── session.py        ← BrowserSession (CDP management, 155K bytes)
│   ├── events.py         ← Typed browser event definitions
│   ├── profile.py        ← BrowserProfile (launch config, 50K bytes)
│   └── watchdogs/        ← Event-driven sidecars (dom, downloads, popups, captcha…)
├── dom/
│   ├── service.py        ← DomService: CDP snapshot + AX tree + DOM tree merger
│   ├── serializer/       ← Clickable element detector + tree serializer
│   ├── enhanced_snapshot.py  ← CDP DOMSnapshot processing
│   └── markdown_extractor.py ← Page → Markdown for LLM
├── tools/
│   ├── service.py        ← Tools registry + executor
│   └── registry/         ← Action registration system
├── llm/                  ← Multi-provider abstraction (OpenAI, Anthropic, Gemini…)
├── skills/               ← Persistent CLI skill library
└── mcp/                  ← MCP server integration hooks
```

### Execution Flow

```
Agent.__init__()
  ├── Extracts URL from task text (directly_open_url=True)
  ├── Initializes BrowserSession (CDP-connected Chrome)
  ├── Initializes Tools registry
  └── Initializes MessageManager with system prompt
 
Agent.run()
  └── for step in range(max_steps):
        ├── BrowserSession.get_state_summary()    ← DOM + screenshot + tabs
        ├── MessageManager.add_state_message()    ← inject into context
        ├── LLM.invoke(messages)                  ← get AgentOutput
        ├── Tools.execute(actions)                ← execute browser actions
        ├── Judge.evaluate() [optional]           ← verify completion
        └── check: done? failure? loop detected?
```

### Planner Design

browser-use embeds planning INSIDE the single agent output:

```python
class AgentOutput(BaseModel):
    current_state: AgentBrain = Field(...)
    # current_state contains:
    #   evaluation_previous_goal: str  ← self-reflection on last step
    #   memory: str                    ← working memory (persistent across steps)
    #   next_goal: str                 ← what to do next
    #   thinking: str                  ← chain-of-thought (visible in logs)
    
    actions: list[ActionModel]         ← actual browser actions to execute
```

**Key insight**: planning is not a separate agent call — it's embedded in every step's structured output. The `evaluation_previous_goal` field forces self-reflection before each action.

**Planning features:**
- `enable_planning=True`: enables explicit plan field in output
- `planning_replan_on_stall`: triggers full re-plan after N stalled steps
- `planning_exploration_limit`: max steps before forced re-evaluation
- `loop_detection_enabled`: window-based loop detection (last 20 outputs)
- `flash_mode`: strips planning fields for lightweight/fast models

### Executor Design

The `Tools` class is a dynamic registry:

```python
@controller.action("Click element", param_model=ClickElementAction)
async def click_element(params: ClickElementAction, browser: BrowserSession):
    element = await browser.get_element_by_index(params.index)
    await element.click()
    return ActionResult(extracted_content="Clicked", include_in_memory=False)
```

**Actions available:**
- `navigate_to_url`, `search_google`, `go_back`, `go_forward`
- `click_element_by_index`, `input_text`, `send_keys`
- `scroll_down/up`, `scroll_to_text`
- `extract_content` (uses page_extraction_llm)
- `open_tab`, `switch_tab`, `close_tab`
- `drag_drop`, `right_click`, `double_click`
- `wait`, `done`, `screenshot`
- **Coordinate clicking** for models that support it (Claude Sonnet-4, Gemini-3-Pro)

### Browser Controller (BrowserSession)

The `BrowserSession` is the most sophisticated browser controller in any of the four repos. Key capabilities:

**Session management:**
- Local Chrome or Browserbase (cloud) — same interface
- Persistent CDP session (not reconnected per step)
- Tab awareness: `agent_focus_target_id` tracks which tab the agent is working on
- Tab switching preserves agent context

**Watchdog system (unique to browser-use):**
```
watchdogs/
├── dom_watchdog.py         ← hooks DOM snapshot lifecycle
├── downloads_watchdog.py  ← tracks file downloads → updates available_file_paths
├── popups_watchdog.py     ← auto-handles dialogs/alerts
├── security_watchdog.py  ← enforces allowed_domains
└── captcha_watchdog.py   ← CAPTCHA detection and handling flow
```
Each watchdog is a CDP event listener that runs independently of the agent loop. **This eliminates entire categories of one-off `if/else` logic from the main loop.**

**Anti-bot features:**
- `demo_mode`: visual overlay showing agent actions in browser
- `demo_mode_delay`: human-like pacing
- `stealth_mode`: navigator.webdriver = false + fingerprint randomization

### DOM Interaction Layer

browser-use has the most sophisticated DOM layer of all four systems:

**Triple-source DOM fusion:**
1. `CDP DOMSnapshot.captureSnapshot` — full node tree + computed styles + bounds
2. `CDP Accessibility.getFullAXTree` — semantic roles, names, descriptions (for ALL frames)
3. `JS getEventListeners()` — elements with programmatic click handlers (skipped on >10k node pages)

**Element visibility (multi-frame aware):**
```python
is_element_visible_according_to_all_parents(node, html_frames, viewport_threshold=1000)
# Walks up frame hierarchy, transforms coordinates, checks CSS + bounding box
# viewport_threshold=1000: elements 1000px below fold are still included
```

**Hidden elements hint system:**
- For each iframe, collects hidden-but-interactive elements
- Reports: `[button "Submit" at 2.3 pages down]`
- LLM knows to scroll even without seeing the element

**Selector generation:**
- Builds `enhanced_css_selector` from element attributes + position in DOM tree
- Prefers stable attributes: `id`, `data-testid`, `aria-label`, `name`
- Falls back to nth-child combinator

**MatchLevel system (selector healing):**
```python
class MatchLevel(Enum):
    EXACT = "exact"
    ROLE_AND_TEXT = "role_and_text"
    TEXT_SIMILARITY = "text_similarity"
    ROLE_ONLY = "role_only"
```
When a cached selector fails (SPA re-render), browser-use tries progressively looser matches.

---

## 3. Stagehand

### High-Level Architecture

```
packages/core/lib/v3/
├── v3.ts              ← V3/Stagehand class (71K bytes) — main orchestrator
├── handlers/
│   ├── ActHandler      ← Executes browser actions from natural language
│   ├── ExtractHandler  ← Extracts structured data from pages
│   ├── ObserveHandler  ← Returns list of possible actions on current page
│   └── V3AgentHandler  ← Multi-step autonomous agent
│   └── V3CuaAgentHandler ← Computer Use Agent (CUA) mode
├── agent/
│   ├── AgentClient.ts  ← Provider-agnostic agent interface
│   └── AgentProvider.ts ← Routes to Anthropic/OpenAI/Google CUA clients
├── cache/
│   ├── ActCache        ← Caches known-good selectors per action description
│   └── AgentCache      ← Caches multi-step agent trajectories
├── understudy/         ← Page/context abstraction wrapping Playwright
├── llm/                ← LLM provider routing + response parsing
└── mcp/                ← MCP tool server integration
```

### Three-Mode API (Unique Design)

Stagehand exposes three fundamental primitives instead of a single agent loop:

```typescript
const sh = new Stagehand({ modelName: 'claude-sonnet-4-5' });

// 1. ACT: execute a natural-language action
await sh.act("Click the login button");
await sh.act("Fill in the email field with user@example.com");

// 2. EXTRACT: pull structured data from the page
const data = await sh.extract({
  instruction: "Extract all product names and prices",
  schema: z.array(z.object({ name: z.string(), price: z.number() }))
});

// 3. OBSERVE: get a list of possible next actions
const options = await sh.observe("What can I do on this page?");
// returns: ["Click 'Add to Cart'", "Search for products", "Navigate to account"]

// 4. AGENT: autonomous multi-step (uses act/extract/observe internally)
await sh.agent.execute("Book a flight from NYC to London for next Friday");
```

**Why this matters:** These primitives are composable. Developers can write deterministic scripts using `act/extract/observe` and only fall back to `agent` for truly autonomous flows. This gives far better predictability than a pure black-box agent.

### Cache + Self-Healing System

The `ActCache` is the most innovative feature in Stagehand:

```typescript
// First run: LLM determines the selector for "Click login button"
// → selector: "button[data-testid='login-btn']"
// → cached with instruction as key

// Subsequent runs: cache hit → direct execution, no LLM call
// → instant, zero cost

// Cache miss (UI changed): tries cached selector first
// → fails → falls back to LLM re-evaluation
// → new selector stored
```

**Self-healing flow:**
1. Try cached selector → if succeeds, done (no LLM call)
2. Selector fails → `ObserveHandler` re-scans current page
3. LLM matches instruction to new element → executes + updates cache
4. Full re-plan if still failing → `V3AgentHandler`

**AgentCache**: caches entire task trajectories (sequences of actions). For known workflows (login → navigate → fill form), replays without any LLM calls.

### CUA (Computer Use Agent) Mode

Unique capability: Stagehand can delegate to provider-native CUA models:

```typescript
const sh = new Stagehand({
  modelName: 'claude-computer-use-2024-10-22',  // Anthropic CUA
  // or 'computer-use-preview' (OpenAI), 'gemini-computer-use' (Google)
});
// The CUA model sees screenshots and generates mouse/keyboard coordinates
// Stagehand translates coordinates → Playwright actions
```

This bypasses DOM entirely — works on canvas elements, PDF viewers, custom UI frameworks, anything that renders to pixels.

### Planner Design

Stagehand V3 uses a single-pass agent:

```
V3AgentHandler.execute(task)
  ├── ObserveHandler → what actions are available?
  ├── LLM selects next action from observed options
  ├── ActHandler executes selected action
  └── repeat until done or max_steps
```

No separate planning model. The `observe → act` loop is its own implicit planning cycle.

**Key difference from nanobrowser**: Stagehand's "planning" happens through `observe` which grounds decisions in actual page state at every step, preventing hallucination of non-existent elements.

### Browser Controller (Understudy)

```
understudy/
├── StagehandPage      ← wraps Playwright Page with act/extract/observe
└── StagehandContext   ← wraps Playwright BrowserContext
```

- Can run locally (Playwright Chrome) or remotely (Browserbase cloud)
- Same interface regardless of environment
- Session persistence across steps (no reconnection per action)

---

## 4. WebRover

### High-Level Architecture

```
backend/
├── app/
│   ├── main.py              ← FastAPI server + SSE streaming
│   ├── task_agent.py        ← Task LangGraph (1276 lines)
│   ├── research_agent.py    ← Research LangGraph + RAG
│   └── deep_research_agent.py ← Multi-topic deep research
├── Browser/
│   └── webrover_browser.py  ← CDP chrome connection
└── marking_scripts/
    ├── marking.js           ← All-elements annotator
    ├── marking_input.js     ← Input-specific annotator
    ├── marking_buttons_2.js ← Button-specific annotator
    └── marking_links.js     ← Link-specific annotator

frontend/ (Next.js)
└── app/rover/page.tsx       ← Chat UI with streaming render
```

### Three-Agent System (Unique)

WebRover has three separately compiled LangGraph state machines for different task types:

#### Task Agent FSM
```
decide_immediate_action
  │ route: decide_url / get_all_elements / get_all_input_elements
  │        get_all_button_elements / get_all_link_elements
  │        go_back / go_to_search / respond / wait / type_in_text_editor
  ↓
[specialized node: gather DOM subset]
  ↓
[action: click / type / navigate]
  ↓
decide_immediate_action   ← loops back
```

**Key insight**: WebRover separates element annotation into specialized sub-calls (inputs only, buttons only, links only). This reduces DOM noise — when the agent wants to click a button, it only sees buttons. When it wants to type, it only sees inputs.

#### Research Agent FSM
```
url_decide_node
  → annotate_page
  → llm_call_node
  → [tool route: click/type/scroll/go_back/go_to_search]
  → web_page_rag          ← RAG over current page content
  → note_scroll_read
  → close_opened_link
  → self_review           ← "do I have enough info?"
  → answer_node
  → empty_rag_store       ← cleanup
```

**RAG integration**: The research agent uses Chroma vector store. Each visited page is chunked, embedded, and stored. At `web_page_rag`, relevant chunks are retrieved for the current query — enabling the agent to synthesize across multiple visited pages.

#### Deep Research Agent FSM
```
url_decide_node
  → topic_breakdown        ← LLM decomposes into N subtopics
  → track_subtopic_status
  → [for each unsearched subtopic]:
      go_to_search → annotate_page → llm_call_node
      → web_page_rag → note_scroll_read
      → self_review → subtopic_answer_node
      → empty_rag_store
  → compile_research       ← synthesize all subtopic answers
```

**Long-horizon capability**: This FSM can handle research tasks requiring 20-50 browser steps across 5-10 subtopics, with explicit state tracking of which subtopics are complete.

### DOM Interaction Layer (Annotation Approach)

WebRover uses visual element annotation (similar to Set-of-Marks):

```javascript
// marking.js injected into page
function captureInteractiveElements() {
  // Finds all interactive elements
  // Assigns sequential index numbers
  // Draws colored overlays with index labels
  // Returns structured list: [{index, text, type, xpath, x, y, inViewport}]
}
```

**Agent receives:**
```json
[
  {"index": 0, "text": "Search", "type": "input", "xpath": "//input[@name='q']", "x": 450, "y": 300, "inViewport": true},
  {"index": 1, "text": "Gmail", "type": "link", "xpath": "//a[contains(text(),'Gmail')]", "x": 800, "y": 50, "inViewport": true}
]
```

Agent selects by index. Execution uses XPath for location.

**Scroll-aware**: `inViewport: false` elements trigger scroll-before-interact.

### Streaming Architecture

```
FastAPI /query
  → runs selected agent graph
  → yields SSE chunks as graph nodes emit:
      {"type": "thought", "content": "..."}
      {"type": "action", "content": "Clicking login button"}
      {"type": "browser_action", "content": "Navigated to gmail.com"}
      {"type": "rag_action", "content": "Reading page content..."}
      {"type": "self_review", "content": "I need more information about..."}
      {"type": "final_answer", "content": "...complete synthesis..."}

Frontend renders each chunk type with different styling
```

This gives users a live "inner monologue" view of the agent's reasoning — significantly better UX than waiting for a final answer.

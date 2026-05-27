# Browser Agent Ecosystem — Deep Architecture Research
## Part 2 of 3: Feature Extraction, Memory, Reliability & Intelligence

---

## Memory Systems

### nanobrowser — Message-Based Working Memory

```typescript
// MessageManager (messages/service.ts)
class MessageManager {
  initTaskMessages(systemMsg, task)     // seeds the context
  addStateMessage(state, actions)       // injects DOM + screenshot each step
  addPlan(planText, position)           // inserts planner output
  addNewTask(task)                      // for follow-up tasks
  flushTokenUsage()                     // telemetry
}
```

- **Working memory**: current message window (system + history + current state)
- **No persistent memory**: between tasks, context is reset
- **Token management**: history is truncated; no explicit compaction
- **State injection**: each step's DOM tree + screenshot added as a new message

**Gap**: No cross-session memory, no semantic compression.

---

### browser-use — Multi-Layer Memory System

The most complete memory architecture of all four repos:

#### Layer 1: Working Memory (per-step)
```python
class AgentBrain(BaseModel):
    evaluation_previous_goal: str  # "Success: I clicked the login button"
    memory: str                    # persistent working memory string
    next_goal: str                 # current objective
    thinking: str                  # extended chain-of-thought
```
The `memory` field is **explicitly preserved and updated by the LLM across steps** — it's a scratchpad the model writes to and reads from. Unlike nanobrowser which only has the message window, browser-use gives the model a dedicated editable memory slot.

#### Layer 2: Message Compaction
```python
class MessageCompactionSettings(BaseModel):
    enabled: bool = True
    compaction_llm: BaseChatModel | None = None
    max_tokens_before_compaction: int = 50000
    # When context exceeds threshold, a compaction_llm call summarizes
    # the conversation history into a dense summary message
```
When the context window fills, a separate LLM call summarizes the entire history. The agent continues with a compact memory rather than losing old context.

#### Layer 3: Execution History
```python
class AgentHistoryList:
    history: list[AgentHistory]  # every step: state snapshot + actions + results
    usage: dict                   # token costs per step
```
Full audit trail. Can be replayed via `Agent.replayHistory()`.

#### Layer 4: File System
```python
self.file_system = FileSystem(agent_directory)
# Agent can save/load files between steps
# available_file_paths updated when new downloads appear
```

#### Layer 5: Download Tracking
```python
# Watchdog automatically detects new downloads
# available_file_paths is injected into system prompt
# Agent can reference downloaded files by path in subsequent actions
```

---

### Stagehand — Cache-Based Memory

```
ActCache: instruction_string → {selector, last_used, hit_count}
AgentCache: task_string → [{action_sequence}]
CacheStorage: persistent on-disk JSON
```

- **No conversation memory**: each `act/extract/observe` call is stateless
- **Implicit memory via cache**: repeated tasks are "remembered" as cached trajectories
- **Self-healing**: cache + LLM fallback = resilient memory of *how* to do things

The cache is Stagehand's "procedural memory" — it remembers *how* to accomplish specific actions on specific pages, not *what* the task was.

---

### WebRover — RAG-Based Research Memory

```python
# Chroma vector store (per session)
vectorstore = Chroma(collection_name="research", embedding_function=embeddings)

# When visiting a page:
content = extract_page_content(page)  # html → text
chunks = text_splitter.split_text(content)
vectorstore.add_texts(chunks)

# At reasoning step (web_page_rag):
relevant_chunks = vectorstore.similarity_search(current_query, k=5)
# → injected into LLM context
```

**Unique capability**: WebRover accumulates knowledge across multiple visited pages within a task. When researching "AI agent architectures", it can synthesize information from 5 different sources visited across 20 steps.

**Weakness**: Cleared after each task (`empty_rag_store` node). No cross-task persistence.

---

## Reliability Mechanisms

### nanobrowser — Defensive Reliability

| Mechanism | Implementation |
|---|---|
| **Non-fatal timeouts** | `waitForTabEvents` catches timeout, continues |
| **CDP fallback** | When `puppeteer.url()` returns `about:blank`, uses `chrome.tabs.get()` |
| **Page re-validation** | `_revalidateFromTab()` promotes `_validWebPage` even after failed attach |
| **Click fallback** | Native click → `el.click()` on fresh handle |
| **Heuristic locator** | CSS → XPath → stable attributes → text match |
| **Max failures** | `consecutiveFailures >= maxFailures` → stops gracefully |
| **Loop detection** | Last 3 model outputs identical → triggers re-planning |
| **XPath verification** | After locating by CSS, verifies actual XPath matches expected |

### browser-use — Production-Grade Reliability

| Mechanism | Implementation |
|---|---|
| **Watchdog architecture** | Independent event listeners for popups, downloads, captchas, security |
| **Fallback LLM** | `fallback_llm`: if primary model fails/rate-limits, switches automatically |
| **Judge LLM** | `use_judge=True`: separate LLM call verifies task completion (reduces false positives) |
| **Loop detection** | Window of 20 outputs, configurable |
| **Per-model timeouts** | `llm_timeout` auto-configured per model (Gemini: 75s, Claude: 90s) |
| **MatchLevel healing** | 4-tier selector fallback: EXACT → ROLE_AND_TEXT → TEXT_SIMILARITY → ROLE_ONLY |
| **CDP retry** | `_get_all_trees()` retries timed-out CDP calls once before failing |
| **Anti-bot** | Demo mode, stealth mode, human-like delays, navigator.webdriver=false |
| **Allowed domains** | `BrowserProfile.allowed_domains` + security watchdog enforces it |
| **Max actions/step** | Prevents runaway multi-action execution |
| **`final_response_after_failure`** | On max_failures, generates a best-effort final answer instead of crashing |

### Stagehand — Self-Healing Reliability

| Mechanism | Implementation |
|---|---|
| **ActCache self-heal** | Stale selector → LLM re-evaluate → update cache |
| **Observe grounding** | Before any action, current page is observed → prevents hallucinated element refs |
| **CUA fallback** | If DOM-based approach fails, can switch to screenshot-based CUA |
| **Region-aware API** | `StagehandAPIClient` handles endpoint routing + auth errors |
| **Shutdown supervisor** | Clean resource cleanup even on unexpected termination |

### WebRover — Structured Reliability

| Mechanism | Implementation |
|---|---|
| **Self-review node** | Agent explicitly asks "do I have enough information?" before answering |
| **Scroll detection** | `inViewport: false` triggers scroll-first before interaction |
| **Fallback nav** | If primary URL fails, falls back to Google |
| **Streaming error chunks** | `{"type": "error", "content": "..."}` keeps UI informed |
| **Annotation-based grounding** | Agent only acts on elements it can see in the current annotation |

---

## DOM Intelligence

### Comparison Table

| Capability | nanobrowser | browser-use | Stagehand | WebRover |
|---|---|---|---|---|
| **DOM extraction method** | JS injection via chrome.scripting | CDP DOMSnapshot + AX tree | Playwright evaluation | JS injection via page.evaluate |
| **Accessibility tree** | No | Yes (full AX tree, all frames) | No | No |
| **Shadow DOM** | No | Yes | No | No |
| **iframe support** | Basic (Puppeteer frame API) | Full (cross-frame AX tree) | Basic | No |
| **Selector healing** | Heuristic (3-tier) | MatchLevel (4-tier) | Cache + re-evaluate | XPath only |
| **Visibility checking** | Viewport + CSS | Multi-frame coordinate transform | Playwright built-in | `inViewport` flag |
| **Hidden element hints** | No | Yes (scroll distance hints) | No | No |
| **JS event listener detection** | No | Yes (via CDP getEventListeners) | No | No |
| **Set-of-Marks overlay** | Yes (highlight indices) | No | No | Yes (colored overlays) |
| **Markdown extraction** | No | Yes (markdown_extractor.py) | No | Text innerText |
| **CUA mode** | No | Coordinate clicking (limited) | Full CUA support | No |

---

### browser-use's AX Tree Fusion (Most Sophisticated)

```python
# Three parallel CDP calls per DOM snapshot:
snapshot, dom_tree, ax_tree, dpr = await asyncio.gather(
    DOMSnapshot.captureSnapshot(computedStyles=REQUIRED_STYLES, includePaintOrder=True),
    DOM.getDocument(depth=-1, pierce=True),
    Accessibility.getFullAXTree(frameId=frame_id),  # for ALL frames
    Page.getLayoutMetrics()
)

# Merge: each DOM node gets its AX properties:
enhanced_node = EnhancedDOMTreeNode(
    node_id=..., tag_name=..., attributes=...,
    ax_node=ax_tree_lookup.get(backendNodeId),   # ← semantic role/name
    snapshot_node=snapshot_lookup.get(backendNodeId),  # ← bounds + styles
    absolute_position=...,                        # ← computed from iframe chain
)
```

The merged node gives the LLM:
- Tag: `button`
- Role: `button` (from AX)
- Name: `"Submit form"` (from AX `name` property — includes aria-label, inner text, etc.)
- Bounds: `{x: 450, y: 300, width: 120, height: 40}` (absolute screen coords)
- Computed styles: `display: block, visibility: visible, opacity: 1`

This is far richer than nanobrowser's or WebRover's text-only element description.

---

## Agent Intelligence Features

### Self-Reflection / Evaluation

**browser-use** embeds reflection in every step output:
```python
evaluation_previous_goal: str
# Examples:
# "Success: I found the Gmail compose button and clicked it"
# "Failure: The element was not found, the page structure changed"
# "Unknown: The page is still loading"
```
The LLM grades its own last action before planning the next one. This forces explicit acknowledgment of failures rather than silently continuing wrong.

**WebRover** has a dedicated `self_review` node:
```python
# self_review prompt:
"""
Based on the information collected so far, evaluate:
1. Do you have sufficient information to answer the user's query?
2. What is missing?
3. What should you do next?
"""
# Routes to: answer_node (if sufficient) or back to annotate_page (if not)
```

### Working Memory / Scratchpad

**browser-use** gives the model an explicit mutable memory field:
```python
memory: str = Field(description="""
    Update this with important discoveries, completed actions, and pending items.
    Examples:
    - "Logged in as user@gmail.com. Found 3 unread emails. Need to compose reply to John."
    - "Searched for 'AI internship' on LinkedIn. Found 12 results. Clicked first result."
""")
```
Unlike a message window (append-only), this field is written and re-written. The model maintains a living summary rather than relying on raw history.

### Loop Detection

**nanobrowser** (`executor.ts`):
```typescript
private hasRecentProgressStall(): boolean {
    const records = this.context.history.history;
    if (records.length < 3) return false;
    const lastThree = records.slice(-3).map(r => (r.modelOutput || '').trim());
    return lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2];
}
```

**browser-use** (`agent/views.py`):
```python
class LoopDetector:
    window_size: int = 20  # configurable
    # Hashes model outputs in a sliding window
    # Detects both exact repetition and semantic loops
    # Can trigger re-planning or early termination
```

### Dynamic Replanning

**nanobrowser**: Planner re-runs every `planningInterval` steps OR when Navigator signals done OR when stall detected. Planner has full state visibility.

**browser-use**: `planning_replan_on_stall=3`: after 3 steps without progress (detected by evaluation_previous_goal containing "Failure"), triggers a full re-plan cycle.

**Stagehand**: No explicit replanning — `observe` naturally re-grounds every action. If `act` fails, `ActHandler` observes the page fresh and tries again.

---

## Long-Horizon Task Features

### WebRover's Deep Research Mode (Best for Long Tasks)

The deep research FSM is purpose-built for 20-50 step tasks:

```python
class SubtopicStatus(TypedDict):
    subtopic: str
    status: Literal["pending", "in_progress", "complete"]
    answer: Optional[str]

# track_subtopic_status node:
# 1. Checks which subtopics need research
# 2. Selects next pending subtopic
# 3. Routes to research loop
# 4. Marks complete when self_review says "sufficient"
# 5. When all complete → compile_research
```

**Research per subtopic:**
- Navigate → annotate → LLM decides action → click/scroll/type
- `web_page_rag`: current page chunked into Chroma, queried for relevant content
- `note_scroll_read`: appended to subtopic working notes
- `close_opened_link`: return to search results
- `self_review`: enough? → proceed or keep researching

**Final compilation:**
```python
# compile_research prompt sees:
# - Original question
# - All subtopic answers
# Generates: coherent long-form answer with synthesis across sources
```

### browser-use's File System for Long Tasks

```python
# Agent can save intermediate results:
await file_system.write("notes.txt", "Found: Gmail login at accounts.google.com")
await file_system.write("results.csv", "name,email\nJohn,john@example.com")

# Later steps can read:
content = await file_system.read("notes.txt")
```

This enables **multi-session tasks**: the agent saves progress to files, which persist across runs. Next session picks up where it left off.

### nanobrowser's Follow-Up Tasks

```typescript
executor.addFollowUpTask("Now compose an email to John")
// → appended to tasks[]
// → messageManager.addNewTask(task)
// → previous context preserved
// → agent continues with full history
```

---

## Valuable Features Worth Adopting into WebGenie

### 🔴 HIGH IMPACT

#### 1. `evaluation_previous_goal` field (browser-use)
**What**: Every LLM output includes a self-grading field: did the last action succeed?  
**Why it works**: Forces explicit acknowledgment of failures. Prevents the "blind continue" problem where an agent keeps trying the same thing because it never assessed the result.  
**Impact**: Drastically reduces unnecessary step repetition. Helps break DOM blindness loops.  
**Implementation**: Add `evaluation_previous_goal` to NavigatorOutput schema. Include it in the next step's context.

#### 2. `memory` scratchpad field (browser-use)
**What**: A mutable string field the LLM writes to and reads from across steps.  
**Why it works**: The agent maintains a living summary rather than depending on raw message history.  
**Impact**: Better long-task performance, less context window pressure.  
**Implementation**: Add `memory: string` to NavigatorOutput. Carry it forward in state messages.

#### 3. Watchdog architecture (browser-use)
**What**: Independent event listeners for popups, downloads, captchas, dialogs.  
**Why it works**: Moves brittle one-off logic out of the main agent loop into composable sidecars.  
**Impact**: More robust handling of unexpected browser events without polluting core logic.  
**Implementation**: Add a `PopupWatchdog` (auto-dismiss/handle `window.alert`, `window.confirm`). Add a `NavigationWatchdog` for detecting unexpected redirects.

#### 4. Self-review node (WebRover)
**What**: Explicit "do I have enough information?" gate before answering.  
**Why it works**: Prevents premature task completion. Forces the agent to verify its work.  
**Impact**: Fewer false-positive task completions.  
**Implementation**: In the Planner's completion check, add an explicit verification prompt: "Based on the current page state, is the task definitively complete?"

#### 5. AX tree integration (browser-use)
**What**: Merge accessibility tree into DOM element descriptions.  
**Why it works**: Provides semantic role + name for every element, even when visual text is absent.  
**Impact**: Dramatically better element identification for icon-only buttons, custom components.  
**Implementation**: In `buildDomTree.js`, query `aria-role`, `aria-label`, `aria-description` attributes. Include in element serialization.

### 🟡 MEDIUM IMPACT

#### 6. MatchLevel selector healing (browser-use)
**What**: 4-tier fallback: exact CSS → role+text → text similarity → role only.  
**Implementation**: After CSS+XPath fail in `locateElement`, try fuzzy attribute matching.

#### 7. Specialized element annotation (WebRover)
**What**: Separate DOM queries for inputs/buttons/links based on current intent.  
**Implementation**: In `getClickableElements`, accept a `filter: 'inputs' | 'buttons' | 'links' | 'all'` param. When agent says `input_text`, only return input elements.

#### 8. Hidden elements hint (browser-use)
**What**: For off-screen interactive elements, report `"button 'Submit' at ~2 pages below"`.  
**Implementation**: In `buildDomTree.js`, detect elements with bounds outside viewport. Report in DOM state as hints.

#### 9. Fallback LLM (browser-use)
**What**: If primary model fails/rate-limits, switch to a configured fallback model.  
**Implementation**: Wrap LLM calls in try/catch; on `ModelRateLimitError`, retry with `fallbackLlm`.

#### 10. ActCache / selector cache (Stagehand)
**What**: Cache successful selectors per action description. Re-use without LLM calls.  
**Implementation**: `Map<descriptionHash, { cssSelector, xpath }>` persisted to extension storage. Check before calling `locateElement`.

### 🟢 LOWER IMPACT (FUTURE)

#### 11. Message compaction (browser-use)
Summarize conversation history when context exceeds threshold.

#### 12. RAG-based page notes (WebRover)
For research tasks, chunk and embed visited pages for cross-page synthesis.

#### 13. CUA mode (Stagehand)
Screenshot-based interaction as fallback for canvas/PDF/custom UIs.

#### 14. GIF/video recording (browser-use)
Record agent session as GIF for debugging and replay.

---

*Continues in Part 3: Gap Analysis, Dream Agent Architecture, Prioritized Adoption Roadmap*

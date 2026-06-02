# WebGenie Repository Evolution Blueprint
## Part 2 of 3: Reliability, Intelligence, Memory & Long-Horizon Analysis

---

## 4. Reliability Evolution Analysis

### 4.1 Current Reliability Model

WebGenie's reliability is primarily defensive — it handles known failure categories (CDP disconnects, timeout races, stale handles) well but has no proactive reliability mechanisms. The system reacts to failures but rarely prevents them.

**What's working well:**
- `waitForTabEvents` with non-fatal timeouts prevents infinite hangs on page navigation
- `_revalidateFromTab()` + promote-only `_validWebPage` prevents false `about:blank` DOM blindness
- 3-tier click fallback (CSS → XPath → heuristic) handles most SPA re-renders
- `consecutiveFailures` counter provides a circuit breaker for agent loops
- `MaxFailuresReachedError` terminates gracefully rather than looping forever

**What's currently missing:**

#### 4.1.1 Popup/Dialog Watchdog (Critical)

**Problem**: When the browser shows a `window.alert`, `window.confirm`, or `beforeunload` dialog, the agent's CDP session blocks. Puppeteer calls hang waiting for the dialog to be dismissed. The agent loop can freeze for the entire `step_timeout` duration.

**Current behavior**: No handler. Any unexpected dialog silently blocks until timeout.

**Solution**: Attach a dialog event listener in `attachPuppeteer()`:
```typescript
this._puppeteerPage.on('dialog', async (dialog) => {
    logger.warning(`[PopupWatchdog] Auto-dismissing ${dialog.type}: "${dialog.message()}"`);
    try {
        await dialog.accept();
    } catch {
        await dialog.dismiss();
    }
});
```

**Impact**: Eliminates entire category of silent agent blocks. Zero architectural cost.

#### 4.1.2 Per-Step Timeout (High Priority)

**Problem**: The executor loop has no individual step timeout. If `getState()` or an action hangs (e.g., waiting for a loading page that never completes, or a dialog that never gets dismissed), the entire agent freezes.

**Current behavior**: No escape. The task runs until `AbortSignal` fires or user manually stops.

**Solution**: Wrap each Navigator execution in `Promise.race`:
```typescript
const STEP_TIMEOUT_MS = 90_000;
const navOutput = await Promise.race([
    this.navigate(),
    new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Step timeout')), STEP_TIMEOUT_MS)
    )
]);
```

**Impact**: Converts infinite hangs into recoverable timeouts. Agent logs timeout, increments `consecutiveFailures`, and continues.

#### 4.1.3 Visual Verification After Action (High Value)

**Problem**: After `clickElementNode`, the system has no way to confirm the click had the intended effect. The agent proceeds to the next action even if the click was on the wrong element or the page didn't respond.

**Solution**: After significant actions (click, form submission), optionally call `getState()` and compare the new state against expected changes. This doesn't require a full LLM call — a hash of the DOM state is enough to detect any change.

```typescript
const preClickHash = await this._getDomHash();
await this.clickElementNode(node);
await new Promise(r => setTimeout(r, 500));
const postClickHash = await this._getDomHash();
if (preClickHash === postClickHash) {
    logger.warning('[ClickVerify] DOM unchanged after click — element may not have responded');
}
```

**Impact**: Earlier detection of "click did nothing" situations, before the LLM is confused by a stale state message.

#### 4.1.4 Semantic Loop Detection (Medium Priority)

**Problem**: Current loop detection (`hasRecentProgressStall`) only matches exact string equality of model outputs. The agent can loop semantically (same goal, different phrasing, different element indices) for many steps before being detected.

**Solution**: Hash the browser state (URL + DOM element set) rather than the model output. If the same page state recurs 3+ times, trigger replanning regardless of output variation.

```typescript
private _stateHistory: string[] = [];
async detectStateLoop(): Promise<boolean> {
    const stateKey = `${this._state.url}::${this._state.selectorMapHash}`;
    this._stateHistory.push(stateKey);
    const recent = this._stateHistory.slice(-5);
    // If same state appeared 3 of the last 5 times → loop
    return recent.filter(s => s === stateKey).length >= 3;
}
```

**Impact**: Catches loops the current system misses. Triggers replanning sooner, saving steps.

#### 4.1.5 `consecutiveFailures` Reset Policy

**Problem**: `consecutiveFailures` resets to 0 on ANY successful navigator step, even trivial ones (scroll, wait). A persistent deep failure (e.g., can't find the Gmail compose button) can be masked by alternating with trivial scroll successes.

**Solution**: Track failures per action category, or use a weighted failure score that decays slowly rather than resets instantly.

**Impact**: More accurate failure signaling, earlier escalation to replanning.

---

## 5. Planning & Intelligence Evolution

### 5.1 The `evaluation_previous_goal` Gap (Most Impactful)

**Current state**: The Navigator's structured output schema includes:
```typescript
current_state: {
    evaluation_previous_goal: string,  // LLM generates this every step
    memory: string,                    // LLM generates this every step
    next_goal: string,
}
```

The LLM dutifully fills these fields. But the executor ignores them — only `action[]` and `done` are extracted and used. The model's self-reflection is silently discarded.

**Why this matters**: When the agent fails (clicks wrong element, form doesn't submit, navigation fails), the `evaluation_previous_goal` will contain `"Failure: the compose button was not found"`. Without propagation, the next step's context doesn't know the previous step failed. The agent blindly continues as if nothing happened.

**The fix is small but transformational**:

```typescript
// In executor.ts / navigate():
const navOutput = await this.navigator.execute();

// EXTRACT self-reflection fields:
const evaluation = navOutput.result?.evaluation_previous_goal;
const memory = navOutput.result?.memory;

// INJECT into next step's context:
if (evaluation) {
    this.context.messageManager.addEvaluationResult(evaluation);
}
if (memory) {
    this.context.agentMemory = memory; // carried to next state message
}
```

**Effect**: The model receives its own previous assessment as context for the next step. When it wrote "Failure: compose button not found", the next step's context includes that failure. The model naturally tries a different approach rather than repeating the same failed action.

**Cost**: 5-10 extra tokens per step. Zero architectural change.

**Expected impact**: 20-30% reduction in "blind continue after failure" steps on complex tasks.

---

### 5.2 The `memory` Scratchpad Gap

**Current state**: `memory: string` is generated each step but discarded. Each step starts from the raw message window.

**Problem for long tasks**: After 15 steps of Gmail automation:
- Step 1: "I need to log into Gmail and compose an email to John about the AI internship"
- Step 15: The model may lose track of what "the internship email" referred to
- The model tries to re-derive this from the message window, but early messages are pushed out of the context window by intermediate DOM states

**The fix**:
```typescript
// State message builder (prompts/navigator.ts):
getUserMessage(context: AgentContext): BaseMessage {
    const memorySection = context.agentMemory
        ? `\n\n## Your Working Memory\n${context.agentMemory}\n`
        : '';
    return new HumanMessage(
        `${memorySection}## Current Browser State\n${stateText}`
    );
}
```

**Effect**: The model has a persistent note area that survives across DOM state refreshes. It can track: "Already on Gmail. Compose window open. Recipient: John. Need to write subject line next."

**Expected impact**: Significant improvement for tasks >10 steps. Near-elimination of "lost task context" failures.

---

### 5.3 Task Completion Verification Gate

**Current state**: When `plannerOutput.result?.done === true`, execution stops. The planner's confidence is accepted unconditionally.

**Problem**: The planner can be wrong. "I believe the email was sent" based on seeing a "Message sent" banner for one frame does not guarantee success. SPAs frequently show transient success messages.

**Solution**: Add a verification gate before accepting `done`:

```typescript
// After planner says done:
if (planOutput.result?.done) {
    const verified = await this.runVerification(planOutput.result.final_answer);
    if (verified) {
        break; // Actually done
    } else {
        logger.warning('Planner said done but verification failed — continuing');
        planOutput.result.done = false; // Reset, continue loop
    }
}

// Verification: lightweight LLM call with specific verification prompt
async runVerification(claimedAnswer: string): Promise<boolean> {
    const currentState = await this.navigator.getCurrentStateText();
    const prompt = `Task: ${this.task}\nClaimed completion: ${claimedAnswer}\nCurrent page: ${currentState}\n\nIs the task definitively complete based on what you can see? Reply YES or NO.`;
    const response = await this.llm.invoke([new HumanMessage(prompt)]);
    return response.content.toString().trim().toUpperCase().startsWith('YES');
}
```

**Expected impact**: Near-elimination of false-positive task completion. Especially valuable for form submissions, email sends, and purchases.

---

### 5.4 Adaptive Planning Cadence

**Current state**: `planningInterval` is fixed. Planner runs every N steps regardless of how well things are going.

**Improvement**: Dynamic cadence based on Navigator confidence:
- If Navigator has taken 3 steps without any errors and DOM is changing each step → skip planner (things are going well)
- If Navigator has taken 1 step with errors → invoke planner immediately
- If DOM hasn't changed in 2 steps → invoke planner immediately (stuck)

This reduces unnecessary planner LLM calls on smooth tasks while increasing replanning frequency when the agent is struggling.

---

### 5.5 Sub-Goal Tracking

**Current state**: The planner outputs a single `response` string that becomes the navigator's sub-goal. There's no tracking of whether the navigator achieved the sub-goal.

**Improvement**: Track sub-goals explicitly:
```typescript
interface SubGoal {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'complete' | 'failed';
    steps_taken: number;
}
```

When the navigator calls `done=true`, the executor marks the current sub-goal complete and asks the planner for the next one. Failed sub-goals trigger immediate replanning with failure context.

This creates a lightweight FSM at the sub-goal level, enabling better progress tracking for multi-stage tasks.

---

## 6. Browser Intelligence Evolution

### 6.1 AX Tree Enrichment (High Impact)

**Current state**: `buildDomTree.js` identifies interactive elements purely from HTML structure (tag names, attributes). An icon-only button with no `title` or `aria-label` gets serialized as `button[]` — completely opaque to the LLM.

**The problem in Gmail**: Gmail uses icon buttons extensively. The compose button, send button, attachment button — many have no visible text. The agent sees:
```
[3] <button> 
[4] <button>
[5] <button>
```

No semantic information. The agent guesses, often wrong.

**Solution**: Enrich `buildDomTree.js` with accessibility attributes:
```javascript
// In buildDomTree.js element serialization:
function serializeElement(el, index) {
    return {
        index,
        tagName: el.tagName.toLowerCase(),
        text: el.innerText?.trim().slice(0, 100) || '',
        
        // AX enrichment:
        role: el.getAttribute('role') || inferRole(el),
        ariaLabel: el.getAttribute('aria-label') || '',
        ariaDescription: el.getAttribute('aria-describedby')
            ? document.getElementById(el.getAttribute('aria-describedby'))?.innerText : '',
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaChecked: el.getAttribute('aria-checked'),
        ariaSelected: el.getAttribute('aria-selected'),
        
        // For inputs:
        placeholder: el.getAttribute('placeholder') || '',
        inputType: el.type || '',
        
        // Stable identifiers (for caching):
        dataTestId: el.getAttribute('data-testid') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
    };
}
```

**LLM context transformation**:
```
Before: [3] <button>
After:  [3] <button role="button" aria-label="Compose new email" data-testid="compose-button">
```

**Expected impact**: Dramatic improvement in element identification for icon-heavy UIs. The agent can now confidently identify Gmail's compose button.

---

### 6.2 Shadow DOM Support

**Current state**: `buildDomTree.js` does not pierce shadow roots. Web Components (used heavily in Google apps, enterprise apps) are completely invisible.

**Solution**: Extend the DOM walker to traverse `shadowRoot`:
```javascript
function walkNode(node, depth = 0) {
    // ... existing processing ...
    
    // Pierce shadow roots:
    if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) {
            walkNode(child, depth + 1);
        }
    }
    
    for (const child of node.childNodes) {
        walkNode(child, depth + 1);
    }
}
```

**Tradeoff**: Shadow DOM elements cannot be located by standard CSS selectors from the page root. XPath also doesn't cross shadow boundaries. Locating them requires a CDP `DOM.describeNode` call or a JS evaluation that traverses the shadow tree explicitly. This adds complexity to `locateElement`.

**Expected impact**: Unlocks automation of Google's Material Web Components, many enterprise SaaS apps.

---

### 6.3 Hidden Element Hints

**Current state**: Elements outside the viewport are not included in the `selectorMap`. The LLM doesn't know they exist. When the agent can't find the "Send" button, it doesn't know it needs to scroll.

**Solution**: Add a hidden-elements section to the state message:
```javascript
// In buildDomTree.js:
const hiddenInteractive = [];
for (const el of allInteractiveElements) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < -100 || rect.top > window.innerHeight + 100) {
        hiddenInteractive.push({
            tag: el.tagName.toLowerCase(),
            label: el.getAttribute('aria-label') || el.innerText?.slice(0, 40) || '',
            direction: rect.top > window.innerHeight ? 'below' : 'above',
            scrollDistance: Math.abs(rect.top - window.innerHeight / 2),
        });
    }
}
```

**State message injection**:
```
## Elements Requiring Scroll
- button "Send" (scroll down ~200px)
- input "BCC" (scroll down ~400px)
```

**Expected impact**: Eliminates "I can't find the Send button" failures when the button is just below the fold. Agent knows to scroll rather than hallucinate a different approach.

---

### 6.4 Specialized DOM Queries by Intent

**Inspiration**: WebRover's separate `get_all_input_elements`, `get_all_button_elements`, `get_all_link_elements`.

**Current state**: `getClickableElements` returns all interactive elements regardless of what the agent needs.

**Improvement**: Add intent-based filtering:
```typescript
enum DOMQueryIntent {
    ALL = 'all',
    INPUTS = 'inputs',        // input, textarea, select, contenteditable
    BUTTONS = 'buttons',      // button, [role=button], submit
    LINKS = 'links',          // a[href], [role=link]
    NAVIGATION = 'navigation' // a[href], button[type=submit]
}

// When Navigator output contains input_text action → query INPUTS only
// When Navigator output contains click action targeting button → query BUTTONS
```

**Expected impact**: Reduces DOM context noise. When the agent wants to type, it sees only the 3 input fields, not all 50 interactive elements on the page.

---

### 6.5 Navigation Change Detection

**Current state**: `BrowserContext` only detects URL changes during explicit `waitForTabEvents`. If the user manually navigates, or if JavaScript triggers a history.pushState navigation, the agent doesn't know.

**Solution**: Subscribe to `chrome.tabs.onUpdated`:
```typescript
// In BrowserContext constructor or Tab Orchestrator:
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId !== this._currentTabId) return;
    if (changeInfo.status === 'complete' && tab.url) {
        const page = this._attachedPages.get(tabId);
        if (page && page.url() !== tab.url) {
            logger.info('[TabMonitor] URL changed mid-task:', tab.url);
            page.refreshValidWebPage(tab.url);
            // Invalidate cached DOM state
            page.invalidateCachedState();
        }
    }
});
```

**Expected impact**: Agent stays aware of navigation events it didn't initiate. Prevents stale DOM state being served after SPA route changes.

---

## 7. Memory & Context Evolution

### 7.1 Current Memory Architecture

```
System Prompt        → Static (set once, doesn't change)
Task Message         → Static (set once at task start)
State Messages       → Dynamic (DOM + screenshot, added/removed each step)
Action Results       → Ephemeral (added when includeInMemory=true, not cleaned up)
Plan Messages        → Added by Planner, stay in context
Model Outputs        → Added after each Navigator step
```

**Problem**: The context window grows linearly with steps. By step 20 of a complex Gmail task, the context contains:
- 20 DOM snapshots (most now irrelevant)
- 20 model outputs (mostly intermediate reasoning)
- 20 action results
- Various plan messages

Total: potentially 80,000+ tokens for a 20-step task. Most modern models have 128K-200K context windows, but the signal-to-noise ratio degrades heavily.

### 7.2 Message Compaction (High Priority for Long Tasks)

**Inspiration**: browser-use's `MessageCompactionSettings`

**Design**:
```typescript
interface CompactionSettings {
    enabled: boolean;
    maxTokensBeforeCompaction: number;  // default: 40_000
    compactionLLM?: BaseChatModel;      // can be a cheaper/faster model
    preserveLastN: number;              // always keep the last N steps verbatim
}
```

**Compaction flow**:
```typescript
// In MessageManager.addStateMessage():
if (this.estimatedTokens() > settings.maxTokensBeforeCompaction) {
    const summary = await this.compact(settings);
    // Replace all but last preserveLastN messages with a summary
    this._messages = [
        this._systemMessage,
        new HumanMessage(`## Task History Summary\n${summary}`),
        ...this._messages.slice(-settings.preserveLastN)
    ];
}
```

**Expected impact**: Enables tasks of unlimited length (50+ steps) without context overflow. The agent retains a compressed history rather than losing old context.

---

### 7.3 Selector Cache (Cross-Session Memory)

**Inspiration**: Stagehand's `ActCache`

**Design**:
```typescript
interface SelectorCacheEntry {
    cssSelector: string;
    xpath: string;
    lastSeen: number;     // timestamp
    hitCount: number;
    successRate: number;  // 0.0 - 1.0
}

// Key: hash(domain + aria-label + role) or hash(domain + data-testid)
// Storage: chrome.storage.local (persists across extension restarts)
```

**Usage in `locateElement`**:
```typescript
async locateElement(node: DOMElementNode): Promise<ElementHandle | null> {
    // 0. Check cache first (zero LLM cost)
    const cacheKey = this._getCacheKey(node);
    const cached = await selectorCache.get(cacheKey);
    if (cached) {
        const handle = await this._trySelector(cached.cssSelector);
        if (handle) {
            selectorCache.updateHit(cacheKey);
            return handle;
        }
        // Cache miss → fall through to full resolution
        selectorCache.evict(cacheKey);
    }
    
    // 1. CSS selector
    // 2. XPath  
    // 3. Heuristic
    // → on success, cache the winning selector
}
```

**Expected impact**: On frequently-visited sites (Gmail every day), 60-80% of element locations are cache hits. Zero LLM calls, near-instant execution. Cache heals automatically on miss (stale selector evicted, new one stored).

---

### 7.4 Cross-Session Task State

**Current state**: No task state persists across extension restarts or tab closures.

**Potential architecture**:
```typescript
interface PersistedTaskState {
    taskId: string;
    task: string;
    agentMemory: string;          // last memory scratchpad
    completedSubGoals: string[];  // sub-goals already achieved
    tabId: number;                // tab to resume on
    lastUrl: string;              // last known URL
    timestamp: number;
}
// Stored in chrome.storage.local
// Loaded if user returns to the extension with a running task
```

This enables "resume from where you left off" behavior — the agent can survive browser restarts for long-running tasks.

---

## 8. Long-Horizon Task Analysis

### 8.1 Current Limitations

Long tasks (>15 steps) currently face:

1. **Context overflow**: DOM state messages accumulate. Signal-to-noise degrades.
2. **Memory loss**: No scratchpad. Agent forgets what it has done.
3. **False completion**: No verification gate. Agent thinks it's done when it's not.
4. **Loop accumulation**: Semantic loops not detected until 3 exact-match outputs.
5. **No progress checkpoints**: If the extension is reloaded mid-task, all progress is lost.
6. **No subtask tracking**: Complex tasks ("research 5 startups and compare them") have no structured decomposition.

### 8.2 Architectural Approach for Long Tasks

**Tier 1 — Immediate (already described):**
- `evaluation_previous_goal` propagation → prevents blindness to own failures
- `memory` scratchpad → maintains task coherence
- Verification gate → prevents false completion
- Popup watchdog → eliminates dialog-blocking failures

**Tier 2 — Medium Term:**
- Message compaction → enables unlimited step counts
- Selector cache → reduces per-step overhead
- Semantic loop detection → earlier replanning

**Tier 3 — Structural:**
- Sub-goal FSM (explicit tracking of which sub-goals are complete)
- RAG over visited pages for research tasks
- Persistent task state in `chrome.storage.local`

### 8.3 Research Task Mode

WebGenie has the architecture to support a "research mode" analogous to WebRover's deep research agent. The key additions would be:

1. **Topic decomposition node**: LLM breaks task into N subtopics
2. **Per-subtopic research loop**: navigate → read → note → repeat
3. **Page content accumulation**: `getMarkdownContent` stored in-memory per subtopic
4. **Synthesis node**: LLM compiles all subtopic notes into final answer

This doesn't require a separate agent — it could be implemented as a specialized Planner strategy activated when the task description is research-oriented (contains keywords like "research", "compare", "summarize", "find information about").

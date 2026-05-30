# WebGenie: Complete Chromium API Integration Research
## Every Useful Chrome Extension API — What It Is, What It Enables, How to Integrate It

> Deep research document. No constraints. All APIs catalogued with agent-specific use cases,
> implementation approach, and WebGenie integration path for each.

---

## Tier 1: Core Power APIs (Highest Impact, Implement First)

---

### 1. `chrome.debugger` + Chrome DevTools Protocol (CDP)
**The single most powerful API available to a browser agent.**

The `chrome.debugger` API gives the extension a direct bridge into CDP — the same protocol that powers Chrome DevTools, Puppeteer, and Playwright. WebGenie currently uses Puppeteer indirectly through the extension; attaching the debugger directly unlocks capabilities Puppeteer cannot reach from within the extension context.

#### What it unlocks for WebGenie:
| CDP Domain | Agent Capability |
|---|---|
| `Accessibility.getFullAXTree` | Fetch the **complete semantic accessibility tree** — every role, label, description, state — for the entire page. Far richer than current interactive element serialization. |
| `DOM.getDocument` + `DOM.querySelectorAll` | Query any CSS selector directly, get back node IDs — no index mapping needed |
| `DOM.setAttributeValue` | Directly mutate DOM attributes — useful for unsticking stuck form fields |
| `Input.dispatchMouseEvent` | Synthesize precise mouse events (mousedown, mouseup, click, hover) with exact pixel coordinates — bypasses SPA event interception |
| `Input.dispatchKeyEvent` | Synthesize real keyboard events (keydown, keypress, keyup) with key codes — handles modal shortcuts like Escape, Enter, Tab |
| `Network.enable` + `Network.getResponseBody` | Intercept XHR/fetch responses in real-time — agent can read API payloads directly instead of scraping rendered HTML |
| `Runtime.evaluate` | Execute arbitrary JS in the page context with full return value capture |
| `Page.captureScreenshot` | Capture full-page screenshots (not just viewport) — enables vision-grounded reasoning on long pages |
| `Page.printToPDF` | Generate a PDF of any page programmatically |
| `Emulation.setGeolocationOverride` | Override GPS coordinates — enables location-dependent automation |
| `Emulation.setTimezoneOverride` | Override timezone — useful for time-sensitive workflows |
| `Fetch.enable` + `Fetch.fulfillRequest` | Intercept and respond to network requests before they reach the server — mock API responses, inject test data |
| `Storage.clearDataForOrigin` | Clear cookies, localStorage, IndexedDB for a domain — site reset / logout automation |
| `Security.setIgnoreCertificateErrors` | Bypass SSL warnings on internal/dev sites |

#### Integration in WebGenie:
```typescript
// In browser/context.ts or a new browser/cdp-bridge.ts
class CDPBridge {
  private debuggeeId: chrome.debugger.Debuggee;

  async attach(tabId: number): Promise<void> {
    await chrome.debugger.attach({ tabId }, '1.3');
    this.debuggeeId = { tabId };
  }

  async getAccessibilityTree(): Promise<AXNode[]> {
    const result = await chrome.debugger.sendCommand(
      this.debuggeeId, 'Accessibility.getFullAXTree', {}
    );
    return (result as any).nodes;
  }

  async interceptNetworkResponse(urlPattern: string): Promise<NetworkResponse> {
    await chrome.debugger.sendCommand(this.debuggeeId, 'Fetch.enable', {
      patterns: [{ urlPattern, requestStage: 'Response' }]
    });
    // listen on chrome.debugger.onEvent for Fetch.requestPaused
  }
}
```

**Permission required:** `"debugger"` in manifest.json

---

### 2. `chrome.scripting`
**The primary injection API — WebGenie already uses this, but it has deeper capabilities.**

#### Untapped capabilities:
- **`scripting.executeScript` with `world: 'MAIN'`** — Execute in the page's own JS context (not isolated), allowing access to page-private variables, frameworks, React state trees
- **`scripting.registerContentScripts`** — Register persistent content scripts at runtime, not just at install time — enables dynamic agent tool injection
- **`scripting.insertCSS` / `removeCSS`** — Inject/remove CSS to highlight, reveal hidden elements, or force-display tooltips

#### WebGenie agent actions to add:
```typescript
// Execute in MAIN world to access React/Vue/Angular component state
await chrome.scripting.executeScript({
  target: { tabId },
  world: 'MAIN',
  func: () => {
    // Access React fiber for form validation state
    const el = document.querySelector('[data-testid="submit"]');
    const fiber = (el as any)._reactFiber;
    return fiber?.memoizedState;
  }
});
```

**Permission required:** `"scripting"` (already in manifest)

---

### 3. `chrome.declarativeNetRequest` + `chrome.webRequest`
**Network-layer visibility and control.**

#### What the agent gains:

| Capability | Use Case |
|---|---|
| **Block/redirect requests** | Block tracking pixels, analytics scripts that slow page load during automation |
| **Modify request headers** | Add custom `Authorization` headers, bypass CORS restrictions for API calls the agent needs to make |
| **Inspect response headers** | Detect redirects, auth challenges, content type changes |
| **Monitor XHR responses** | Know when a form submission succeeded (HTTP 200 from API) vs. errored (400/500) — much more reliable than DOM change detection |
| **Cache bypass** | Force fresh content for verification steps |

#### Agent-specific integration:
```typescript
// Listen for AJAX completion to verify form submission success
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.statusCode >= 200 && details.statusCode < 300) {
      context.registerNetworkSuccess(details.url, details.statusCode);
    } else if (details.statusCode >= 400) {
      context.registerNetworkFailure(details.url, details.statusCode);
    }
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'fetch'] }
);
```

This gives the agent **ground truth verification** — it knows a form submission actually reached and was accepted by the server, not just that the UI appeared to respond.

**Permission required:** `"webRequest"`, `"declarativeNetRequest"`

---

## Tier 2: Context & State APIs (High Value for Agent Awareness)

---

### 4. `chrome.webNavigation`
**Granular page lifecycle events — the agent's navigation oracle.**

Current WebGenie relies on polling for page load. `chrome.webNavigation` provides real-time, event-driven navigation signals:

| Event | What the Agent Learns |
|---|---|
| `onBeforeNavigate` | Page is about to change — agent can snapshot current state |
| `onCommitted` | URL has committed — record new URL, clear old failure registry |
| `onDOMContentLoaded` | DOM is ready but resources still loading — can start reading structure |
| `onCompleted` | Page fully loaded — safe to interact with elements |
| `onErrorOccurred` | Navigation failed — trigger retry or report error |
| `onHistoryStateUpdated` | SPA client-side navigation (pushState) — the event Chrome fires for Gmail, Twitter, GitHub SPAs |

**This is critical for SPA detection.** Gmail's navigation never fires `onCompleted` after the initial load — only `onHistoryStateUpdated`. WebGenie needs this to know when the agent's page has actually changed.

```typescript
// Proper SPA navigation detection
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, url }) => {
  context.clearFailuresForUrl(previousUrl);
  context.currentUrl = url;
  context.emitNavigationEvent(url);
});
```

**Permission required:** `"webNavigation"`

---

### 5. `chrome.cookies`
**Full cookie management — enables authentication state control.**

#### Agent use cases:
- **Export session cookies** before a long task → restore them if the session expires mid-task
- **Inject authentication cookies** to skip login for known accounts
- **Read CSRF tokens** from cookies to include in form submissions
- **Detect login state** by checking for session cookies like `SAPISID` (Google) or `sessionid` (Django apps)

```typescript
// Check if user is logged into Google
const cookies = await chrome.cookies.getAll({ domain: '.google.com' });
const isLoggedIn = cookies.some(c => c.name === 'SAPISID');
context.setAuthState('google.com', isLoggedIn);
```

**Permission required:** `"cookies"`

---

### 6. `chrome.tabs`
**Full tab orchestration — already partially used, massive untapped potential.**

#### Untapped capabilities for agent:
| Method | Agent Use Case |
|---|---|
| `tabs.duplicate` | Clone current tab before risky operation — instant rollback |
| `tabs.discard` | Free memory from background tabs the agent opened |
| `tabs.sendMessage` | Communicate with content scripts running in specific tabs |
| `tabs.query({ active: true, audible: true })` | Detect if a video/audio tab is playing before interacting |
| `tabs.zoom` | Set zoom level for better element visibility/interaction |
| `tabs.goBack` / `tabs.goForward` | Navigate browser history without reloading |
| `tabs.captureVisibleTab` | Capture screenshot of any tab without needing debugger |

#### Critical for recovery:
```typescript
// Snapshot before risky action
async rollbackCapability(tabId: number): Promise<() => Promise<void>> {
  const duplicatedTab = await chrome.tabs.duplicate(tabId);
  return async () => {
    await chrome.tabs.update(tabId, { url: duplicatedTab.url });
    await chrome.tabs.remove(duplicatedTab.id!);
  };
}
```

**Permission required:** `"tabs"` (already in manifest)

---

### 7. `chrome.history`
**Access to the user's full browsing history — agent's temporal context.**

#### Agent use cases:
- **Before navigating somewhere**, check if the user has been there before — pre-populate the semantic cache with known-visited pages
- **Find recently visited login pages** for a domain — agent knows authentication workflow has been done before
- **Detect repeated URL visits** — if the agent loops back to the same URL 3 times, it knows to try a different approach

```typescript
// Check if domain was recently visited (within 7 days)
const results = await chrome.history.search({
  text: 'github.com',
  startTime: Date.now() - 7 * 24 * 60 * 60 * 1000,
  maxResults: 10
});
const isKnownDomain = results.length > 0;
```

**Permission required:** `"history"`

---

### 8. `chrome.downloads`
**Complete file download automation.**

#### Agent actions to expose:
- `download_file(url, filename)` — Download a file to the user's system
- `monitor_download(downloadId)` — Wait for download to complete, get final path
- `open_downloaded_file(downloadId)` — Open the file after download

```typescript
// Agent action: download + confirm
const downloadId = await chrome.downloads.download({
  url: fileUrl,
  filename: suggestedFilename,
  saveAs: false // no user picker
});
// Poll until state === 'complete'
await waitForDownload(downloadId);
```

**Permission required:** `"downloads"`

---

## Tier 3: Intelligence & Content APIs

---

### 9. Chrome Built-in AI APIs (Gemini Nano — On-Device)
**Available from Chrome 138+ — runs entirely locally, zero API cost.**

#### Available APIs (2025–2026):
| API | What it does | Agent Use |
|---|---|---|
| **`LanguageModel` (Prompt API)** | Run Gemini Nano locally for any NLP task | Step summarization for Memory Pyramid compaction — zero cost, zero latency |
| **`Summarizer`** | On-device text summarization with format control | Summarize extracted page content before injecting into context |
| **`Translator`** | On-device translation (100+ languages) | Translate non-English pages to English before LLM reasoning |
| **`LanguageDetector`** | Detect page language | Route translation before DOM parsing |
| **`Writer` / `Rewriter`** (experimental) | Write or rewrite text | Compose emails, fill text fields with generated content |

#### Integration for Memory Pyramid:
```typescript
// Use on-device Gemini Nano for step compaction — free and instant
async compactStepsLocally(steps: string[]): Promise<string> {
  if (!('LanguageModel' in self)) return steps.join(' | ');

  const session = await (self as any).LanguageModel.create({
    systemPrompt: 'Summarize browser automation steps concisely. Preserve all URLs, IDs, and extracted values verbatim.'
  });
  return await session.prompt(`Compress these steps:\n${steps.join('\n')}`);
}
```

**Permission required:** None — built into Chrome 138+

---

### 10. `chrome.pageCapture`
**Save any page as a complete MHTML archive.**

#### Agent use case:
- **Research tasks**: Save the full page (with all images, CSS, scripts) as a single MHTML file after extracting information
- **Evidence preservation**: Before modifying a form, save the current page state as proof
- **Offline processing**: Capture a complex page for later analysis without keeping the tab open

```typescript
// Save page as MHTML for offline reference
const mhtmlData = await chrome.pageCapture.saveAsMHTML({ tabId });
// Store as Blob in chrome.storage or download it
```

**Permission required:** `"pageCapture"`

---

### 11. `chrome.tabCapture` + `MediaStream`
**Real-time video capture of any tab.**

#### Agent use cases:
- **Vision-grounded automation**: Stream tab video to a vision model in real-time for live page understanding
- **Action recording**: Record a task execution as a video for replay/debugging
- **Visual verification**: Compare a screenshot frame from the stream against an expected visual state

```typescript
// Capture tab stream for vision-grounded reasoning
const streamId = await new Promise<string>(resolve =>
  chrome.tabCapture.capture({ video: true, audio: false }, stream => {
    resolve(stream.id);
  })
);
// Feed streamId to getUserMedia() → canvas → base64 → vision model
```

**Permission required:** `"tabCapture"`

---

## Tier 4: System & Orchestration APIs

---

### 12. `chrome.alarms`
**Persistent timers that survive service worker restarts.**

#### Agent use cases:
- **Scheduled tasks**: "Check this page in 30 minutes and report changes"
- **Retry scheduling**: Schedule a failed action retry without blocking
- **Session health checks**: Ping active sessions to prevent timeout

```typescript
// Schedule a page check in 30 minutes
chrome.alarms.create('check-page', { delayInMinutes: 30 });
chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === 'check-page') await agent.verifyPageState();
});
```

**Permission required:** `"alarms"`

---

### 13. `chrome.identity`
**OAuth2 authentication — agent acts on behalf of the user with Google/GitHub/etc.**

#### What this unlocks:
- **Google APIs**: Agent can call Gmail API, Google Docs API, Google Calendar API, Drive API — manipulating data directly via API instead of via DOM automation
- **GitHub API**: Create issues, PRs, comments via API — more reliable than UI automation
- **Any OAuth2 provider**: Authenticate and get tokens for any supported service

```typescript
// Get Google OAuth2 token for direct API access
const token = await chrome.identity.getAuthToken({ interactive: true });
// Now call Gmail API directly — more reliable than UI automation
const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
  headers: { Authorization: `Bearer ${token}` }
});
```

**Permission required:** `"identity"` + `oauth2` in manifest

---

### 14. `chrome.storage.session`
**Tab-session-scoped storage — lost when browser closes, not when service worker restarts.**

This is the **perfect home for the Memory Pyramid**:
- Survives service worker spin-down (unlike in-memory variables)
- Lost on browser close (unlike `storage.local` which persists forever)
- Faster than `storage.local` (no disk I/O)
- Up to 10MB capacity (much larger than `storage.sync`)

```typescript
// Store Memory Pyramid in session storage
await chrome.storage.session.set({ [`pyramid_${taskId}`]: pyramidState });
const { [`pyramid_${taskId}`]: restored } = await chrome.storage.session.get(`pyramid_${taskId}`);
```

**Permission required:** None — available by default

---

### 15. `chrome.notifications`
**System-level notifications — agent communicates without blocking task execution.**

#### Agent use cases:
- Notify user when a long-running task completes
- Alert user when human input is needed (HITL)
- Report errors without interrupting the agent's flow

```typescript
chrome.notifications.create('task-complete', {
  type: 'basic',
  iconUrl: 'icons/icon128.png',
  title: 'WebGenie: Task Complete',
  message: `Successfully completed: ${taskDescription}`
});
```

**Permission required:** `"notifications"`

---

### 16. `chrome.contextMenus`
**Right-click menu integration — agent bootstrapping from user selection.**

#### Agent use cases:
- Right-click any text → "Send to WebGenie Agent" → start a task with that text as context
- Right-click a link → "Let WebGenie follow this" → agent navigates and processes the link
- Right-click an image → "Extract data from this page into spreadsheet"

```typescript
chrome.contextMenus.create({
  id: 'webgenie-task',
  title: 'Run WebGenie task on "%s"',
  contexts: ['selection']
});
chrome.contextMenus.onClicked.addListener(({ selectionText }) => {
  agent.startTask(`Research: ${selectionText}`);
});
```

**Permission required:** `"contextMenus"`

---

### 17. `chrome.sidePanel`
**Persistent side panel UI — WebGenie already uses this. Advanced patterns below.**

#### Untapped integration:
- **Reactive step display**: Stream each agent step into the side panel in real-time as a live feed
- **HITL interface**: When `waitingForHuman: true`, render an interactive form in the side panel
- **Memory Inspector**: Show the active Memory Pyramid contents — what the agent knows right now
- **DOM Highlighter**: As the agent considers an element, highlight it on the page and show it in the panel simultaneously

**Permission required:** `"sidePanel"` (already in manifest)

---

## Tier 5: Advanced / Specialized APIs

---

### 18. `chrome.commands`
**Keyboard shortcut bindings — trigger agent actions instantly.**

```json
// manifest.json
"commands": {
  "start-agent": { "suggested_key": { "default": "Ctrl+Shift+W" }, "description": "Start WebGenie" },
  "pause-agent": { "suggested_key": { "default": "Ctrl+Shift+P" }, "description": "Pause agent" }
}
```

---

### 19. `chrome.omnibox`
**Address bar integration — start agent tasks by typing in the URL bar.**

```typescript
// User types "wg research quantum computing" in omnibox
chrome.omnibox.onInputEntered.addListener((text) => {
  agent.startTask(text);
});
```

**Permission required:** `"omnibox"`

---

### 20. `chrome.permissions` (Dynamic)
**Request permissions at runtime — don't ask for everything upfront.**

Only request `"history"` or `"bookmarks"` when the user needs those features:
```typescript
const granted = await chrome.permissions.request({ permissions: ['history'] });
if (granted) await agent.enableHistoryContext();
```

---

## Implementation Priority Matrix

| API | Agent Impact | Effort | Priority |
|---|---|---|---|
| `chrome.webNavigation.onHistoryStateUpdated` | 🔴 Critical — SPA detection | Low | **Now** |
| `chrome.webRequest` — XHR monitoring | 🔴 Critical — ground truth verification | Medium | **Now** |
| `chrome.storage.session` — Memory Pyramid home | 🔴 Critical — Phase 2 infra | Low | **Phase 2** |
| `chrome.debugger` — CDP Accessibility Tree | 🟠 High — 10-15x better DOM | High | **Phase 3** |
| `chrome.identity` — OAuth2 direct API calls | 🟠 High — bypass UI for Google services | Medium | **Phase 3** |
| Chrome Built-in AI (Prompt API) | 🟠 High — free on-device compaction | Low | **Phase 2** |
| `chrome.cookies` — auth state | 🟡 Medium — session management | Low | **Phase 3** |
| `chrome.downloads` — file automation | 🟡 Medium — file tasks | Low | **Phase 3** |
| `chrome.tabs.duplicate` — rollback | 🟡 Medium — recovery | Low | **Phase 2** |
| `chrome.notifications` — task status | 🟢 Low — UX polish | Low | **Later** |
| `chrome.contextMenus` — right-click tasks | 🟢 Low — UX feature | Low | **Later** |
| `chrome.alarms` — scheduled tasks | 🟢 Low — advanced scheduling | Low | **Later** |
| `chrome.pageCapture` — MHTML save | 🟢 Low — research tasks | Low | **Later** |
| `chrome.omnibox` — address bar | 🟢 Low — power user feature | Low | **Later** |

---

## Most Transformative Integration: WebNavigation + WebRequest Combo

The single highest-ROI integration is combining `chrome.webNavigation.onHistoryStateUpdated` (SPA detection) with `chrome.webRequest.onCompleted` (XHR success verification):

```
Current: Agent clicks "Submit" → waits 2s → checks if DOM changed → unreliable
Future:  Agent clicks "Submit" → webRequest fires onCompleted with HTTP 200 → CONFIRMED success
```

This eliminates the #1 source of false positives in form automation: the agent thinking a submission succeeded when it actually silently failed.

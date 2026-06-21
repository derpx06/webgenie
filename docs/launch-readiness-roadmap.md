# WebGenie Launch Readiness Roadmap (T-Minus 1 Week)

This roadmap outlines the final critical steps, architectural hardening, and high-value feature integrations required before the official release. It ensures WebGenie operates flawlessly within Chrome's Manifest V3 limits and offers a premium user experience.

## 1. Architecture Improvements & MV3 Best Practices

Chrome's Manifest V3 (MV3) imposes strict limits on Service Workers. They are forcibly killed after 5 minutes, or 30 seconds of inactivity. Currently, we bypass this because the `debugger` API keeps the worker alive. We must harden this.

### A. The Service Worker Lifeline
- **Problem**: If the agent is doing a pure background reasoning task (no DOM interaction), Chrome might kill the service worker mid-thought.
- **Solution**: Implement a background heartbeat using `chrome.alarms` or `navigator.locks` to guarantee the LLM executor never crashes during a long generation cycle.

### B. Storage Bottlenecks (IndexedDB Migration)
- **Problem**: We currently store conversation history and massive DOM text trees in `chrome.storage.local`. While we have the `unlimitedStorage` permission, the I/O operations block the main thread and can slow down the browser.
- **Solution**: Refactor the `ChromeStorageProvider` to use IndexedDB for heavy payloads (like Chat History and DOM snapshots), reserving `chrome.storage.local` strictly for lightweight configuration settings.

### C. Offscreen Documents for Heavy Computation
- **Problem**: Background Service workers lack access to full DOM APIs (like Canvas or WebGL).
- **Solution**: Integrate `chrome.offscreen`. If the agent needs to parse a complex PDF or execute heavy visual analysis without interrupting the user's active tab, it can spawn an invisible offscreen document to do the heavy lifting.

---

## 2. High-Value Integrations (New Tools)

We have the core "God Mode" built. Here are the final integrations that will make the agent truly "Next Gen":

### A. The Autonomous Agent (Alarms & Idle)
- **Implementation**: Allow the agent to schedule tasks (`chrome.alarms`) and trigger background cleanup when you step away (`chrome.idle`). (See `autonomous-agent-plan.md` for full specs).

### B. The Archival Agent (Page Capture)
- **Implementation**: Integrate `chrome.pageCapture`. Add an agent tool called `saveOffline`. If you ask the agent to "save this research for my flight", it natively dumps the entire webpage (HTML, CSS, Images) into a single `.mhtml` file on your hard drive.

### C. The Voice Agent (TTS)
- **Implementation**: We already have Speech-to-Text (`SpeechToTextService.ts`). We should add Text-to-Speech using `chrome.tts`. The agent can audibly read its answers or summarize long articles to you while you look at other tabs.

### D. Declarative Ad/Popup Blocking
- **Implementation**: Integrate `chrome.declarativeNetRequest`. If a website has aggressive popups that break the agent's vision, the agent can dynamically generate a blocking rule to nuke the popups before it tries to click anything.

---

## 3. Refactoring & Code Quality

Before launch, the codebase must be pristine to avoid unpredictable edge cases.

### A. Eradicate `any` Types
- **Context**: ESLint currently flags 105 instances of `any` types, primarily inside the `chromium-apis/` directory.
- **Action**: Refactor the data bridges. Create strict TypeScript interfaces or Zod schemas for all Chromium API payloads (like `BookmarkTreeNode` and `TabGroup`) so we have 100% compile-time safety.

### B. Fallback Provider Logic
- **Context**: If OpenAI or Anthropic goes down, the extension currently throws a hard error.
- **Action**: Implement a graceful fallback in `background/index.ts`. If `navigatorLLM` fails with a 500/429 error, it automatically falls back to a secondary provider configured in the user's settings.

### C. Side Panel State Synchronization
- **Context**: If the Chrome browser is force-quit, the side panel loses its exact UI state.
- **Action**: Persist the side panel's local React state (current text input, active tab ID) into `chrome.storage.session` continuously, so it resumes perfectly upon reopening.

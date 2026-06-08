# WebGenie Background Agent & Prompt System Manifest

This document provides a complete technical map of the WebGenie background/agent architecture, including its directory structure, agent prompts, action tools, and the redesigned memory system.

---

## 1. Directory & File Mapping

All background processes and agent subsystems reside under the directory:
[`chrome-extension/src/background/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background)

### 📂 Main Folders

*   [`agent/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent): Core AI agent execution logic, prompts, and memory managers.
*   [`browser/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/browser): Puppeteer-core wrapper, CDP/Tab tools, and DOM extraction utilities.
*   [`services/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/services): Chrome runtime background services (e.g. extension state listeners, storage listeners).
*   [`adapters/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/adapters): Interface layers bridging LangChain models and extension execution targets.
*   [`commands/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/commands): Static Chrome extension commands.
*   [`core/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/core): Low-level browser initialization routines.

---

## 2. Agent Subsystem (`src/background/agent/`)

### 📄 Detailed File System: `src/background/agent/`

| File / Folder Path | Type | Purpose |
| :--- | :--- | :--- |
| [`executor.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/executor.ts) | File | The orchestrator of the agent loop. It manages execution states, runs intent classification on new inputs, and coordinates agent steps. |
| [`types.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/types.ts) | File | Core types, including `AgentContext`, `AgentOptions`, `ActionResult`, and the Zod validation schemas. |
| [`history.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/history.ts) | File | Manages task execution steps and logs the historical records. |
| [`helper.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/helper.ts) | File | Common utility functions for formatting raw models responses. |
| [`index.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/index.ts) | File | Entry-point exporting executor modules and types. |
| [`event/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/event) | Folder | Pub/Sub event dispatcher for agent status. Includes `manager.ts` and `types.ts`. |
| [`messages/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/messages) | Folder | Manages the conversation message history storage and UI rendering (`service.ts`, `views.ts`, `utils.ts`). |
| [`actions/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/actions) | Folder | Tool execution handlers and Zod parameters schemas. |
| [`agents/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agents) | Folder | Contains actual sub-agent roles like the `Navigator` and the `Planner`. |
| [`prompts/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/prompts) | Folder | Base abstract prompt generator classes and templates folder containing markdown templates. |

---

## 3. Browser & DOM Context Subsystem (`src/background/browser/`)

This directory is responsible for direct browser control, DOM parsing, and Chrome Extension API interactions.

| File / Folder Path | Type | Purpose |
| :--- | :--- | :--- |
| [`page.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/browser/page.ts) | File | The primary high-level tab page handler. Includes stabilized CDP coordinate clicks, typing simulations, and screenshot logic. |
| [`context.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/browser/context.ts) | File | Coordinates browser page targets, tab states, and active viewport dimensions. |
| [`util.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/browser/util.ts) | File | Utility functions for tab loading indicators and URL validations. |
| [`views.ts`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/browser/views.ts) | File | Defines the data representation for browser tab history and active window layouts. |
| [`dom/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/browser/dom) | Folder | Standard DOM parser utilities: `views.ts` (declares DOMElementNode/DOMTextNode), `service.ts` (DOM snapshot builder/highlighter overlays), and `raw_types.ts` (pure JS injector structures). |
| [`chromium-apis/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/browser/chromium-apis) | Folder | Wraps native chrome extension APIs: `tab-tools.ts`, `scripting-tools.ts`, `cdp-bridge.ts`, and `dom-snapshot-extractor.ts`. |

---

## 4. In-Chat & Global Memory Subsystem

The memory layer is split into **In-Chat (Tab-scoped)** and **Global (Cross-session)** namespaces under [`agent/memory/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/memory):

```
chrome-extension/src/background/agent/memory/
├── index.ts                     # Root entry point exporting both in-chat and global namespaces
├── in-chat/                     # In-chat memory sub-module
│   ├── index.ts                 # In-chat entry point
│   ├── types.ts                 # Types for in-chat memory items, goals, intents
│   ├── goal-manager.ts          # Tracks primary/current/subgoal hierarchy & revisions
│   ├── progress-tracker.ts      # Tracks completed/remaining/current tasks
│   ├── recent-actions.ts        # Sliding window buffer for last 3-5 actions
│   ├── intent.ts                # Intent classifier (CONTINUE_TASK, NEW_TASK, etc.)
│   ├── in-chat-memory.ts        # InChatMemory orchestrator & slot-based conflict resolver
│   └── context-builder.ts       # Message assembler to bypass raw transcript history
└── global/                      # Global memory sub-module
    ├── index.ts                 # Global entry point
    ├── types.ts                 # Cross-session schema (SelectorAnchor, EpisodicNote, DomainRecord)
    ├── memory-store.ts          # WebGenieMemoryStore (file-persisted KV / A-MEM)
    └── context-router.ts        # ContextRouter (attention masks, briefing blocks, intent similarity)
```

### 🧠 In-Chat Memory Structures
*   **`GoalManager`**: Stores the primary user goal and tracks changes to the active sub-goal. Archives old goals when they are modified or replaced.
*   **`ProgressTracker`**: Tracks tasks using a checklist format: `progress_completed`, `progress_remaining`, and `progress_current`.
*   **`RecentActionBuffer`**: Maintains a rolling queue (max capacity 3-5) of the agent's most recent actions, ensuring immediate local step context.
*   **`InChatMemory`**: Orchestrates facts, constraints, and decisions. Uses slot-based deduplication to overwrite older records with fresh information.
*   **`ContextBuilder`**: Compiles these active structures directly into the prompt system message, completely bypassing raw chat history to avoid context drift and token bloat.

### 🌐 Global Memory Structures
*   **`WebGenieMemoryStore`**: A persistent JSON store mapping cross-session knowledge such as selector anchors, episodic notes, and domain records.
*   **`ContextRouter`**: Maps layout hashes, checks intent similarities, generates domain briefings, and computes DOM attention masks to highlight important elements.

---

## 5. Agent Prompts & System Instructions

Prompts are located under [`agent/prompts/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/prompts).

### 🧭 Navigator Agent (`templates/navigator.ts`)
The Navigator is tasked with direct page interactions.
*   **Role**: An elite, highly decisive web operator that acts with absolute certainty.
*   **Visual Layout Rules**: Learns from indentation levels (`\t`) representing child elements in the DOM snapshot.
*   **Memory Integration**:
    *   💡 **FAST PATH**: Tries verified selectors from previous sessions immediately.
    *   **Past Sessions**: Follows proven routes for matching domain targets.
    *   **Domain Intelligence**: Uses domain briefs to skip basic layout orientation.
*   **Response Protocol**: Must always respond with a valid JSON containing:
    1.  `current_state.evaluation_previous_goal`: Evaluation of the previous step.
    2.  `current_state.memory`: Summary of current execution statistics.
    3.  `current_state.extracted_facts`, `extracted_constraints`, `extracted_decisions`, `progress_completed`, `progress_remaining`, `progress_current`, and `pinned_items`.
    4.  `action`: Array of sequential commands to run.

### 🗺️ Planner Agent (`templates/planner.ts`)
The Planner processes tasks and determines whether browser navigation is required.
*   **Role**: Orchestrates high-level strategies and analyzes the results of operations.
*   **Responsibilities**:
    1.  Determines if `web_task` is `true`. If `false`, responds directly using `final_answer`.
    2.  If `true`, breaks down the request into 1-3 high-level actionable steps.
    3.  Maintains stability check rules (e.g. scroll maximum of one page at a time).
    4.  **Completion Verification**: Prohibits setting `done: true` in the same step as an interaction (e.g. clicking submit). It must wait for the next turn, verify the outcome visually (via screen/DOM), and then declare success.

---

## 6. Tools & Actions System

Actions are defined and routed under [`agent/actions/`](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/actions).

### 🛠️ Action schemas (`schemas.ts`)
Defines the schema for every tool the agent can execute:

*   `go_to_url`: Navigates to a specific URL.
*   `click_element`: Clicks an element via CSS/XPath.
*   `input_text`: Enters text into input/textarea components.
*   `clear_input`: Resets an input field's contents.
*   `hover_element`: Hovers the cursor over a DOM node.
*   `scroll_to_top` / `scroll_to_bottom`: Scrolls to page limits.
*   `next_page` / `previous_page`: Scrolls exactly one page length down or up.
*   `wait`: Pauses execution for a specified duration in milliseconds.
*   `switch_tab` / `open_tab` / `close_tab`: Tab management tools.
*   `get_complete_page_content`: Extracts full markdown textual page representation.
*   `ask_human`: Suspends autonomous execution to request verification or prompt for user inputs.
*   `done`: Declares the final goal complete and returns collected data.

### ⚙️ Handlers (`actions/handlers/`)
Files that contain the low-level Chrome extension execution APIs:
*   `interaction.ts`: Runs coordinate clicks (using stabilized `cdpClick`), inputs, hovers, and scrolls.
*   `navigation.ts`: Executes chrome tab navigation actions.
*   `tabs.ts`: Creates, moves, and deletes active browser tabs.
*   `content.ts`: Converts HTML pages to clean, readable markdown.
*   `keyboard.ts`: Simulates key inputs.
*   `system.ts`: Manages wait timeouts and final step declarations.

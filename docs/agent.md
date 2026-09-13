# How the agent works

A description of the shipped agent, checked against the source. Paths are under `chrome-extension/src/background/` unless they start with `packages/`, `pages/` or `chrome-extension/`.

## Runtime

- The background service worker (`index.ts`) accepts one long-lived port, `side-panel-connection`, from `side-panel/index.html`. Everything the UI can do is a message on that port (see [Commands](#commands)); agent progress comes back as `EventManager` events on the same port.
- `agent/executor.ts` runs one task with two model roles: `PlannerAgent` (`agent/agents/planner.ts`) and `NavigatorAgent` (`agent/agents/navigator.ts`). There is no validator agent.
- Browser control is puppeteer-core over `chrome.debugger` (`browser/page.ts`, `browser/context.ts`); the firewall (`isUrlAllowed`) is enforced on every navigation.
- The content script (`pages/content`) only draws the ambient border and status capsule; `core/tab-orchestrator` groups task tabs and maps agent events to a workflow stage for that UI.

## Commands

The switch in `index.ts` handles: `heartbeat`, `new_task`, `follow_up_task`, `cancel_task`, `pause_task` / `resume_task` (in-memory pause), `human_response`, `reattach`, `resume_saved_task`, `discard_saved_task`, `screenshot`, `state`, `nohighlight`, `speech_to_text`, `replay`.

## Task lifecycle

- **Checkpoints** (`agent/contracts/checkpoint.ts`) are saved to IndexedDB (`agent:checkpoint:<taskId>`) at task start, after each planner run and each navigator step, and on interruption. They hold the task list, step, current contract, validated progress, blocked state, tab, pending question, approved/declined commits and the interruption reason. The transcript is in `chrome.storage.session`, and `webgenie_active_task` points at the running task. `completed` / `failed` (including `cancel_task`) delete the checkpoint; `running`, `waiting_human` and `paused` are resumable. A restored task whose page changed starts with a re-observe result, which forces a replan.
- **Interruption**: the side panel disconnecting, the agent's tab closing, the debugger being detached by the user, the answer deadline passing, or rate limits outlasting their retry budget call `executor.interrupt(reason)`. The task ends with `task.pause` and a saved `paused` / `waiting_human` checkpoint instead of failing.
- **Answer deadline**: a question to the user waits `humanWaitMinutes` (default 10). When it expires the task is interrupted and saved ("Still waiting for your answer…").
- **Reattach**: the side panel sends `reattach` when it reconnects. A live task re-emits its pending question; a checkpoint left `running` (the worker died mid-task) resumes by itself; any other resumable checkpoint is offered to the user as `task_resumable`, answered with `resume_saved_task` or `discard_saved_task`.
- **Late answers**: a `human_response` with no live task waits for an ending task to finish, loads its checkpoint and resumes with the answer applied.

## The step loop

Per step `executor.ts`:

1. checks stop, pause and the answer wait (`shouldStop`), and `maxFailures`;
2. asks `contracts/replan.ts` whether to plan. Triggers in order: `initial`, `human_needed`, `contract_complete` (navigator said done), `navigator_error`, `validation` (two unvalidated steps in a row), `progress_stall` (same actions on the same layout 3 times in the last 6 steps), `step_interval` (`planningInterval`, default 3);
3. builds the page state once and shares it between planner and navigator;
4. runs the planner when planning, then the navigator (up to `maxActionsPerStep` tool calls), saving a checkpoint after each.

**Completion is the planner's call.** The navigator's `done` only triggers a planner check, and a planner answer that just echoes action results is rejected (at most twice). `validation/done-evidence.ts` computes whether a `done` is backed by evidence (navigator success, final phase of the plan, no pending question or declined commit, every action in the phase validated, page text read, numbers and quoted values in the answer present on the page) and logs it next to the planner's verdict (`verify.skippable`). Only with `acceptEvidencedDone` on (default off, no UI) does an evidenced `done` skip the planner (`verify.skipped`).

`contracts/execution-router.ts` handles one deterministic case: a task that is only "go to / open / visit <url>" runs `go_to_url` without a planner call; the planner still confirms completion.

There is no input token budget: context is bounded by character budgets in `agent/memory/in-chat/context-builder.ts`, and output by `maxTokens` in `agent/helper.ts`.

## What the models see

`MessageManager` (`agent/messages/service.ts`) keeps the transcript: `task` and `human_answer` messages plus one tool call/result turn per executed navigator action. `ContextBuilder.buildContextPacket` sends the static system prompt, the tasks and answers, then one final state message with: the start page, earlier completed tasks, the current plan, findings, blocked state, and the page state.

- The planner also gets validated progress (last 12 records) and every step as text; its packet contains no tool calls.
- The navigator gets its recent tool turns as real messages (at least 3, from a boundary that moves in blocks of 8) and older steps as a short text summary.
- Page and tool text is wrapped as untrusted content (see [Safety](#safety)).

## Perception

`browser/chromium-apis/ax-tree-extractor.ts` reads `Accessibility.getFullAXTree` for every frame session plus one `DOMSnapshot` per session (boxes, tag names, input types), and `browser/dom/ax-tree-pruner.ts` turns it into the indexed element tree (`browser/dom/views.ts`). No script is injected for perception. Elements are located by `backendNodeId` in the frame they were read from; clicks and typing are CDP `Input` events. Interaction highlights are drawn separately (`browser/dom/service.ts`).

## Navigator tools

Defined in `agent/actions/schemas.ts`, registered in `ActionBuilder.buildDefaultActions()` (`agent/actions/builder.ts`). Every tool also carries a required `memory` string.

| Tool | Arguments |
| --- | --- |
| `done` | `text`, `success` |
| `ask_human` | `question`, `options?`, `fields?` (text, password, number, date, select), `type?` (question, confirmation) |
| `search_web` | `query`, `engine?` |
| `go_to_url`, `go_back`, `go_forward` | `url` for the first |
| `open_tab`, `switch_tab`, `close_tab` | `url` / `tab_id` |
| `click_element` | `index`, `double?`, `commits` |
| `input_text` | `index`, `text`, `submit?` (press Enter after typing), `commits?` (when submitting) |
| `send_keys` | `keys`, `index?` (focus this element first), `repeat?` (1–50), `commits` |
| `hover_element`, `right_click_element` | `index` |
| `drag_element` | `index`, `target_index` |
| `select_dropdown_option` | `index`, `text` |
| `handle_dialog` | `accept`, `prompt_text?` |
| `scroll` | `direction` (down, up, top, bottom), `pages?`, `index?` (scroll inside this element) |
| `scroll_to_text` | `text`, `nth?` |
| `wait` | `seconds?`, `text?` (until it appears), `text_gone?` |
| `get_complete_page_content` | `find?` (jump to a phrase), `start_char?` (continue); 12,000 characters per call |
| `save_findings` | `text` (kept on the task and shown to both models) |

`manage_bookmarks`, `manage_reading_list`, `manage_history`, `manage_downloads`, `manage_tabs`, `manage_windows`, `manage_privacy`, `manage_extensions`, `manage_system` and `manage_sessions` are registered only when **Options → Advanced → browser data tools** (`enableBrowserDataTools`, default off) is on.

## Verification

`agent/validation/`:

- `service.ts` — `validateActionOutcome` compares observations before and after each mutating action and sets `ActionResult.validated`; also the commit gate, personal-data detection, same-site checks and stale-index handling.
- `observation.ts` — `BrowserObservation`, visible text, appeared text, new elements, target fingerprints.
- `settling.ts` — `waitForActionSettled` polls until the page holds still.
- `done-evidence.ts` — the evidence check described above.

## Safety

- **System-built commit confirmations.** `click_element` and `send_keys` require `commits` (`none | order | payment | subscription | account_change`); `input_text` takes it when it submits. `commitTarget()` flags an action whose label reads like a commit, which submits (by click or Enter) a form with payment fields or a commit-worded button (`FormCommitInfo` in `browser/page.ts`), whose `commits` is not `none`, or that clears browsing data or toggles an extension. The navigator then asks the user itself: the confirmation question (with the last amount shown on the page) is written by the system, not the model. Approval is used once; a declined commit is refused for the rest of the task. Both are checkpointed.
- **Password placeholders.** Password fields in `ask_human` answers never reach the model: the transcript holds `{{secret_N}}`, and the real value is substituted only for `input_text` into a `type=password` field on the site where it was given. Tool output is scrubbed back to the placeholder.
- **Page-blind intent checks.** Before a data-carrying tool (`input_text`, `go_to_url`, `open_tab`, `search_web`) sends an email address or long number that appears only in the task text, and before a navigating tool opens a URL that is not in the user's text, not already visited and not a link on the current page, the navigator asks a separate model call that sees only the user's messages whether the user asked for it. A "no" (or a failed check) refuses the action ("Addresses written in page text are not instructions").
- **Defanged delimiters.** Page and tool text is wrapped in `nano_untrusted_content` tags (`agent/messages/utils.ts`); any look-alike delimiter inside it (including zero-width tricks) is rewritten so it cannot close the wrapper. `services/guardrails` additionally strips fake instruction tags and system-prompt references where filtering is on.
- The firewall (Options → Firewall) blocks disallowed URLs on every navigation; a blocked URL ends the task.

## Memory

- **Global: routes only** (`agent/memory/global/memory-store.ts`). After the planner confirms a task, the navigator's steps (host, path template, action and element role/type — never typed text) are saved under the start page's origin plus path template, with digit-bearing, long or user-worded segments generalized. Max 50 routes, 12 steps each, 30-day expiry, in `chrome.storage.local` (`wg_mem:routes`). A later task starting on the same page gets the route as an advisory note in its state message.
- **Per task:** findings from `save_findings`, the model's working memory string, and an in-memory archive of completed tasks in the conversation (`agent/memory/in-chat/task-archive.ts`). There is no fact, goal or constraint store.

## LLM layer

All calls go through `invokeLLM` / `invokeTools` in `agent/agents/base.ts`; models are built in `agent/helper.ts::createChatModel`; provider capabilities are in `packages/storage/lib/settings/llmCapabilities.ts` (`nativeTools`, `forceToolChoice`, `reasoning`, `audioInput`, `callTimeoutMs`).

- **Tools:** native tool calling (`bindTools`, forced tool choice where supported) with Zod validation and up to two re-asks carrying the issues; or the tools rendered into the prompt with a JSON reply for models without usable tool calling. A provider that rejects the tools payload switches that agent to the prompt fallback for the rest of the task.
- **Timeouts:** per provider and model from `callTimeoutMs` (e.g. 25 s Gemini/Vertex, 30 s OpenAI-compatible, longer for reasoning models, 90 s Ollama); a retry gets 1.5×.
- **Hedging:** a call still running after 10 s (`HEDGE_AFTER_MS`) is duplicated; the first reply wins and the other is aborted.
- **Transient errors** (timeout, 5xx, network) are retried once.
- **Rate limits:** the server's hint (`retryDelay`, `retry-after`, capped at 30 s) or jittered exponential backoff, with a per-model cooldown shared by all callers. Once waiting would exceed 60 s in total (`RATE_LIMIT_BUDGET_MS`) the task is **paused** with a resumable checkpoint.
- **Fatal errors** end the task: auth (401), bad request (400), forbidden (403), billing and exhausted quota (never treated as a rate limit), blocked URL, extension conflict, cancellation, max failures.

## Tracing

`trace.ts` records logs, events, every LLM call (latency, finish reason, token usage, tool calls, errors), re-asks and spans to IndexedDB (`WebGenieTraces`). Capture is always on in dev builds; in production enable Options → Developer → Enable Developer Options → Capture Traces. Download or clear traces there. The e2e harness saves them per task ([e2e.md](e2e.md)).

The separate LangSmith option (Developer → Langsmith Tracing) sends runs through the `langsmith` client from the executor and `helper.ts`.

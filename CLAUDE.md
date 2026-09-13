# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

WebGenie — a Manifest V3 Chrome extension that runs a planner + navigator LLM browser-automation loop entirely client-side. pnpm + turbo monorepo (`chrome-extension`, `pages/*`, `packages/*`). `docs/agent.md` is the long-form description of the agent; `docs/e2e.md` covers the live test harness.

## Commands

```bash
pnpm install                       # pnpm 9.15.1, node >= 22.12
pnpm build                         # clean + turbo ready + build -> ./dist (load unpacked)
pnpm dev                           # watch build, __DEV__=true, HMR reload
pnpm type-check                    # tsc --noEmit across all packages
pnpm lint / pnpm prettier          # lint runs eslint --fix

pnpm -F chrome-extension test                              # vitest (only package with tests)
pnpm -F chrome-extension exec vitest run src/background/agent/validation/__tests__/settling.test.ts
pnpm -F chrome-extension exec vitest run -t "test name"

pnpm e2e                                              # build + live core suite (Vertex AI via gcloud)
E2E_SUITE=security pnpm -F chrome-extension e2e       # core|complex|hitl|security|breadth|endurance|resilience|memory|all
E2E_ONLY=T1,C13 E2E_HEADLESS=1 pnpm -F chrome-extension e2e
E2E_ORACLE=1 E2E_SUITE=all pnpm -F chrome-extension e2e   # check the checkers, no model calls
```

There is no root `test` script and no `test` task in `turbo.json` — unit tests only run through the `chrome-extension` package. `pnpm e2e` drives the built extension in Chromium against real sites and local fixtures; options (`E2E_MODEL`, `E2E_PLANNER_MODEL`, `E2E_REPEAT`, token caps, baseline update) are listed in `docs/e2e.md`. Results (summary with Wilson intervals and health counters, per-task events/trace/screenshot) go to the gitignored `chrome-extension/e2e/results/`; tasks whose site is unreachable are `site_down` and excluded. `chrome-extension/e2e/mind2web/` runs and judges an Online-Mind2Web slice.

`turbo ready` must run before any build: `packages/*` emit their `dist/` there and `@extension/i18n` generates its typed message keys. The root `build`/`dev` scripts already do this; if you build a single package directly, run `pnpm -F <pkg> ready` first.

## Architecture

### Runtime topology
Three independent Vite builds land in one `dist/`: the background service worker (`chrome-extension/`, single IIFE bundle from `src/background/index.ts`), the React pages (`pages/side-panel`, `pages/options`), and the content script (`pages/content`, which only draws the ambient border and status capsule). `chrome-extension/manifest.js` is the manifest source of truth (generated at build time by `utils/plugins/make-manifest-plugin`); edit it, not `dist/manifest.json`.

The side panel talks to the background over a long-lived port named `side-panel-connection`. The command switch in `chrome-extension/src/background/index.ts` is the single entry point for everything the UI can trigger: `new_task`, `follow_up_task`, `cancel_task`/`pause_task`/`resume_task`, `human_response`, `reattach`, `resume_saved_task`, `discard_saved_task`, `screenshot`, `state`, `nohighlight`, `speech_to_text`, `replay`, `heartbeat`. Agent progress flows back as events emitted by `EventManager` and forwarded over the same port.

### The agent loop
`agent/executor.ts` owns one task. Per step it: decides whether to re-plan (`contracts/replan.ts` — initial, human needed, navigator-claimed completion, navigator error, unvalidated steps, stall, or the `planningInterval` cadence), builds the page state once, runs `PlannerAgent` (when re-planning) and `NavigatorAgent` with that state, and saves a checkpoint. Completion is the *planner's* call; the navigator's `done` text is only the provisional answer. `validation/done-evidence.ts` logs whether a `done` was backed by evidence next to the planner's verdict (it only skips the planner with `acceptEvidencedDone`, default off). `contracts/execution-router.ts` runs a bare "go to <url>" task without a planner call.

Lifecycle: checkpoints (`contracts/checkpoint.ts`, IndexedDB) are saved at start, after every planner/navigator step and on interruption. Closing the side panel or the tab, detaching the debugger, the answer deadline (`humanWaitMinutes`) or rate limits outlasting their budget call `executor.interrupt()`, which emits `task.pause` and keeps a resumable checkpoint. On reconnect the panel sends `reattach`; a `human_response` that arrives after the task stopped resumes it from the checkpoint.

What the models see: `MessageManager` keeps a transcript of `task` and `human_answer` messages plus one tool call/result turn per executed navigator action. `ContextBuilder.buildContextPacket` sends the static system prompt, then the tasks and answers (and, for the navigator, its recent tool turns), then one final message with the start page, completed tasks, current plan, findings, validated progress (planner only), a text summary of older steps, and the page state. The planner gets the steps as text only, so its packet never contains tool calls.

There is no Validator agent — verification is `agent/validation/` (observation fingerprints, settling detection, `ActionResult.validated`, done evidence) plus the planner's completion check.

Safety lives in the navigator and `agent/validation/service.ts`: system-written commit confirmations (the `commits` argument, `commitTarget()`, payment-form detection via `FormCommitInfo` in `page.ts`), `{{secret_N}}` placeholders for passwords given through `ask_human`, page-blind intent checks (a model call that sees only the user's messages) before sending task-only personal data or opening a URL the page supplied, and defanged `nano_*` delimiters in `agent/messages/utils.ts`.

Memory: `agent/memory/global/memory-store.ts` stores routes only (host, path template, action, element role — never typed text), keyed by the start page and offered as an advisory note to a later task starting there. Per task there are only findings (`save_findings`), the model's working memory string and `in-chat/task-archive.ts`; there is no fact store.

### Adding an action
1. Zod schema in `agent/actions/schemas.ts` (index-based actions take `index`; the navigator maps it from the prompt's page read to the current one). Describe every field and put defaults in the handler, not in `.default()`. If the action can buy, subscribe or change an account, add it to `COMMIT_DECIDING_TOOLS` there (the model must then fill `commits`).
2. Handler class/method in `agent/actions/handlers/`.
3. Register in `ActionBuilder.buildDefaultActions()` (`agent/actions/builder.ts`); `manage_*` style browser-data tools go in `buildChromeControlActions` (gated by `enableBrowserDataTools`).
4. Check the per-tool lists: `commitTarget()` and `NAVIGATION_ACTIONS`/`SCROLL_ACTIONS`/`POINTER_ACTIONS`/`MUTATING_ACTIONS` in `agent/validation/service.ts` (whether it is gated and validated), `DATA_CARRYING_ACTIONS`/`NAVIGATING_ACTIONS`/`DIALOG_SAFE_ACTIONS`/`redactArgs` in `agent/agents/navigator.ts`, `LEGACY_ACTIONS` in `agent/agents/navigator/replay.ts` when renaming or removing a tool, and the tool names in `agent/prompts/templates/`.

Each registered action becomes one model tool: `buildToolDefinitions` (`actions/builder.ts`) converts its schema to `$ref`-free JSON Schema and adds the required `memory` field, and `NavigatorActionRegistry.getTools()` memoizes the result. `actions/__tests__/tools.test.ts` enforces the schema contract for every tool (and asserts the tool count).

### LLM providers
`agent/helper.ts::createChatModel` maps `ProviderTypeEnum` to a LangChain chat model. A new provider needs: the enum + defaults in `packages/storage/lib/settings/llmProviders.ts`, a branch in `createChatModel`, an entry in `packages/storage/lib/settings/llmCapabilities.ts`, and UI in `pages/options/src/components/model-settings/`. `ChatLlama` there is a local `ChatOpenAI` subclass that rewrites Llama API responses into OpenAI shape.

Every model call goes through `invokeLLM` / `invokeTools` in `agent/agents/base.ts`: native tool calling (`bindTools`, forced tool choice where supported) with Zod validation and up to two re-asks carrying the issues, or the same tools rendered into the prompt for models without usable tool calling. A provider that rejects the tools payload switches that agent to the prompt fallback for the task. What each provider supports (native tools, forced tool choice, reasoning control, audio input, per-model `callTimeoutMs`) lives in `llmCapabilities.ts`; keep provider-specific code there and in `helper.ts`. A call still running after `HEDGE_AFTER_MS` gets a duplicate request (first reply wins); transient errors retry once; rate limits honour the server's retry hint or back off with a per-model cooldown, and once `RATE_LIMIT_BUDGET_MS` is spent the task pauses (resumable). Auth, bad-request, forbidden, billing/quota, cancel and blocked-URL errors end the task.

### Browser control
`browser/page.ts` drives pages with **puppeteer-core over `chrome.debugger`**, not content-script messaging. `browser/context.ts` owns tab attach/detach and enforces the firewall (`isUrlAllowed`) on every navigation.

Perception reads the accessibility tree of every frame over CDP — `browser/chromium-apis/ax-tree-extractor.ts` (`Accessibility.getFullAXTree` per frame session, one `DOMSnapshot` per session for boxes, tag names and input types), then `dom/ax-tree-pruner.ts`. No script is injected for perception. Elements are located by `backendNodeId` in the frame they were read from; clicks and typing go through CDP `Input` events in `page.ts`.

### Service-worker constraints
No Node runtime: `index.ts` and `agent/helper.ts` shim `globalThis.process`, and `chrome-extension/vite.config.mts` aliases `node:async_hooks` and the AWS SDK credential providers to stubs in `agent/mocks/`. Any new dependency that reaches for a Node builtin needs a matching alias or it will break the worker bundle at runtime, not at build time.

### Tracing (use this to debug and test)
`background/trace.ts` persists structured records to IndexedDB (`WebGenieTraces` → `records`). Sources: every `createLogger()` call (all components), every `EventManager.emit` (task/step/act events), every LLM call in `invokeLLM` (latency, finish reason, token usage incl. cached and reasoning tokens, tool-call counts, errors) and every tool-call validation re-ask with its issues, and spans for `BrowserContext.getState`, navigator actions and validation. Records carry `taskId`/`step` via `setTraceContext` in the executor; keys and bearer/`ya29.` tokens are redacted.

- Capture is always on in dev builds; in production enable **Options → Developer Options → Enable Developer Options → Capture Traces**. **Download traces (JSONL)** / **Clear traces** live in the same section.
- Read them programmatically from any extension page (same origin): `indexedDB.open('WebGenieTraces')` → `records.getAll()`. Filter by `taskId`, `component`, `kind` (`log|event|llm|span|trace`), `level`.
- The extension's own token counters (`EventData.usage`) are cumulative and omit failed LLM calls — use `kind: 'llm'` records for true usage.
- Driving tasks from automation: the background only accepts `side-panel-connection` ports whose sender URL is exactly `side-panel/index.html`. After rebuilding, a Chromium restart with the same profile keeps the old cached service-worker script (same version); use a fresh profile, and don't call `runtime.reload()` on a `--load-extension` build (Chromium disables it).

### Conventions
- Chrome APIs go through the adapters in `background/adapters/` (`IBrowserAdapter`, `IStorageProvider`) so background logic stays unit-testable — see `docs/adr/0001-decouple-chrome-apis.md`. Direct `chrome.*` calls belong in the adapters and in `index.ts` event wiring.
- Persisted state uses `createStorage()` from `packages/storage/lib/base/base.ts` (chrome.storage, optional `liveUpdate` cross-context sync). Bulk agent/browser state uses `IndexedDBStorageProvider` (dexie) instead.
- All user-facing strings use `t()` from `@extension/i18n`; add the key to `packages/i18n/locales/en/messages.json` and re-run `ready` to regenerate types.
- `@typescript-eslint/consistent-type-imports` is enforced — use `import type`.

`docs/architecture/` and `docs/research/` hold long-form design notes and research; several describe proposals rather than shipped code, so check them against the source before relying on them.

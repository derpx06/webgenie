# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

WebGenie — a Manifest V3 Chrome extension that runs a multi-agent LLM browser-automation loop entirely client-side. pnpm + turbo monorepo (`chrome-extension`, `pages/*`, `packages/*`).

## Commands

```bash
pnpm install                       # pnpm 9.15.1, node >= 22.12
pnpm build                         # clean + turbo ready + build -> ./dist (load unpacked)
pnpm dev                           # watch build, __DEV__=true, HMR reload
pnpm type-check                    # tsc --noEmit across all packages
pnpm lint / pnpm prettier

pnpm -F chrome-extension test                              # vitest (only package with tests)
pnpm -F chrome-extension exec vitest run src/background/agent/validation/__tests__/settling.test.ts
pnpm -F chrome-extension exec vitest run -t "test name"
```

There is no root `test` script and no `test` task in `turbo.json` — tests only run through the `chrome-extension` package. `turbo e2e` exists as a task but no package implements it.

`turbo ready` must run before any build: `packages/*` emit their `dist/` there and `@extension/i18n` generates its typed message keys. The root `build`/`dev` scripts already do this; if you build a single package directly, run `pnpm -F <pkg> ready` first.

## Architecture

### Runtime topology
Three independent Vite builds land in one `dist/`: the background service worker (`chrome-extension/`, single IIFE bundle from `src/background/index.ts`), the React pages (`pages/side-panel`, `pages/options`), and the content script (`pages/content`). `chrome-extension/manifest.js` is the manifest source of truth (generated at build time by `utils/plugins/make-manifest-plugin`); edit it, not `dist/manifest.json`.

The side panel talks to the background over a long-lived port named `side-panel-connection`. The command switch in `chrome-extension/src/background/index.ts` (~line 294) is the single entry point for everything the UI can trigger: `new_task`, `follow_up_task`, `cancel_task`/`pause_task`/`resume_task`, `human_response`, `screenshot`, `state`, `nohighlight`, `speech_to_text`, `replay`, `heartbeat`. Agent progress flows back as events emitted by `EventManager` and forwarded over the same port.

### The agent loop
`agent/executor.ts` owns one task. Per step it: classifies user intent (`agent/memory/in-chat/intent.ts`), decides whether to re-plan (`contracts/replan.ts` — cadence, navigator-claimed completion, or stagnation), runs `PlannerAgent`, then `NavigatorAgent`, saves a checkpoint, and compacts message history. Completion is the *planner's* call (`done: true`), never the navigator's alone.

There is no Validator *agent* despite what the README says — verification lives in `agent/validation/` (observation fingerprints, settling detection, `ActionResult.validated`) and in the planner's completion check. `agent/contracts/` adds deterministic routing (`ExecutionRouter` can pre-plan actions and skip the LLM entirely), checkpoints for resume, token budgets, and traces.

Memory is two-tier: `agent/memory/in-chat/` (goals, constraints, facts, failure registry, timeline — per task) and `agent/memory/global/` (`ContextRouter`, domain-keyed episodic notes consolidated after a successful task).

### Adding an action
1. Zod schema in `agent/actions/schemas.ts` (include the shared `observationFields` for anything index-based).
2. Handler class/method in `agent/actions/handlers/`.
3. Register in `ActionBuilder.buildDefaultActions()` (`agent/actions/builder.ts`).

`NavigatorActionRegistry.setupModelOutputSchema()` builds the LLM's structured-output schema dynamically from the registry, so nothing else needs updating. It also injects `[DRAFT WARNING]` text into a tool's description after that tool fails, to steer the next attempt.

### LLM providers
`agent/helper.ts::createChatModel` maps `ProviderTypeEnum` to a LangChain chat model. A new provider needs: the enum + defaults in `packages/storage/lib/settings/llmProviders.ts`, a branch in `createChatModel`, and UI in `pages/options/src/components/model-settings/`. `ChatLlama` there is a local `ChatOpenAI` subclass that rewrites Llama API responses into OpenAI shape.

`BaseAgent.invoke()` prefers the provider's native `withStructuredOutput` but permanently downgrades that agent to manual JSON extraction (with `jsonrepair`) the first time a provider rejects the schema. Keep new schemas provider-portable — large or deeply nested schemas are what trigger the downgrade.

### Browser control
`browser/page.ts` drives pages with **puppeteer-core over `chrome.debugger`**, not content-script messaging. `browser/context.ts` owns tab attach/detach and enforces the firewall (`isUrlAllowed`) on every navigation.

DOM extraction runs in the page: `chrome-extension/public/dom/*.js` + `public/buildDomTree.js` are concatenated by `scripts/build-dom.mjs` into `public/dom-agent.min.js`, which `browser/dom/service.ts` injects per frame. **Edit the sources in `public/dom/`** — `dom-agent.min.js` is generated, and the root `old_buildDomTree.js` is dead legacy. (`PROJECT_STRUCTURE.md` places this file under `pages/content/` — that is stale.)

### Service-worker constraints
No Node runtime: `index.ts` and `agent/helper.ts` shim `globalThis.process`, and `chrome-extension/vite.config.mts` aliases `node:async_hooks` and the AWS SDK credential providers to stubs in `agent/mocks/`. Any new dependency that reaches for a Node builtin needs a matching alias or it will break the worker bundle at runtime, not at build time.

### Tracing (use this to debug and test)
`background/trace.ts` persists structured records to IndexedDB (`WebGenieTraces` → `records`). Sources: every `createLogger()` call (all components), every `EventManager.emit` (task/step/act events), every LLM call in `BaseAgent.invokeRawModel` (latency, finish reason, real token usage incl. failed attempts; raw model output + Zod issues on parse failure), and spans for `BrowserContext.getState`, navigator actions and validation. Records carry `taskId`/`step` via `setTraceContext` in the executor; keys and bearer/`ya29.` tokens are redacted.

- Capture is always on in dev builds; in production enable **Options → Developer Options → Enable Developer Options → Capture Traces**. **Download traces (JSONL)** / **Clear traces** live in the same section.
- Read them programmatically from any extension page (same origin): `indexedDB.open('WebGenieTraces')` → `records.getAll()`. Filter by `taskId`, `component`, `kind` (`log|event|llm|span|trace`), `level`.
- The extension's own token counters (`EventData.usage`) are cumulative and omit failed LLM calls — use `kind: 'llm'` records for true usage.
- Driving tasks from automation: the background only accepts `side-panel-connection` ports whose sender URL is exactly `side-panel/index.html`. After rebuilding, a Chromium restart with the same profile keeps the old cached service-worker script (same version); use a fresh profile, and don't call `runtime.reload()` on a `--load-extension` build (Chromium disables it).

### Conventions
- Chrome APIs go through the adapters in `background/adapters/` (`IBrowserAdapter`, `IStorageProvider`, `ILogger`, `ITelemetryReporter`) so background logic stays unit-testable — see `docs/adr/0001-decouple-chrome-apis.md`. Direct `chrome.*` calls belong in the adapters and in `index.ts` event wiring.
- Persisted state uses `createStorage()` from `packages/storage/lib/base/base.ts` (chrome.storage, optional `liveUpdate` cross-context sync). Bulk agent/browser state uses `IndexedDBStorageProvider` (dexie) instead.
- All user-facing strings use `t()` from `@extension/i18n`; add the key to `packages/i18n/locales/en/messages.json` and re-run `ready` to regenerate types.
- `@typescript-eslint/consistent-type-imports` is enforced — use `import type`.

`docs/architecture/` holds long-form design notes (several are aspirational proposals, not descriptions of shipped code — check against source before relying on them).

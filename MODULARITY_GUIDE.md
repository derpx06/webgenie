# WebSurfer Architecture & Modularity Guide

**Last Updated**: May 2026  
**Project**: WebSurfer - AI Web Automation Chrome Extension  
**Version**: 0.1.13

## Executive Overview

WebSurfer is a modular monorepo built with Turbo and pnpm workspaces. It orchestrates a multi-agent AI system that automates web tasks by understanding page structure, planning operations, and executing actions with safety guardrails.

### Key Architectural Principles

- **Modular Design**: Clear separation of concerns through distinct modules
- **Composable**: Modules work together through well-defined interfaces
- **Type-Safe**: Strong TypeScript throughout for reliability
- **Testable**: Each module designed for isolated unit testing
- **Maintainable**: Clear naming, documentation, and structure

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      UI Layer                               │
├──────────────────────┬───────────────────┬──────────────────┤
│   Side Panel         │   Options Page    │   Content Script │
│ (Chat Interface)     │ (Configuration)   │  (DOM Injection) │
└──────────────────────┴───────────────────┴──────────────────┘
                            │
                    Message Bus (Chrome APIs)
                            │
┌─────────────────────────────────────────────────────────────┐
│           Background Service Worker (Orchestrator)          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                  │
│  │   Agent Brain    │  │  Browser Layer   │                  │
│  ├──────────────────┤  ├──────────────────┤                  │
│  │ • Planner        │  │ • DOM Analysis   │                  │
│  │ • Navigator      │  │ • Page Interact  │                  │
│  │ • Executor       │  │ • Context Mgmt   │                  │
│  └──────────────────┘  └──────────────────┘                  │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                  │
│  │  Services        │  │ Shared Packages  │                  │
│  ├──────────────────┤  ├──────────────────┤                  │
│  │ • Security       │  │ • Storage        │                  │
│  │ • Analytics      │  │ • Types/Schemas  │                  │
│  │ • Voice          │  │ • i18n           │                  │
│  └──────────────────┘  └──────────────────┘                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
    [LLM APIs]      [Chrome APIs]       [Web Pages]
```

---

## Project Directory Structure

```
webSurfer/
│
├── chrome-extension/              # Main extension code
│   └── src/background/
│       ├── agent/                 # Multi-agent system
│       ├── browser/               # Browser automation layer
│       ├── services/              # Security, analytics, voice
│       ├── task/                  # Task management
│       └── index.ts               # Entry point
│
├── pages/                         # UI applications
│   ├── side-panel/               # Main chat UI
│   ├── options/                  # Settings UI
│   └── content/                  # Content script
│
├── packages/                      # Shared libraries
│   ├── storage/                  # Chrome storage abstraction
│   ├── ui/                       # React components
│   ├── shared/                   # Types, utils, constants
│   ├── i18n/                     # Internationalization
│   ├── schema-utils/             # Validation schemas
│   ├── tailwind-config/          # Design system
│   ├── vite-config/              # Build config
│   └── other-utils/              # Dev & utility packages
│
├── turbo.json                     # Build orchestration
├── pnpm-workspace.yaml            # Workspace config
└── package.json                   # Root scripts
```

---

## Module Deep Dive

### 1. Agent Module (`chrome-extension/src/background/agent/`)

**Purpose**: Core AI reasoning engine that plans and executes web tasks

**Key Components**:
- **Executor**: Orchestrates the entire agent lifecycle
- **Agents**: NavigatorAgent (web actions), PlannerAgent (strategy)
- **Actions**: Defines executable operations with schemas
- **Prompts**: LLM system contexts and instructions
- **Messages**: Communication with UI
- **Events**: Execution lifecycle tracking

**Entry Point**: `agent/index.ts` (barrel export)  
**Documentation**: `agent/README.md`

**Usage**:
```typescript
import { Executor, NavigatorAgent } from '@src/background/agent';
import type { AgentContext } from '@src/background/agent';

const executor = new Executor(options);
const result = await executor.executeTask('navigate to google.com');
```

### 2. Browser Module (`chrome-extension/src/background/browser/`)

**Purpose**: Abstraction layer for Chrome APIs and web interactions

**Key Components**:
- **DOM Analysis**: Parses page structure and builds accessibility trees
- **Page Interaction**: Executes clicks, typing, scrolling
- **Context Management**: Tracks browser state and tabs
- **Utilities**: Debug and helper functions

**Entry Point**: `browser/index.ts` (barrel export)  
**Documentation**: `browser/README.md`

**Usage**:
```typescript
import { DOM } from '@src/background/browser';
import BrowserContext from '@src/background/browser/context';

const context = new BrowserContext(tabId);
const domAnalysis = await DOM.DOMAnalysis.analyzePage(tabId);
await context.navigateTo('https://example.com');
```

### 3. Services Module (`chrome-extension/src/background/services/`)

**Purpose**: Cross-cutting concerns (security, analytics, voice)

**Key Services**:
- **SecurityGuardrails**: Content sanitization and threat detection
- **Analytics**: Performance tracking and metrics
- **VoiceProcessing**: Speech-to-text and audio handling

**Entry Point**: `services/index.ts` (barrel export)  
**Documentation**: `services/README.md`

**Usage**:
```typescript
import { SecurityGuardrails, analytics } from '@src/background/services';

const guardrails = new SecurityGuardrails();
const safe = guardrails.sanitizeContent(untrustedInput);
analytics.trackTaskComplete(taskId, metrics);
```

### 4. Side Panel (`pages/side-panel/`)

**Purpose**: Primary user interface for chat and task monitoring

**Components**:
- **Chat Interface**: Input, history, message display
- **Monitoring**: Agent status, execution feedback
- **Navigation**: Headers, bookmarks, preferences

**Entry Point**: `src/components/index.ts` (barrel export)  
**Documentation**: `src/README.md`

**Usage**:
```typescript
import { ChatInput, MessageList } from '@src/components';
import { useAgentConnection } from '@src/components/hooks';

function App() {
  const { sendMessage } = useAgentConnection();
  return (
    <>
      <ChatInput onSubmit={sendMessage} />
      <MessageList />
    </>
  );
}
```

### 5. Options Page (`pages/options/`)

**Purpose**: Settings and configuration management

**Panels**:
- **ModelSettings**: LLM provider configuration
- **FirewallSettings**: URL filtering rules
- **GeneralSettings**: App preferences
- **AnalyticsSettings**: Tracking preferences

**Entry Point**: `src/components/index.ts` (barrel export)  
**Documentation**: `src/README.md`

**Usage**:
```typescript
import { ModelSettings, FirewallSettings } from '@src/components';

function SettingsPage() {
  return (
    <>
      <ModelSettings />
      <FirewallSettings />
    </>
  );
}
```

### 6. Shared Packages (`packages/`)

**Storage** (`packages/storage/`): Chrome storage abstraction
- Centralized configuration storage
- Chat history persistence
- Quick access methods

**UI** (`packages/ui/`): Reusable React components
- Buttons, modals, cards
- Common patterns
- Consistent styling

**Shared** (`packages/shared/`): Types, utils, constants
- Common TypeScript types
- Utility functions
- Shared constants

**i18n** (`packages/i18n/`): Internationalization
- Multi-language support
- String management
- Placeholder handling

**Schema Utils** (`packages/schema-utils/`): Validation
- Zod schemas
- Config validation
- Type checking

**Tailwind Config** (`packages/tailwind-config/`): Design system
- Color palette
- Typography
- Design tokens

---

## Data Flow & Communication

### Multi-Agent Execution Flow

```
User Input (Side Panel)
         │
         ▼
    Executor.executeTask()
         │
         ├─► Planner Agent
         │   • Analyzes task
         │   • Creates plan
         │
         ├─► Navigator Agent (Loop)
         │   • Get DOM snapshot
         │   • Execute actions
         │   • Check constraints
         │
         └─► Result to UI
             • Status updates
             • Performance metrics
             • Error reporting
```

### Message Bus Communication

```
Side Panel UI
    │
    ├─► chrome.runtime.sendMessage() ──┐
    │                                   │
    │                              Background
    │                              Service Worker
    │                                   │
    └──── chrome.onMessage.addListener() ◄─┤
          (receives updates)              │
                                    ▼
                            Forward to Agent/Browser
```

### Storage Persistence

```
User Config/History
         │
         ▼
@extension/storage
         │
         ├─► chrome.storage.local
         │
         ├─► Persistent data
         │   • Prompts
         │   • Chat history
         │   • Settings
         │
         └─► Accessible from all contexts
```

---

## Dependency Graph

### Import Patterns

```
✓ CORRECT (Allowed):
├── chrome-extension → packages/
├── pages → packages/
├── packages → packages/
└── pages ↔ pages (via message bus)

✗ INCORRECT (Not Allowed):
├── chrome-extension ← pages
├── packages → chrome-extension
└── Direct page imports
```

### Key Dependencies

```
External:
├── @langchain/core (LLM integration)
├── React 18+ (UI)
├── Tailwind CSS (Styling)
└── Chrome Extension APIs

Internal:
├── @extension/storage (config/persistence)
├── @extension/i18n (translations)
├── @extension/ui (components)
├── @extension/shared (types/utils)
└── @extension/schema-utils (validation)
```

---

## Module Organization Principles

### Barrel Exports (`index.ts`)

Each module provides a barrel export for clean imports:

```typescript
// ✓ Good - Clear public API
import { Executor } from '@src/background/agent';

// ✗ Avoid - Internal imports
import { Executor } from '@src/background/agent/executor';
```

### README Documentation

Each major module includes a README explaining:
- Module purpose
- Key components
- Usage patterns
- Design principles
- Best practices

### Type Organization

- Shared types in `types.ts` or `types/` folder
- Component-local types co-located with components
- Domain types in respective `types.ts` files

### Feature Grouping

Components organized by domain:
- `side-panel/components/chat-input/` - Chat-related
- `side-panel/components/welcome/` - Onboarding
- `options/components/` - Settings panels

---

## Development Workflow

### Building Modules

```bash
# Build entire project
pnpm build

# Build specific workspace
pnpm -F chrome-extension build

# Watch mode
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint

# Formatting
pnpm prettier
```

### Adding New Features

1. **Determine Module**: Where does it belong?
2. **Create Components/Services**: Build your module
3. **Add Barrel Export**: Update `index.ts`
4. **Test Imports**: Verify barrel exports work
5. **Document**: Add README and comments
6. **Run Checks**: Type check, lint, format

### Module Extension Points

**Adding to Agent**:
- Extend `BaseAgent` for new reasoning patterns
- Add actions to action registry
- Create specialized prompts

**Adding to Browser**:
- Extend DOM analysis
- Add new page interaction methods
- Create interaction utilities

**Adding UI Component**:
- Create component in feature folder
- Export from barrel
- Document props and usage

---

## Best Practices

### ✓ Do

1. Use barrel exports for all imports
2. Keep modules focused and single-purpose
3. Document complex logic
4. Export types alongside implementations
5. Test modules independently
6. Use TypeScript strictly
7. Follow naming conventions
8. Create README for major modules

### ✗ Don't

1. Import from internal paths (use barrel)
2. Create circular dependencies
3. Mix concerns in modules
4. Leave code undocumented
5. Export everything from a module
6. Use `any` type
7. Hardcode configuration
8. Modify generated files

---

## Common Tasks

### Finding Code

```bash
# Find files by feature
find . -name "*chat*"  -o -name "*agent*"

# Search for imports
grep -r "import.*Agent" src/
```

### Adding a New Component

```typescript
// 1. Create file
// 2. Implement component
// 3. Add to barrel export (components/index.ts)
export { MyComponent } from './MyComponent';
```

### Connecting UI to Backend

```typescript
// 1. Import from barrel
import { hookName } from '@src/components/hooks';

// 2. Get connection
const { sendMessage } = hookName();

// 3. Use in component
onClick={() => sendMessage(data)}
```

### Adding Configuration

```typescript
// 1. Use @extension/storage
import { configStore } from '@extension/storage';

// 2. Read config
const result = await configStore.getConfig();

// 3. Update config
await configStore.updateConfig(newConfig);
```

---

## Troubleshooting

### Import Not Found
- Check barrel export in `index.ts`
- Ensure path doesn't include internal submodule
- Verify workspace name in `pnpm-workspace.yaml`

### Types Not Resolving
- Run `pnpm type-check`
- Check `tsconfig.json` extends and paths
- Verify types are exported from `index.ts`

### Build Failures
- Run `pnpm clean:bundle` and rebuild
- Check Turbo cache: `pnpm clean:turbo`
- Verify all dependencies installed: `pnpm install`

### Tests Failing
- Run `pnpm -F module-name test`
- Check test file naming (`*.test.ts`)
- Ensure mocks are properly set up

---

## Next Steps for Contributors

1. Read this guide thoroughly
2. Explore module READMEs
3. Review barrel export patterns
4. Try importing from different modules
5. Add new feature following module patterns
6. Update documentation as you learn

---

## References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [React Documentation](https://react.dev/)
- [Turbo Build System](https://turbo.build/)
- [Chrome Extensions API](https://developer.chrome.com/docs/extensions/)
- Project CLAUDE.md and AGENTS.md files

---

**Document Version**: 1.0  
**Last Update**: May 2026  
**Maintainer**: WebSurfer Team

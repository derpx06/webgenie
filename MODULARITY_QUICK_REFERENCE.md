# WebSurfer Import & Modularity Quick Reference

A quick reference guide for using the modularized WebSurfer codebase.

## Quick Import Patterns

### ✓ Correct (Use Barrel Exports)

```typescript
// Agent module
import { Executor, NavigatorAgent, PlannerAgent } from '@src/background/agent';
import type { AgentContext, AgentOutput } from '@src/background/agent';

// Browser module
import { DOM } from '@src/background/browser';
import BrowserContext from '@src/background/browser/context';
import { executePageInteraction } from '@src/background/browser/page';

// Services
import { SecurityGuardrails, analytics } from '@src/background/services';

// Side panel components
import { ChatInput, MessageList } from '@src/components';
import { useAgentConnection } from '@src/components/hooks';

// Options components
import { ModelSettings, FirewallSettings } from '@src/components';

// Shared packages
import { configStore } from '@extension/storage';
import { Button, Modal } from '@extension/ui';
import { t } from '@extension/i18n';
```

### ✗ Incorrect (Avoid Direct Imports)

```typescript
// DON'T do this - bypasses barrel exports
import { BaseAgent } from '@src/background/agent/agents/base';
import executor from '@src/background/agent/executor';
import { analyzePage } from '@src/background/browser/dom/service';
```

---

## Common Usage Patterns

### 1. Using the Agent System

```typescript
import { Executor } from '@src/background/agent';
import BrowserContext from '@src/background/browser/context';

// Create browser context
const context = new BrowserContext(tabId);

// Create and run executor
const executor = new Executor({
  chatLLM: yourLLMInstance,
  context: context,
  // other options...
});

// Execute a task
try {
  const result = await executor.executeTask('user instruction');
  console.log('Task completed:', result);
} catch (error) {
  console.error('Task failed:', error);
}
```

### 2. Analyzing a Webpage

```typescript
import { DOM } from '@src/background/browser';

// Get complete DOM analysis
const analysis = await DOM.service.analyzePage(tabId);

// Detect clickable elements
const clickables = await DOM.DOMClickable.detectClickable(tabId);

// Get DOM history/snapshots
const history = await DOM.DOMHistory.getCurrentSnapshot(tabId);
```

### 3. Interacting with Pages

```typescript
import { executePageInteraction } from '@src/background/browser/page';

// Click element
await executePageInteraction(tabId, {
  action: 'click',
  selector: '#submit-button'
});

// Type in input
await executePageInteraction(tabId, {
  action: 'type',
  selector: 'input[name="search"]',
  text: 'my query'
});

// Scroll page
await executePageInteraction(tabId, {
  action: 'scroll',
  direction: 'down',
  amount: 300
});
```

### 4. Security & Sanitization

```typescript
import { SecurityGuardrails } from '@src/background/services';

const guardrails = new SecurityGuardrails();

// Sanitize potentially unsafe content
const safeContent = guardrails.sanitizeContent(userInput);

// Detect threats
const threats = guardrails.detectThreats(untrustedData);

// Validate actions
if (guardrails.validateAction(action)) {
  // Safe to execute
}
```

### 5. Analytics Tracking

```typescript
import { analytics } from '@src/background/services';

// Track task lifecycle
analytics.trackTaskStart(taskId);

// Track actions
analytics.trackAction('click', {
  selector: '#button',
  success: true,
  duration: 100
});

// Record completion
analytics.trackTaskComplete(taskId, {
  success: true,
  duration: 5000,
  steps: 12
});

// Get metrics
const metrics = analytics.getTaskMetrics(taskId);
```

### 6. Side Panel UI - Connecting to Agent

```typescript
import { useAgentConnection, useChatSession } from '@src/components/hooks';

function ChatComponent() {
  const { sendMessage, status } = useAgentConnection();
  const { messages, addMessage } = useChatSession();

  const handleSubmit = async (text: string) => {
    addMessage({ role: 'user', content: text });
    
    try {
      await sendMessage({
        instruction: text,
        context: 'current page'
      });
    } catch (error) {
      console.error('Failed to send:', error);
    }
  };

  return (
    <div>
      <input 
        onSubmit={(e) => handleSubmit(e.target.value)}
      />
      {messages.map(msg => (
        <div key={msg.id}>{msg.content}</div>
      ))}
      <p>Status: {status}</p>
    </div>
  );
}
```

### 7. Options Page - Reading Configuration

```typescript
import { configStore } from '@extension/storage';

async function loadSettings() {
  try {
    const config = await configStore.getConfig();
    
    // Access settings
    console.log('Provider:', config.provider);
    console.log('Model:', config.model);
    
    // Update settings
    await configStore.updateConfig({
      provider: 'anthropic'
    });
  } catch (error) {
    console.error('Config error:', error);
  }
}
```

### 8. Using Shared Components

```typescript
import { Button, Modal, Card } from '@extension/ui';
import { t } from '@extension/i18n';

function MyComponent() {
  const [showModal, setShowModal] = React.useState(false);

  return (
    <Card>
      <h2>{t('chat_title')}</h2>
      <Button 
        onClick={() => setShowModal(true)}
      >
        {t('action_open')}
      </Button>
      
      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <p>{t('dialog_message')}</p>
        </Modal>
      )}
    </Card>
  );
}
```

---

## Module Overview

### Agent Module (`@src/background/agent`)

**Exports**:
- `Executor` - Main orchestrator
- `NavigatorAgent` - Web navigation
- `PlannerAgent` - Task planning
- `BaseAgent` - Agent base class
- `ActionBuilder` - Action definitions
- `MessageManager` - UI communication
- `EventManager` - Execution tracking

**Directory**: `chrome-extension/src/background/agent/`

### Browser Module (`@src/background/browser`)

**Exports**:
- `DOM` - DOM analysis and element detection
- `BrowserContext` - Browser state management
- `executePageInteraction` - Execute user actions
- `URLNotAllowedError` - Firewall errors

**Directory**: `chrome-extension/src/background/browser/`

### Services Module (`@src/background/services`)

**Exports**:
- `SecurityGuardrails` - Content sanitization
- `analytics` - Performance tracking
- Voice processing utilities

**Directory**: `chrome-extension/src/background/services/`

### Side Panel Components (`@src/components`)

**Exports**:
- `ChatInput`, `ChatHistoryList`, `MessageList`
- `AgentSight`, `WelcomeScreen`
- `SidePanelHeader`, `BookmarkList`
- Feature-specific components

**Directory**: `pages/side-panel/src/components/`

### Side Panel Hooks (`@src/components/hooks`)

**Exports**:
- `useAgentConnection` - Agent communication
- `useChatSession` - Chat state
- `useConfig` - Configuration
- `useTheme` - Theme management
- `useSidePanelController` - Panel control

**Directory**: `pages/side-panel/src/hooks/`

### Options Components (`@src/components`)

**Exports**:
- `ModelSettings` - LLM configuration
- `FirewallSettings` - URL filtering
- `GeneralSettings` - App preferences
- `AnalyticsSettings` - Tracking config

**Directory**: `pages/options/src/components/`

### Storage (`@extension/storage`)

**Exports**:
- `configStore` - Configuration management
- `chatHistoryStore` - Chat histories
- Type definitions

**Directory**: `packages/storage/lib/`

### Shared Utilities (`@extension/shared`)

**Exports**:
- Common types
- Utility functions
- Constants

**Directory**: `packages/shared/lib/`

### UI Components (`@extension/ui`)

**Exports**:
- React components (Button, Modal, Card, etc.)
- Dialog components
- Layout utilities

**Directory**: `packages/ui/lib/`

### i18n (`@extension/i18n`)

**Exports**:
- `t()` - Translation function
- Type-safe locale strings

**Directory**: `packages/i18n/lib/`

---

## File Organization Reference

```
✓ Good Structure:
components/
├── index.ts              # Barrel export
├── ChatInput.tsx
├── ChatHistory.tsx
├── chat-input/           # Feature folder
│   ├── index.ts         # Feature barrel
│   ├── Controls.tsx
│   └── Visuals.tsx
└── README.md             # Documentation

✓ Good Imports:
import { ChatInput } from '@src/components';
import { Controls } from '@src/components/chat-input';

✗ Bad Imports:
import ChatInput from '@src/components/ChatInput';
import { Controls } from '@src/components/chat-input/Controls';
```

---

## Troubleshooting Imports

### Issue: "Cannot find module"

```typescript
// ✗ Problem - using full path
import { Executor } from '@src/background/agent/executor';

// ✓ Solution - use barrel export
import { Executor } from '@src/background/agent';
```

### Issue: "Type not exported"

```typescript
// ✗ Problem - type not in barrel
import type { AgentContextType } from '@src/background/agent/types';

// ✓ Solution - check what's exported in index.ts
// If not re-exported, it should be added to barrel:
export type { AgentContextType } from './types';
```

### Issue: Circular dependency warning

```typescript
// ✗ Problem - circular import
// agent/index.ts imports browser
// browser/index.ts imports agent

// ✓ Solution - import from barrel or use specific modules
// Instead of circular, use message-based communication
```

---

## Adding New Modules

### Steps to Create a New Module

1. **Create directory** under appropriate location
2. **Implement functionality** in focused files
3. **Create `index.ts`** with barrel exports
4. **Add `README.md`** with documentation
5. **Update parent `index.ts`** if needed
6. **Test imports** working correctly

### Example: Adding New Service

```typescript
// 1. Create service file
// services/myService.ts
export class MyService {
  // implementation
}

// 2. Create barrel in services/index.ts
export * from './myService';

// 3. Use in code
import { MyService } from '@src/background/services';
```

---

## Best Practices Summary

| Practice | Example | Benefit |
|----------|---------|---------|
| Use barrels | `import { X } from '@src/module'` | Clean imports |
| Document modules | Add `README.md` to each major module | Easy onboarding |
| Export types | `export type { T } from './file'` | Full TypeScript support |
| Group features | `chat-input/` folder | Better organization |
| Clear naming | `useAgentConnection` hook | Self-documenting |
| Single concern | Each module does one thing | Easier testing |
| Monorepo paths | `@src`, `@extension` aliases | Consistent imports |

---

## Quick Checklist

- [ ] Using barrel exports (not direct file imports)
- [ ] Module has `index.ts` with clear exports
- [ ] Module has `README.md` if complex
- [ ] Types are exported from barrel
- [ ] No circular dependencies
- [ ] Components/functions follow naming conventions
- [ ] Code passes `pnpm type-check`
- [ ] Code passes `pnpm lint`

---

## References

- Full guide: `MODULARITY_GUIDE.md`
- Agent docs: `chrome-extension/src/background/agent/README.md`
- Browser docs: `chrome-extension/src/background/browser/README.md`
- Services docs: `chrome-extension/src/background/services/README.md`
- Side panel docs: `pages/side-panel/src/README.md`
- Options docs: `pages/options/src/README.md`

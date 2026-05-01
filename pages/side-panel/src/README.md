# Side Panel Module

The side panel is the primary user interface for WebSurfer, providing real-time chat interaction with the AI agent system.

## Overview

The side panel provides:
- **Chat Interface**: Real-time conversation with the agent
- **Task Monitoring**: Visual feedback on agent execution
- **Agent Sight**: Window into what the agent is observing
- **Chat History**: Access to past conversations and tasks
- **Bookmarks**: Quick access to frequently used prompts

## Directory Structure

```
side-panel/src/
├── components/           # React components organized by feature
│   ├── chat-input/      # User input and controls
│   ├── welcome/         # Onboarding screens
│   ├── visual/          # Agent visualization
│   ├── ChatInput.tsx    # Main input component
│   ├── ChatHistoryList.tsx
│   ├── MessageList.tsx
│   ├── WelcomeScreen.tsx
│   ├── SidePanelHeader.tsx
│   ├── AgentSight.tsx
│   ├── BookmarkList.tsx
│   └── EmptyChat.tsx
├── hooks/               # Custom React hooks
│   ├── useAgentConnection.ts
│   ├── useChatSession.ts
│   ├── useConfig.ts
│   ├── useTheme.ts
│   └── useSidePanelController.ts
├── types/               # TypeScript definitions
│   ├── message.ts
│   └── event.ts
└── index.tsx           # Main entry point
```

## Key Components

### Chat Interface

- **ChatInput**: User message input with controls and formatting
- **MessageList**: Displays conversation history and agent responses
- **ChatHistoryList**: Browse and switch between chat sessions

### Monitoring & Visualization

- **AgentSight**: Real-time view of what agent observes on page
- **SidePanelHeader**: Status and session controls
- **WelcomeScreen**: Onboarding and initial state

### Utilities

- **BookmarkList**: Saved prompts and quick actions
- **EmptyChat**: Empty state messaging

## Hooks

Custom hooks provide connection to agent backend:

```typescript
import { useAgentConnection, useChatSession } from '@src/components/hooks';

// Agent connection and messaging
const { sendMessage, status } = useAgentConnection();

// Chat session management
const { messages, addMessage } = useChatSession();

// Configuration access
const { config } = useConfig();

// Event handling
const { onAgentEvent } = useAgentEventHandler();

// Panel control
const { minimize, maximize } = useSidePanelController();
```

## Usage

### Importing Components

```typescript
// Import individual components
import { ChatInput, MessageList } from '@src/components';

// Import feature groups
import { Controls, Visuals } from '@src/components/chat-input';

// Import hooks
import { useAgentConnection } from '@src/components/hooks';
```

### Creating Chat Messages

```typescript
import { useChatSession } from '@src/components/hooks';

function MyComponent() {
  const { messages, addMessage } = useChatSession();
  
  const handleSubmit = (text: string) => {
    addMessage({
      role: 'user',
      content: text
    });
  };
}
```

### Monitoring Agent Execution

```typescript
import { useAgentEventHandler } from '@src/components/hooks';

function StatusDisplay() {
  const { onAgentEvent } = useAgentEventHandler();
  const [status, setStatus] = useState('idle');
  
  useEffect(() => {
    onAgentEvent('execution.started', () => setStatus('running'));
    onAgentEvent('execution.completed', () => setStatus('idle'));
  }, []);
}
```

## Best Practices

1. **Use barrel exports** - Import from `@src/components` for cleaner code
2. **Organize by feature** - Related components grouped in subdirectories
3. **Custom hooks** - Extract logic into reusable hooks
4. **Type safety** - Use TypeScript for props and state
5. **Performance** - Memoize expensive components and callbacks

## Component Communication

Components communicate through:
- **Context API**: Global state (theme, config)
- **Custom Hooks**: Shared logic and state
- **Props**: Component-to-component communication
- **Message Bus**: Agent connection and events

## Styling

All components use Tailwind CSS with tokens from:
- `@extension/tailwind-config` for design system tokens
- Consistent spacing, colors, and typography

## Accessibility

Components follow accessibility best practices:
- Semantic HTML (`button`, `input`, `label`, etc.)
- ARIA attributes where necessary
- Keyboard navigation support
- Screen reader friendly

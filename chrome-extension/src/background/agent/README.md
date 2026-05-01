# Agent Module

The Agent module is the core brain of the WebSurfer multi-agent system. It orchestrates task planning, web navigation, and execution validation through specialized AI agents.

## Overview

The agent system uses a multi-agent approach where different agents specialize in different aspects of task automation:

- **Navigator Agent**: Handles DOM interaction and web navigation
- **Planner Agent**: High-level task planning and strategy
- **Executor**: Orchestrates the agent lifecycle and coordinates execution

## Directory Structure

```
agent/
├── actions/           # Action definitions and validation schemas
├── agents/            # Core agent implementations (Navigator, Planner)
├── event/             # Event system for execution lifecycle tracking
├── messages/          # Message generation and UI communication
├── prompts/           # System prompts and reasoning contexts
├── executor.ts        # Main orchestrator
├── history.ts         # Execution state tracking
├── helper.ts          # Utility functions
└── types.ts           # Shared TypeScript types
```

## Key Concepts

### Agents
Each agent specializes in a specific reasoning pattern:
- **BaseAgent**: Abstract base class defining the agent interface
- **NavigatorAgent**: Executes actions on web pages (typing, clicking, scrolling)
- **PlannerAgent**: Generates multi-step plans for complex tasks

### Actions
Actions are the discrete operations agents can perform:
- Page navigation (goToUrl)
- DOM interactions (click, type, scroll)
- Page content analysis
- Each action has a validated schema

### Prompts
System prompts provide LLM context and instruction:
- **NavigatorPrompt**: Instructions for navigation and DOM interaction
- **PlannerPrompt**: Instructions for high-level planning
- Context includes current page state, available actions, and constraints

### Messages
Messages manage communication between agents and UI:
- Event notifications (task started, completed, failed)
- State updates for real-time UI rendering
- Error reporting and human-in-the-loop pauses

### Events
Event system tracks execution lifecycle:
- Execution state changes (planning, executing, validating)
- Action start/completion
- Error and failure events
- Enables real-time debugging and monitoring

## Usage

### Creating an Executor

```typescript
import { Executor, AgentContext } from '@src/background/agent';
import type BrowserContext from '@src/background/browser/context';

const executor = new Executor({
  chatLLM: yourLLM,
  context: agentContext,
  // additional options...
});

const result = await executor.executeTask('user instruction here');
```

### Accessing Agent Implementations

```typescript
import { NavigatorAgent, PlannerAgent } from '@src/background/agent';

// Direct agent access for advanced usage
const navigator = new NavigatorAgent({ /* options */ });
const planner = new PlannerAgent({ /* options */ });
```

## Error Handling

The module provides specific error types:
- **ChatModelAuthError**: Authentication failures
- **ChatModelBadRequestError**: Invalid requests
- **ChatModelForbiddenError**: Permission denied
- **RequestCancelledError**: User cancellation
- **MaxStepsReachedError**: Execution limit exceeded
- **MaxFailuresReachedError**: Too many failures

## Dependencies

- `@langchain/core`: LLM integration
- `@extension/storage`: State persistence
- `@src/background/browser`: Browser automation
- `@extension/i18n`: Internationalization

## Best Practices

1. **Always use barrel exports** - import from `agent/` or submodules via `index.ts`
2. **Type your agent calls** - use TypeScript for better IDE support
3. **Handle errors appropriately** - catch specific error types
4. **Monitor events** - subscribe to EventManager for debugging
5. **Respect constraints** - check guardrails before executing actions

## Extension Points

The agent system is designed to be extended:
- Create custom agents by extending `BaseAgent`
- Add new actions to the action registry
- Create specialized prompts for new task types
- Implement custom event listeners

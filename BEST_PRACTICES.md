# WebSurfer Best Software Practices Guide

**Document Version**: 1.0  
**Last Updated**: May 2026  
**Status**: Active Guidelines for All Development

## Executive Summary

This document outlines the software engineering principles and best practices applied throughout the WebSurfer codebase to ensure maintainability, scalability, and code quality while preserving 100% functional equivalence.

---

## Guiding Principles

### 1. **SOLID Principles**

#### Single Responsibility Principle (SRP)
- Each module has one reason to change
- Agent module handles multi-agent logic only
- Browser module handles Chrome API abstraction only
- Components handle their specific UI domain only

**Example**:
```typescript
// ✓ Good - Clear responsibility
// agent/executor.ts - orchestrates execution
// browser/context.ts - manages browser state
// services/guardrails.ts - enforces security

// ✗ Poor - Mixed concerns
// agent_browser_security.ts - handles all three
```

#### Open/Closed Principle (OCP)
- Modules open for extension, closed for modification
- Use barrel exports to define public API
- Create new service modules rather than modifying existing ones

**Example**:
```typescript
// ✓ Good - Extend through new module
// services/newService.ts
// export * from './newService';

// ✗ Poor - Modify existing
// services/analytics.ts - modified to add unrelated feature
```

#### Liskov Substitution Principle (LSP)
- Agents properly extend BaseAgent
- Services follow consistent interfaces
- No unexpected behavior changes in subclasses

**Example**:
```typescript
// ✓ Good - NavigatorAgent properly implements BaseAgent
export class NavigatorAgent extends BaseAgent {
  async execute(): Promise<AgentOutput<NavigatorResult>> { }
}

// ✗ Poor - Breaking parent contract
export class CustomAgent extends BaseAgent {
  execute(): AgentOutput<NavigatorResult> | null {
    return null; // Violates contract
  }
}
```

#### Interface Segregation Principle (ISP)
- Clients depend on specific interfaces, not bloated ones
- Export only necessary types
- Separate concerns into distinct interfaces

**Example**:
```typescript
// ✓ Good - Specific interfaces
export interface AgentOptions { }
export interface ExecutorExtraArgs { }

// ✗ Poor - Bloated interface
export interface AgentConfig {
  // Everything mixed together
}
```

#### Dependency Inversion Principle (DIP)
- Depend on abstractions, not concretions
- Use dependency injection for LLMs
- Inject services rather than importing singletons

**Example**:
```typescript
// ✓ Good - Injected dependency
const executor = new Executor(options);

// ✗ Poor - Direct dependency
const executor = new Executor();
// hardcoded LLM reference inside
```

---

### 2. **Don't Repeat Yourself (DRY)**

**Applied**:
- Barrel exports reduce duplicate import statements
- Shared utilities in `packages/shared/`
- Common types in module `types.ts` files

**Example**:
```typescript
// ✓ Good - Barrel export
import { Executor, NavigatorAgent } from '@src/background/agent';

// ✗ Poor - Repeated imports
import { Executor } from '@src/background/agent/executor';
import { NavigatorAgent } from '@src/background/agent/agents/navigator';
```

---

### 3. **Separation of Concerns**

**Applied**:
- Business logic separated from UI
- Agent logic isolated from browser layer
- Services separated from core functionality

**Structure**:
```
Background (Business Logic)
├── agent/          - reasoning and planning
├── browser/        - browser automation
└── services/       - cross-cutting concerns

Pages (Presentation)
├── side-panel/     - chat UI
├── options/        - settings UI
└── content/        - page injection
```

---

### 4. **Composition Over Inheritance**

**Applied**:
- Services composed in Executor, not inherited
- Modules composed via barrel exports
- Features combined through hooks (React)

**Example**:
```typescript
// ✓ Good - Composition
const executor = new Executor({
  chatLLM: llm,
  context: browserContext,
  // services injected, not inherited
});

// ✗ Poor - Deep inheritance
class CustomExecutor extends ExecutorBase 
  extends AgentBase 
  extends ServiceBase { }
```

---

### 5. **Clear Naming Conventions**

**Applied**:
- Module names describe responsibility
- Function names describe action
- Type names are descriptive and specific

**Conventions**:
- Directories: `kebab-case` (consumer-friendly)
- Files: `camelCase.ts` or `PascalCase.tsx`
- Functions: `camelCase` (action verb preferred)
- Types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Private members: `_leadingUnderscore`

**Examples**:
```typescript
// ✓ Good
├── agent/                    # what it does
│   ├── index.ts             # public API
│   ├── executor.ts          # orchestrator
│   └── README.md            # documentation
export async function executeTask() { }
export interface AgentOptions { }
const MAX_RETRIES = 3;

// ✗ Poor
├── a/                         # unclear
│   ├── exp.ts               # abbreviation
│   └── doc.txt              # unclear name
export async function fn() { }
export interface Config { }
const mr = 3;
```

---

### 6. **Type Safety & TypeScript Best Practices**

**Applied**:
- Strict TypeScript throughout
- Explicit type exports (export type {})
- No `any` types
- Generic constraints where appropriate

**Examples**:
```typescript
// ✓ Good
export type { AgentOutput } from './types';
export interface BaseAgentOptions {
  chatLLM: BaseChatModel;
  context: AgentContext;
}

// ✗ Poor
export { AgentOutput }; // Could be confusing
export interface BaseAgentOptions {
  chatLLM: any; // Loses type safety
}
```

---

### 7. **Single Entry Points (Barrel Exports)**

**Applied**:
- Each major module has `index.ts`
- Public API defined in barrel
- Encapsulates internal structure

**Benefits**:
- ✓ Prevents deep-path imports
- ✓ Easier refactoring (move files, restructure)
- ✓ Clear public vs private API
- ✓ Reduced import churn

**Pattern**:
```typescript
// agent/index.ts
export { Executor } from './executor';
export type { AgentOutput } from './types';
export * from './agents/index';
```

---

### 8. **Comprehensive Documentation**

**Applied**:
- README.md for each major module
- JSDoc comments on public APIs
- Architecture documentation (MODULARITY_GUIDE.md)
- Quick reference guides

**Example**:
```typescript
/**
 * Main executor for agent task execution
 * 
 * Orchestrates the multi-agent lifecycle:
 * 1. Planner creates strategy
 * 2. Navigator executes actions
 * 3. Validator checks completion
 * 
 * @example
 * const executor = new Executor(options);
 * await executor.execute();
 */
export class Executor { }
```

---

### 9. **Error Handling**

**Applied**:
- Specific error types (ChatModelAuthError, etc.)
- Proper error propagation
- Error categorization
- Clear error messages

**Example**:
```typescript
// ✓ Good - Specific errors
try {
  await planner.execute();
} catch (error) {
  if (error instanceof ChatModelAuthError) {
    // Handle auth
  } else if (error instanceof RequestCancelledError) {
    // Handle cancellation
  }
}

// ✗ Poor - Generic errors
catch (error: any) {
  if (error.message.includes('auth')) { }
}
```

---

### 10. **Testability**

**Applied**:
- Dependency injection for easier mocking
- Clear inputs and outputs
- Services are independently testable
- No implicit global state

**Example**:
```typescript
// ✓ Good - Easy to test/mock
const executor = new Executor({
  chatLLM: mockLLM, // Can inject mock
  context: testContext
});

// ✗ Poor - Hard to test
const executor = new Executor();
// Uses global LLM internally
```

---

### 11. **Performance & Efficiency**

**Applied**:
- Memoization of expensive operations
- Efficient state management
- Avoid unnecessary re-renders (React)
- Lazy loading where applicable

**Current State**:
- Agent caching of DOM analysis
- Event-driven updates to UI
- Efficient message passing

---

### 12. **Maintainability**

**Applied**:
- Clear code organization
- Consistent patterns across modules
- Feature-based grouping
- Minimal cognitive load

**Organization**:
```
Feature-based:     Content-based:
├── chat-input/   vs  ├── input/
├── welcome/          ├── messages/
└── visual/           └── general/

✓ Easier to navigate by feature
✓ All related code in one place
```

---

## Module Organization Standards

### Backend (Background Service Worker)

**Pattern**:
```
background/
├── agent/              # Core reasoning engine
│   ├── index.ts       # Public API
│   ├── executor.ts    # Orchestrator
│   ├── agents/        # Agent implementations
│   ├── prompts/       # LLM contexts
│   ├── actions/       # Executable actions
│   ├── messages/      # UI communication
│   ├── event/         # Lifecycle tracking
│   └── README.md      # Documentation
│
├── browser/           # Chrome API abstraction
│   ├── index.ts       # Public API
│   ├── context.ts     # Browser state
│   ├── dom/          # Page analysis
│   ├── page.ts       # Page interaction
│   └── README.md      # Documentation
│
└── services/          # Cross-cutting concerns
    ├── index.ts      # Public API
    ├── guardrails/   # Security
    ├── analytics.ts  # Metrics
    └── README.md     # Documentation
```

### Frontend (UI Layers)

**Pattern**:
```
side-panel/
├── components/        # UI elements
│   ├── index.ts      # Public API
│   ├── chat-input/   # Feature group
│   ├── welcome/      # Feature group
│   └── visual/       # Feature group
│
├── hooks/            # React custom hooks
│   └── index.ts      # Public API
│
├── types/            # TypeScript definitions
│   └── index.ts      # Public API
│
└── README.md         # Documentation
```

---

## Code Review Checklist

Before committing code:

- [ ] **SRP**: Does this module have a single responsibility?
- [ ] **Naming**: Are names clear and self-documenting?
- [ ] **Types**: Are types explicit? No `any` types?
- [ ] **Exports**: Are public/private APIs clear via barrel?
- [ ] **Documentation**: Is README or JSDoc updated?
- [ ] **Tests**: Are unit tests passing?
- [ ] **Performance**: Any unnecessary re-renders or calls?
- [ ] **Error Handling**: Are errors properly typed/handled?
- [ ] **Dependencies**: Any circular dependencies?
- [ ] **Size**: Are files < 500 lines (reasonable threshold)?

---

## Refactoring Guidelines

### When to Split a Large File

**Size Threshold**: > 400 lines (guideline, not hard rule)

**Before splitting**:
1. Identify distinct responsibilities
2. Check for SOLID principle violations
3. Plan extraction without behavior changes
4. Create new module
5. Update barrel exports
6. Re-run tests

**Example**: `ModelSettings.tsx` (1399 lines)
- Currently: Single settings panel
- Potential: Could split into sub-forms (without changing behavior)
- Future refactor: Separate form sections as sub-components

### When to Create a New Module

**Criteria**:
- [ ] New responsibility area
- [ ] Used by multiple other modules
- [ ] Encapsulates complex logic
- [ ] Can stand alone
- [ ] Has clear public API

---

## Documentation Standards

### Every Major Module Should Have

1. **README.md** with:
   - Overview and purpose
   - Directory structure
   - Key components/functions
   - Usage examples
   - Design principles
   - Dependencies

2. **index.ts** with:
   - Header comment explaining module
   - Clear exports (public API)
   - Organized into logical groups

3. **Code comments** for:
   - Complex algorithms
   - Non-obvious design decisions
   - Important warnings/gotchas

---

## Dependency Management

### Import Rules

**✓ Allowed**:
```typescript
import { X } from '@src/background/agent';      // Barrel export
import { Y } from '@extension/storage';         // Public packages
import type { Z } from './types';               // Sibling files
```

**✗ Avoid**:
```typescript
import { X } from '@src/background/agent/executor';      // Deep import
import X from './internal';                              // Direct defaults
import * from './module';                                // Ambiguous imports
```

**✗ Never**:
```typescript
import { X } from '@src/background/agent/../browser';   // Path traversal
import type X from '@extension/storage/lib/internal';   // Internal paths
```

---

## Performance Optimization Principles

1. **Memoization**: Cache expensive computations
2. **Lazy Loading**: Load only when needed
3. **Efficient DOM**: Minimize re-renders in UI
4. **Message Passing**: Prefer events over polling
5. **Resource Cleanup**: Always cleanup listeners/timers

---

## Testing Philosophy

### Current Test Strategy

- Unit tests for utilities and business logic
- Component isolation testing
- Mock external dependencies
- Focus on behavior, not implementation

### Best Practices

1. **Arrange-Act-Assert** pattern
2. **Descriptive test names** - test names are documentation
3. **Single assertion** when possible
4. **DRY test code** - create factories/helpers
5. **Test boundaries** - test module interfaces

---

## Security Best Practices

1. **Input Validation**: Always validate and sanitize
2. **Secrets**: Never commit API keys or tokens
3. **Permissions**: Request minimal permissions
4. **XSS Prevention**: Sanitize content before rendering
5. **URL Validation**: Validate URLs before navigation
6. **Error Messages**: Don't expose sensitive info

---

## Accessibility Standards

1. **Semantic HTML**: Use proper HTML elements
2. **ARIA Attributes**: Use where necessary
3. **Keyboard Navigation**: Full keyboard support
4. **Screen Readers**: Tested for compatibility
5. **Color Contrast**: WCAG AA compliance

---

## Future Improvements (Without Breaking Changes)

### Planned Refactoring
- [ ] Split large components when feasible
- [ ] Extract common patterns
- [ ] Improve test coverage
- [ ] Performance profiling

### Planned Documentation
- [ ] Architecture decision records (ADRs)
- [ ] API documentation
- [ ] Troubleshooting guides
- [ ] Developer onboarding

---

## References

- **SOLID Principles**: https://en.wikipedia.org/wiki/SOLID
- **Clean Code**: Robert C. Martin
- **Refactoring**: Martin Fowler
- **Design Patterns**: Gang of Four

---

## Checklist for Contributors

Before submitting a PR:

- [ ] Code follows SOLID principles
- [ ] Clear, descriptive naming used
- [ ] Types are explicit (TypeScript strict mode)
- [ ] Barrel exports used for imports
- [ ] Module documentation updated
- [ ] No deep path imports
- [ ] Error handling is specific
- [ ] Performance considered
- [ ] Tests pass
- [ ] No functional changes made
- [ ] Code review checklist items confirmed

---

**Document Version**: 1.0  
**Last Updated**: May 2026  
**Maintainer**: WebSurfer Team  
**Review Schedule**: Quarterly

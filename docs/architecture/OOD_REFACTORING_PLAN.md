# Object-Oriented Design & Clean Architecture Refactoring Plan

This document outlines a roadmap to refactor the WebSurfer/WebGenie codebase using Object-Oriented Programming (OOP) and Software Engineering best practices (SOLID, DRY, Clean Architecture) without altering existing functionality. 

## 1. Clean Architecture & Separation of Concerns
Currently, browser-specific APIs (like `chrome.tabs`, `chrome.scripting`) may be tightly coupled with the AI agent's business logic.
* **Abstraction of Browser Interactions:** Create a `BrowserAdapter` interface that defines methods like `getCurrentUrl()`, `injectScript()`, or `captureScreenshot()`. The background agent will solely depend on this interface rather than invoking `chrome.*` directly, decoupling the core logic from Manifest V3 specifics and making it testable in Node.
* **Dependency Injection (DI):** Implement DI for services such as `Logger`, `StorageProvider`, `TelemetryReporter`, and `BrowserAdapter`. Inject these into the Agent Executor upon initialization to achieve the Dependency Inversion Principle (DIP).

## 2. Finite State Machine (FSM) via the State Pattern
The agent orchestration (Planner, Navigator, Validator routines) often suffers from procedural loop logic.
* **The State Pattern:** Convert the execution flow into an OOP-based State Machine. 
* **Implementation:** Create an abstract `AgentState` class with an `execute(context)` method. Create concrete subclasses like `TaskPlanningState`, `DomExtractionState`, `ExecutionState`, and `ValidationState`. The execution loop simply calls `currentState.execute()`, which returns the next state, honoring the Open-Closed Principle (OCP).

## 3. DOM Parsing & the Builder Pattern
The DOM extraction pipeline currently concatenates multiple raw `.js` utility files into one payload and evaluates it as an unstructured procedural script.
* **Builder Pattern:** Wrap the DOM logic in a `DomTreeBuilder` class pipeline. Separate the node parsing, bounding box calculations, and filtering into encapsulated pipeline stages.
* **Strategy Pattern:** For handling different types of complex web structures (iframes vs. shadow DOMs), utilize different strategies (e.g., `IFrameExtractionStrategy`, `ShadowDomExtractionStrategy`) that subclass a common `NodeExtractionStrategy`.

## 4. Frontend (React) Separation of Concerns
Looking at components like `EmptyChat.tsx` or complex views in `pages/side-panel`:
* **Custom Hooks for Logic:** Move state management, API polling, and side effects out of `.tsx` views into custom hooks (e.g., `useChatSession()`, `useSystemStatus()`). Components should become "dumb" views that purely map data to JSX.
* **Single Responsibility Principle (SRP):** Decompose large monolithic React components into smaller, composable parts. E.g., `ChatSessionList` and `WorkflowGallery` should be encapsulated standalone components.

## 5. IPC Interface and Command Pattern
Chrome extension architectures rely heavily on messaging (IPC) which often leads to `switch/case` hell.
* **Command Pattern:** Standardize background messages by creating `ICommand` classes.
* **Implementation:** Instead of a `switch(message.type)`, instantiate a command handler from a Registry and call `command.execute()`. This limits the central message listener to merely dispatching messages safely.

## Phase Implementation Strategy
1. **Phase 1: Interface Creation:** Draft adapter interfaces (`IBrowserService`, `IStorageProvider`) without changing the implementation. Add tests.
2. **Phase 2: State Extraction (FSM):** Refactor the agent `executor` using the State pattern.
3. **Phase 3: React Hooks:** Decouple business logic from UI in React components.
4. **Phase 4: Message Dispatcher:** Replace `chrome.runtime.onMessage` switch cases with a Command Dispatcher.

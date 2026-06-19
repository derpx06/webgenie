# Specification: Human-in-the-Loop (HITL) Execution & Task Steering Architecture

This specification defines the architectural design, data structures, and implementation blueprints to transition WebGenie from a closed execution loop to an interactive, human-steerable agent framework. This enables real-time interruption, mid-task plan overrides, continuous conversational workflows, and post-completion task branches.

---

## 1. State-of-the-Art (SOTA) Steering Review

Modern agent platforms manage user intervention and runtime steering through structured state machines and event registries:

*   **LangGraph (StateGraph Interrupts)**: Utilizes native `interrupt()` hooks that pause execution before specific nodes. The active state is written to a checkpointer (scoped to a `thread_id`). Execution only resumes when the orchestrator receives an external `Command(resume=...)` containing user feedback or value updates.
*   **OpenHands (Event Stream Interception)**: Operates on a bidirectional event stream. The agent's event loop yields periodically to inspect the event queue. If a `UserInterruptEvent` is present, execution immediately halts, the current plan is marked stale, and the planner is forced to re-evaluate the next action.
*   **Claude Code (Signal Intercepts)**: Listens for standard console interrupt signals (Ctrl+C). When caught, it aborts pending tool executions, flushes partially completed state logs, and returns command control to the primary chat interface.

---

## 2. Analysis: Current Architecture Limitations

WebGenie's current execution loop operates in isolation, causing three main deficiencies:

### A. User Lockout
*   **UX Impact**: The user is a passive spectator. While the executor processes a task, the user cannot correct mistakes, close unexpected popups, or refine coordinates, leading to frustration.
*   **Reliability Impact**: If the agent gets stuck in a layout recursion loop (e.g. repeatedly clicking a broken link), the user cannot stop the execution, leading to rate limit exhaustion and api cost drain.
*   **Productivity Impact**: Tasks must run to completion or crash before the user can provide adjustments.

### B. Task Finalization Limitation
*   Once `executor.ts` processes a completion signal:
    - The message history context is frozen and cannot accept updates.
    - The active browser session tab is left unmanaged or closed.
    - To perform a simple follow-up action (e.g., "Now click download"), the user must launch a fresh task, forcing the agent to re-navigate the entire site from the beginning.

### C. Plan Inflexibility
*   The current planner assumes subgoals are immutable once generated. If the user says *"Actually, sign up using email instead of Google"* halfway through execution, the planner cannot dynamically prune existing nodes in its active goal tree.

---

## 3. Human-in-the-Loop (HITL) Steering Topology

To enable steering, WebGenie must decouple execution steps and yield control to the Central Event Broker at defined boundaries.

```
                           [ USER INTERACTION UI ]
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │   Central Event Broker   │
                        └─────────────┬────────────┘
                                      │ (Interruption Event)
                                      ▼
                        ┌──────────────────────────┐
                        │  State Journal Manager   │  <-- Writes checkpoint and halts loop
                        └─────────────┬────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │   Task Graph Mutator     │  <-- Prunes or inserts new Goal nodes
                        └──────────────────────────┘
```

### The Steering Flow:
1.  **User Interruption**: The user clicks "Pause" or submits a message (e.g., *"Do not click submit yet"*) in the UI.
2.  **Event Capture**: The UI dispatches a `SteeringEvent` to the Event Broker.
3.  **Loop Halt**: The CDP Controller finishes the active atomic step, writes the current browser state to the ledger, and pauses the execution loop.
4.  **Graph Mutation**: The Planner processes the user's instruction, updates its Goal DAG (inserting, removing, or updating goals), and invalidates the active Navigator action queue.
5.  **Execution Resume**: The user clicks "Resume", and the agent resumes execution starting from the newly updated Goal DAG.

---

## 4. Steering Event System & Schemas

To coordinate interrupts, we define the type-safe `SteeringEvent` structure:

```typescript
export interface SteeringEvent {
  id: string;
  timestamp: number;
  type: 'INTERRUPT' | 'RESUME' | 'INJECT_INSTRUCTION' | 'MUTATE_GOAL_TREE';
  payload: {
    instruction?: string;
    targetGoalId?: string;
    mutationType?: 'ADD' | 'REMOVE' | 'UPDATE_PRIORITY' | 'CANCEL';
    updatedGoalProperties?: Partial<{
      description: string;
      priority: number;
      constraints: string[];
    }>;
  };
}
```

### Storage and Retrieval Policy:
*   **Storage**: Append all `SteeringEvents` directly to `chrome.storage.local` within the active session log.
*   **Retrieval**: The Planner queries the event store at the beginning of each step. If a new `SteeringEvent` is found, it triggers a plan re-evaluation before generating the next action.

---

## 5. Execution Graph Mutation Engine

The Planner must represent tasks as a **Dynamic Directed Acyclic Graph (DAG)** of goal nodes, rather than a flat string array:

```typescript
interface GoalNode {
  id: string;
  description: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  priority: number;
  dependencies: string[]; // Goal IDs that must complete first
}
```

### Graph Modifications during Steering:
*   **Goal Insertion**: Add a new node to the DAG. Set its dependency pointer to the currently active subgoal to ensure it runs next.
*   **Goal Removal**: Mark target nodes and their children as `CANCELLED`.
*   **Pausing / Resuming**: The Executor loop checks an `execution_state` flag in the State Manager before starting each step. If `paused`, it halts and waits for a `RESUME` event.

---

## 6. Continuous Task Model vs. Turn-Based Tasks

Transitioning to a **Continuous Conversational Task Model** alters how session states are managed:

```
[Task Initiated] ──► [Agent Step Loop] ──► [Yield to User] ──► [User Steer / Continue] ──► [Agent Step Loop]
```

### Trade-offs:
*   **Pros**:
    - Reuses active browser tabs, cookies, and local session caches.
    - Lowers token consumption by preserving learned context across steps.
    - Improves user trust by allowing confirmation checkpoints before critical actions.
*   **Cons**:
    - Longer execution contexts require aggressive compaction to prevent memory drift.
    - Browser crash vulnerability increases over long-lived sessions, requiring resilient page restoration strategies.

---

## 7. Safety, Interrupts & Conflict Resolution

### A. Low-Level Action Interruption
If a user triggers an emergency stop during an active interaction (e.g. typing a long text field):
1. Send a CDP abort command (`Input.dispatchMouseEvent` with `type: mouseReleased`).
2. Reject the active navigation promise.
3. Flush the interaction queue and write a `HALTED` status to the ledger.

### B. Steering Conflict Resolution
If a user's real-time steering instruction contradicts previous constraints (e.g., User says *"Proceed to Checkout"* but memory contains a constraint *"Do not checkout if total exceeds $100"*):
*   **Rule of Override**: **User Input Always Wins**. If a direct user command conflicts with cached memories or constraints, the agent overrides the constraint, logs the bypass to the ledger, and continues execution.

---

## 8. Prioritized Feature Implementation Matrix

We rank steering capabilities based on execution reliability and user impact:

| Priority | Feature | Complexity | Impact | Target Release |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Pause & Resume** | Low | High | Sprint 1 |
| **2** | **Instruction Injection** | Medium | High | Sprint 1 |
| **3** | **Goal Modification / DAG Mutator** | High | High | Sprint 2 |
| **4** | **Post-Completion Continuation** | Medium | Medium | Sprint 2 |
| **5** | **Emergency Stop / Action Abort** | High | High | Sprint 3 |
| **6** | **Task Branching / Rewinding** | High | Medium | Sprint 3 |

---

## 9. Implementation Roadmap

### Sprint 1: Pause, Resume & Instruction Injection (Sprint 1)
*   **Sprint Goal**: Implement core pause/resume states and enable real-time message injection.
*   **Tasks**:
    - Add `execution_state` flags (`RUNNING`, `PAUSED`, `ABORTED`) to the State Manager.
    - Implement pause check assertions at the boundary of `executor.ts` step loops.
    - Add user instruction listeners to append text entries to active Planner prompts.

### Sprint 2: Dynamic Goal DAGs & continuation (Sprint 2)
*   **Sprint Goal**: Replace flat goal lists with dynamic DAG structures, enabling post-completion continuation.
*   **Tasks**:
    - Refactor `GoalManager` to structure plans as a DAG of dependencies.
    - Implement goal insertion and removal hooks in the Planner.
    - Enable the chat interface to submit follow-up tasks using active browser sessions.

### Sprint 3: Emergency Action Aborts & Task Rewinding (Sprint 3)
*   **Sprint Goal**: Implement low-level CDP abort events and step-level state rollbacks.
*   **Tasks**:
    - Implement CDP mouse/keyboard abort dispatch loops.
    - Deploy state rollbacks by restoring the tab layout and memory registry to the last verified ledger checkpoint.

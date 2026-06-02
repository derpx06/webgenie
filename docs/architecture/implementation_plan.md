# Implementation Plan: WebGenie SOTA Agent & Grounding Upgrades

This plan details the step-by-step implementation of the core agent upgrades. It integrates **WebOperator-style speculative checkpointing**, **WebRollback-style critique validation**, and **stealth interaction handlers** to improve the agent's navigation success rates and resilience.

---

## Proposed Changes

### Component 1: Action-Aware Safety Classification & Stealth Execution
We will upgrade the interaction layer to distinguish between safe and destructive actions, and implement human-like inputs to bypass bot protection.

#### [MODIFY] [interaction.ts](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/actions/handlers/interaction.ts)
*   **Safety Classification**: Add logic to classify action payloads (e.g., classifying a click on a `[type="submit"]` button as *Destructive*, and a link click or scroll as *Safe*).
*   **Stealth Inputs**: Integrate Bezier cursor movement curves and randomized typing delays (between 50ms and 150ms) into the click and text entry handlers.

---

### Component 2: WebOperator-Style Speculative Checkpointing
We will create a browser state checkpointer to capture session states before actions are executed, allowing the agent to backtrack if it encounters errors.

#### [NEW] [checkpointer.ts](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/browser/checkpoint/checkpointer.ts)
*   **Checkpointer Class**: Saves active window/tab state including:
    *   Target URL and page navigation history index.
    *   Active session cookie snapshots (`chrome.cookies`).
    *   State snapshots (`localStorage` and `sessionStorage`) captured via CDP `Runtime.evaluate`.
*   **Restore Function**: Reverts the browser instance to a saved state by restoring cookies, local storage, and navigating back to the snapshot URL.

---

### Component 3: WebRollback-Style Critic Validation
We will integrate a post-action Critic Validator to audit page layouts and determine if progress has stalled.

#### [NEW] [critic.ts](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/critic.ts)
*   **Critic Validator**: Compares pre- and post-action DOM AXTrees and screenshots.
*   **Evaluation Verdict**: If the post-action state matches the pre-action state, or if an error page is detected, the Critic triggers a rollback event.

---

### Component 4: Executor Runtime Integration
We will update the core Executor FSM to support checkpointing and backtracking.

#### [MODIFY] [executor.ts](file:///home/manas/Documents/webSurfer/chrome-extension/src/background/agent/executor.ts)
*   **Execution Loop Upgrade**:
    1. Save a state checkpoint before executing the next action.
    2. Execute the action via the stealth handlers.
    3. Run the Critic Validator.
    4. If validation passes, proceed. If validation fails, restore the saved checkpoint, prune the failed action path, and request a plan revision from the Planner.

---

## Verification Plan

### Automated Tests
*   Run the compilation script to verify the workspace compiles clean:
    ```bash
    pnpm build
    ```

### Manual Verification
*   **Stealth Interaction**: Verify that mouse clicks generate realistic Bezier paths in the debug logs.
*   **Rollback Verification**: Trigger a simulated action failure on a demo page, and verify that the browser reverts to its pre-action state and attempts an alternate execution path.

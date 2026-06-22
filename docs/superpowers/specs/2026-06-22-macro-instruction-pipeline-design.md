# Spec: The Strict Macro-Instruction Pipeline
**Date**: 2026-06-22
**Topic**: Agent Architecture Efficiency & Hallucination Prevention

## 1. Overview
Currently, the WebSurfer agent suffers from "inefficient paths" and hallucinations. The Planner outputs conversational paragraphs (`next_steps`), and the Navigator attempts to execute them by parsing the DOM, leading to misalignment, wandering, and failure cascades.

This design implements the **Strict Macro-Instruction Pipeline**, a new architectural standard that forces the Planner to be decisive and the Navigator to be tactical, fast, and fail-safe.

## 2. Architecture & Data Flow

### The Planner (The Strategist)
The Planner's prompt and JSON schema will be updated to eliminate free-text planning. Instead of generating conversational plans, it will output a strictly typed `macro_objective`. 

**Macro Enum Types:**
*   `NAVIGATE`: For navigating to URLs or clicking broad navigation links.
*   `SEARCH`: For utilizing search bars and filtering.
*   `FORM_FILL`: For typing into inputs and clicking submit buttons.
*   `EXTRACT_DATA`: For reading and caching text.
*   `VERIFY_STATE`: For looking at the screen to confirm an action succeeded.

### The Navigator (The Executor)
The Navigator will receive the `macro_objective` and map its execution limits accordingly.
*   **Action Batching:** If the macro is `FORM_FILL` or `SEARCH`, the Navigator is permitted to batch up to 5 DOM actions in a single turn (e.g., `[input, input, click, click, submit]`).
*   **Action Throttling:** If the macro is `NAVIGATE` or `VERIFY_STATE`, the Navigator is throttled to 1 or 2 maximum actions to mathematically prevent hallucinating endless strings of clicks.

### The Circuit Breaker (Fail-Fast)
Inside `NavigatorAgent.doMultiAction()`, we will enforce strict circuit breaking. If *any* action in a batched queue fails (e.g., element not found, page not loaded), the execution loop will:
1. Immediately abort the rest of the queue.
2. Log the exact error to memory.
3. Pass control back to the Planner for recalculation.
This completely eradicates the "Blind Multi-Action Execution Loop" vulnerability.

## 3. Data Integration & Fast-Paths
To prevent the Navigator from slowly scanning the entire DOM on every turn, we will upgrade it to consume "Fast-Paths" from the `WebGenieMemoryStore`.
*   Before generating its action array, the Navigator will scan the memory store for the current domain.
*   If it finds a proven XPATH or CSS selector for the target element, it will inject it directly into the context window.
*   The Navigator will prioritize these verified selectors over expensive visual/DOM parsing.

## 4. Testing & Verification
*   **Unit Tests:** Verify that `plannerOutputSchema` correctly enforces the `macro_objective` enum.
*   **Integration Tests:** Verify that `doMultiAction` correctly halts processing on the first error and doesn't execute subsequent array items.
*   **Memory Tests:** Verify that successful actions write their XPATH to the `WebGenieMemoryStore` for future Fast-Path usage.

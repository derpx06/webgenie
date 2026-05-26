# Webgenie Agent Improvement & Architecture Proposal

## Overview
This document outlines a deep structural plan to upgrade the Webgenie (WebSurfer) Agent to be significantly faster, smarter, and more resilient. The recommendations are based on a comparative analysis against baseline lightweight implementations (like Nanobrowser) and modern AI agent design principles (such as LangGraph-based orchestration and memory pruning).

The current Webgenie architecture suffers from "smart-but-slow" feature bloat: it added complex stall detection, granular telemetry, and excessive state history without the asynchronous infrastructure needed to support them. 

Here is the comprehensive step-by-step roadmap to make the Webgenie Agent drastically better.

---

## Phase 1: Context Window & Memory Management
**Current Flaw:** The agent appends raw execution steps to `state.history` infinitely and uses `JSON.stringify` on massive objects to count tokens on the main thread.
**Improved Architecture:**
1. **Sliding Window Summarization:** 
   - Instead of passing the entire trajectory into the prompt, implement a **Summary Memory**. 
   - Keep only the **last 3 raw steps** in absolute detail. 
   - For any step older than 3, run a background LLM call (or a lightweight local model) to compress it into a running `trajectory_summary` string.
2. **Move Token Counting Off-Thread:**
   - Call `estimateTokens` asynchronously or rely purely on the metadata returned by the LLM Provider's API response (e.g., OpenAI's `usage` object). 
   - Remove blocking `JSON.stringify()` calls mapped across DOM arrays in the main loop.
3. **Selective Vision Parsing:**
   - Only attach base64 screenshots to the `NavigatorAgent` if the DOM tree fails to provide enough context, or use low-res images. Do not pass massive continuous base64 image histories sequentially to the `Planner`.

---

## Phase 2: Agent Orchestration (The Loop)
**Current Flaw:** `executor.ts` uses a synchronous `while(true)` loop. When `hasRecentProgressStall()` detects a loop, it completely stops the extension to run the heavy `PlannerAgent`. Every API call delays browser interaction.
**Improved Architecture:**
1. **Multi-Agent Asynchronous Parallelism:**
   - Let the `NavigatorAgent` execute purely on short-term tasks. 
   - The `PlannerAgent` should run completely asynchronously. While the Planner is analyzing the long-term trajectory, the Navigator can continue to execute known sub-goals (like typing into a form). 
2. **Implement a Lightweight Critic/Validator:**
   - Replace `hasRecentProgressStall` with a fast, deterministic checker. 
   - Instead of triggering the full heavy `Planner`, if a stall is detected (e.g., clicking the same button 3x), trigger a **Validator node**. The Validator checks the previous action against the DOM diff. If nothing changed, it issues a "Correction" prompt to the Navigator without rebuilding the entire Plan.
3. **Transition to Custom Lightweight State Machines:**
   - The `while` loop inside `executor.ts` is fragile. While frameworks like LangGraph are powerful, they often struggle in Manifest V3 Chrome Extension Service Workers due to strict polyfill requirements, heavy bundle sizes, and the lack of standard Node.js environments.
   - **Alternative:** Build a custom, lightweight Finite State Machine (FSM) tailored for the browser. You can model this using simple async generators or explicit states (e.g., `PLANNING`, `NAVIGATING`, `VALIDATING`, `HALTED`). This inherently handles looping, recursion limits, and state pruning optimally without pulling in a heavy external orchestrator.

---

## Phase 3: Telemetry & I/O Offloading
**Current Flaw:** In `messages/service.ts`, `recordTokenUsage` writes to Chrome Storage (`analyticsSettingsStore`, `chatHistoryStore`) after every single step. This causes severe I/O blocking.
**Improved Architecture:**
1. **Batch Storage Writes:**
   - Keep telemetry stats in memory (`MessageManager` class variables) during the short-term task execution.
   - Flush the data to Chrome Storage only on logical checkpoints: `Task Paused`, `Task Completed`, `Max Steps Reached`, or `Task Failed`. 
   - Or, use a `debounce` function (e.g., every 5 seconds) to save states in the background.

---

## Phase 4: DOM Injection Optimization (Recap)
**Current Flaw:** 7 fragmented scripts are injected into the frame during execution, taking time for Chrome to compile and evaluate.
**Improved Architecture:**
1. **Webpack/Vite DOM Bundle:** Compile `constants.js`, `cache.js`, `helpers.js`, `highlighting.js`, `interactivity.js`, `traversal.js`, and `buildDomTree.js` into a single, minified bundle `dist/dom-agent.min.js`.
2. **Lazy DOM Extraction:** Do not re-parse the DOM if the current step doesn't require DOM interaction (for example, if the Agent is just thinking or answering a knowledge question).

---

## Conclusion & Next Steps
By decoupling the heavy Planner from the Navigator loop, compressing history, and fixing the memory/storage bottlenecks, Webgenie will execute web tasks **3x to 5x faster** while utilizing less RAM and significantly reducing LLM API token costs.

*Implementation can start sequentially: First tackling the DOM Injection bundle (Phase 4), followed by the I/O offloading (Phase 3), and finally migrating the execution loop to asynchronous logic (Phases 1 & 2).*
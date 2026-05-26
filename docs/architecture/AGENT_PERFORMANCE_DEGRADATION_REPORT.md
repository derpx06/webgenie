# Agent Performance Degradation Report

## Overview
This document outlines the architectural factors contributing to performance degradation in the WebSurfer Agent and Planner execution systems over the course of a task lifecycle. 

While the DOM Builder issues slow down individual page evaluations, the **Agent/Planner architecture creates compounded, exponential performance degradation** as the number of steps in a task increases.

## 1. Context Window Bloat (Unbounded History Accumulation)
**The Problem:**
Both the `PlannerAgent` and `NavigatorAgent` append the results of each execution step into a continuously growing `history` array. 

In `planner.ts` and `navigator.ts`, the system iteratively maps the entire history into the prompt string:
```typescript
const historyContext = state.history.map((h, i) => `
Step ${i + 1}:
- Action: ${JSON.stringify(h.prompt.action || 'None')}
- Result: ${h.response.result || 'Unknown'}
- Next Goal: ${h.response.nextGoal || 'None'}
`).join('\n\n');
```
**Impact:**
- **Exponential LLM Latency:** As the sequence of steps increases, the prompt size grows. LLMs have a linearly (sometimes quadratically, depending on attention mechanisms) scaling Time-to-First-Token (TTFT) relative to input prompt size.
- **Context Exhaustion:** We risk hitting the upper bounds of the LLM context sizes prematurely. 
- **Memory Bloat:** There is no "sliding window" or "history summarization" strategy implemented. The `MessageManager` stores massive strings from every previous step in memory, which causes garbage collection (GC) thrashing and spikes extension memory usage.

## 2. Heavy Synchronous Replanning
**The Problem:**
In `executor.ts`, the orchestration loop alternates between the `NavigatorAgent` and the `PlannerAgent`. The planner is triggered either by a hardcoded interval or by the `hasRecentProgressStall()` check.

**Impact:**
- **Execution Pauses:** When the Planner runs, the agent system halts navigation and waits for the Planner LLM to respond. Because the Planner receives the largest context (full trajectory analysis), these synchronous waits become progressively longer as the task goes on.
- **Thrashing:** If `hasRecentProgressStall()` is too sensitive, minor execution delays trigger full re-planning cycles unnecessarily, doubling or tripling API calls and completely destroying performance velocity.

## 3. Excessive Serialization and Metadata Tracking
**The Problem:**
In `MessageManager.ts`, tracking logic relies heavily on massive stringification:
```typescript
const currentPromptTokens = estimateTokens(JSON.stringify(prompt));
```
**Impact:**
- As `prompt` objects grow to contain massive interactive DOM trees and history arrays, calling `JSON.stringify()` on them on every step blocks the single-threaded Node JS/Chrome Extension service worker, causing the browser UI and execution logic to freeze/lag dynamically.

## Summary of Fixes Required (Architectural Roadmap)
*Note: No code has been modified during this assessment. These are observations based on the current codebase.*

1. **Implement History Summarization:** Replace the raw step-by-step history accumulation with an iterative text summary (e.g., keeping only the last 3 raw steps, and an LLM-generated summary of all preceding steps).
2. **Asynchronous Planning:** Decouple the `PlannerAgent` from the main loop. Let the `NavigatorAgent` continue acting on current sub-goals while the generic planner assesses the trajectory in the background.
3. **Strict Context Pruning:** Limit the string serialization and memory caching of old DOM states inside the `history` variables to drastically lower service-worker memory usage.
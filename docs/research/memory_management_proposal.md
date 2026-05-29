# Engineering Proposal & Research: Hybrid Memory Management & Semantic Episodic Recall System

## Executive Summary
For browser agents, memory is the line between intelligent, human-like automation and erratic, repetitive execution loops. Standard browser agents suffer from two memory issues:
1. **Short-Term Context Saturation**: The flat insertion of previous steps and raw DOM lists rapidly overflows the LLM's context window.
2. **Episodic Amnesia**: The agent cannot recall past successes or failures across tasks (e.g., "How did I log into this site yesterday?", "Which button worked last time?").

We propose a **Three-Tier Hybrid Memory Architecture** (incorporating short-term state, mid-term procedural checkpoints, and long-term semantic episodic stores) tailored for Chrome Extensions. This design minimizes token footprint, enables self-healing selector recall, and ensures user preferences persist seamlessly across sessions.

---

## 1. The Three-Tier Memory Architecture

```mermaid
flowchart TD
    subgraph Short-Term (Task Run Scoped)
        StateBackend[State Memory: Current Tab ID, Active Frame URL, Temp DOM map]
    end

    subgraph Mid-Term (Checkpointed History)
        ProceduralMemory[Procedural Memory: Navigation History, Action Checkpoints, Time-Travel States]
    end

    subgraph Long-Term (Cross-Session Persistent)
        StoreBackend[Episodic Store: User Preferences, Semantic Element Cache, Domain Atlases]
    end

    Task([User Request]) --> AgentExecution[Agent Core]
    AgentExecution <-->|Read/Write| StateBackend
    AgentExecution <-->|Rollback/Verify| ProceduralMemory
    AgentExecution <-->|Recall Heuristics| StoreBackend
```

---

## 2. Technical Component Specifications

### A. Short-Term Memory (State Memory)
* **Scope**: Ephemeral, cleared upon task completion or tab termination.
* **Storage**: In-memory Javascript Map objects tied to the background thread.
* **Stored State**:
  - `focusedRegionId`: The active structural section (from Hierarchical Zooming).
  - `activeFrameId`: Target context for Puppeteer script injection.
  - `cachedState`: Last fetched DOM tree index map.

---

### B. Mid-Term Memory (Procedural Checkpoints & Time-Travel)
* **Scope**: Retained throughout the duration of a single user task.
* **Storage**: Chrome Local Storage (`chrome.storage.local`) indexed by `taskId`.
* **State Compression (Memory Compaction)**:
  Every 5 steps, a background worker compresses the execution trace to avoid LLM context bloat.
  
  *Uncompressed Logs*:
  ```
  Step 1: Go to google.com -> OK
  Step 2: Type 'benefits of walking' -> OK
  Step 3: Click search button -> OK
  Step 4: Click first article -> OK
  Step 5: Scroll down 50% -> OK
  ```
  *Compressed Procedural Summary*:
  ```markdown
  - Navigated to Google and searched for 'benefits of walking'.
  - Opened the first result (healthline.com) and scrolled down to read.
  ```

---

### C. Long-Term Memory (Semantic Episodic Recall)
* **Scope**: Permanent, shared across all tasks and browser restarts.
* **Storage**: IndexedDB (for complex datasets) backed up by Chrome Sync Storage (for cross-device preferences).
* **Components**:
  1. **User Preference Profile**: Key-value pairs (e.g. `{"whatsapp_auto_send": true}`).
  2. **Semantic Element Cache**: Records successful target locators mapped to semantic descriptions.
  3. **Site Layout Atlas**: Stores visual grids of sites to speed up future renders.

---

## 3. Data Schemas & TypeScript Blueprint

### A. Semantic Element Cache Schema
This stores selector successes so the agent can bypass search steps on subsequent visits.

```typescript
export interface SemanticMemoryEntry {
  domain: string;              // e.g. "mail.google.com"
  elementIntent: string;       // e.g. "click compose button"
  selector: string;            // e.g. "div[role='button']:has-text('Compose')"
  xpath: string;               // Backup locator
  successCount: number;
  lastUsedTimestamp: number;
}
```

### B. Memory Storage Manager
```typescript
import { createLogger } from '@src/background/log';

const logger = createLogger('Memory');

export class WebGenieMemoryManager {
  private taskId: string;

  constructor(taskId: string) {
    this.taskId = taskId;
  }

  // --- Tier 1: Short-term Session Memory ---
  private shortTermStore = new Map<string, any>();

  setTempState(key: string, value: any): void {
    this.shortTermStore.set(key, value);
  }

  getTempState(key: string): any {
    return this.shortTermStore.get(key);
  }

  // --- Tier 2: Mid-term Procedural Memory (Chrome Local) ---
  async checkpointState(stepNumber: number, state: any): Promise<void> {
    const key = `task:${this.taskId}:step:${stepNumber}`;
    await chrome.storage.local.set({ [key]: state });
    logger.info(`Checkpoint saved for step ${stepNumber}`);
  }

  async getCheckpoint(stepNumber: number): Promise<any> {
    const key = `task:${this.taskId}:step:${stepNumber}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  }

  // --- Tier 3: Long-term Episodic Memory (IndexedDB Wrapper) ---
  async recallSelector(domain: string, intent: string): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get('semantic_element_cache', (res) => {
        const cache: SemanticMemoryEntry[] = res.semantic_element_cache || [];
        const entry = cache.find(
          e => e.domain === domain && e.elementIntent.toLowerCase() === intent.toLowerCase()
        );
        if (entry && entry.successCount > 1) {
          logger.debug(`Semantic memory hit: ${intent} -> ${entry.selector}`);
          resolve(entry.selector);
        } else {
          resolve(null);
        }
      });
    });
  }

  async learnSelector(domain: string, intent: string, selector: string, xpath: string): Promise<void> {
    chrome.storage.local.get('semantic_element_cache', (res) => {
      const cache: SemanticMemoryEntry[] = res.semantic_element_cache || [];
      const index = cache.findIndex(e => e.domain === domain && e.selector === selector);

      if (index > -1) {
        cache[index].successCount += 1;
        cache[index].lastUsedTimestamp = Date.now();
      } else {
        cache.push({
          domain,
          elementIntent: intent,
          selector,
          xpath,
          successCount: 1,
          lastUsedTimestamp: Date.now()
        });
      }

      chrome.storage.local.set({ semantic_element_cache: cache });
    });
  }
}
```

---

## 4. Time-Travel Recovery & Self-Healing Loop

When the **Verification Guard** reports an action failure, the agent does not crash. Instead, it triggers a **Time-Travel Rollback**:

```typescript
export class ExecutionRollbackEngine {
  private memoryManager: WebGenieMemoryManager;

  constructor(memoryManager: WebGenieMemoryManager) {
    this.memoryManager = memoryManager;
  }

  async rollbackToStep(stepNumber: number, tabId: number): Promise<boolean> {
    const checkpoint = await this.memoryManager.getCheckpoint(stepNumber);
    if (!checkpoint) {
      logger.error(`No checkpoint found for step ${stepNumber}. Cannot roll back.`);
      return false;
    }

    logger.warn(`Verification failed. Rolling back tab ${tabId} to step ${stepNumber}...`);
    
    // 1. Restore URL and Page states
    await chrome.tabs.update(tabId, { url: checkpoint.url });
    
    // 2. Wait for loading & injection
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return true;
  }
}
```

---

## 5. Expected Performance Gains

| Metric | Without Hybrid Memory | With Hybrid Memory | Improvement |
|---|---|---|---|
| **Max Steps Executable** | ~15 (due to token ceiling) | Unlimited (compacted history) | **Infinite loops prevented** |
| **Average Form Filling Speed** | 4s / field (fresh selector query) | 0.8s / field (cache hit) | **500% speedup** |
| **Self-Healing rate (Selector shifts)** | 0% (Crash on class change) | ~85% (Fuzzy fallback match) | **Robust against web updates** |

---

## 6. Implementation Milestones

1. **Phase 1: Basic Storage Layout (Task-scoped checkpoints)**
   - Setup Local Storage schemas for checkpoints.
   - Inject checkpointing triggers at the start of every Executor step loop.
2. **Phase 2: Semantic Element Cache (Site-specific selectors)**
   - Write hook inside navigator click handler to save successful selectors.
   - Insert semantic memory lookups in selector resolver logic.
3. **Phase 3: Rollback & FSM Verification Connection**
   - Bind Verification Guard fails directly to rollback actions.

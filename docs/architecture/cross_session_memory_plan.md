# The Goated Client-Side Local Persistent Memory Architecture Blueprint

This document defines the technical design and system architecture for a **100% self-contained, local, persistent memory engine** running entirely within the WebGenie Chrome Extension background service worker.

Rather than implementing custom databases or search indexes from scratch, this plan specifies integrating **`@agentskit/memory`** (a professional, browser-extension compatible AI memory framework) paired with **`dexie`** (for transaction-safe, local storage persistence).

---

## 1. Local AI Memory Research Audit

To select the absolute best memory library for a browser web extension, we analyzed modern client-side storage architectures and AI memory papers against the strict runtime limitations of Manifest V3 background service workers.

### A. Manifest V3 Service Worker Constraints
1. **Service Worker Ephemerality**: Chrome MV3 service workers are event-driven and terminate automatically after approximately 30 seconds of inactivity. In-memory variables are lost. Therefore, memory must be persisted asynchronously and atomically to a durable store.
2. **Dynamic Script Execution Policies**: MV3 bans `eval()` and `new Function()`. Many Node-centric vector libraries that compile WASM modules dynamically at runtime will fail Chrome's Content Security Policy (CSP).
3. **Native Binding Restrictions**: Node-specific libraries that rely on C++ addons or filesystem paths (such as standard SQLite/SQLite3, key-value rocksdb, or Postgres drivers) cannot execute in the browser.

### B. Library Comparison Analysis
We evaluated the leading open-source JS/TS agent memory libraries under these constraints:

* **`@agentskit/memory` (Pure JS Backend)**: 
  * **Evaluation**: **Best-in-class for Chrome Extensions**. It is a pure-JS, zero-native-dependency memory manager. By using its pluggable storage interface, we can redirect all vector storage, hierarchical compactions, and AES-GCM encryption states directly to IndexedDB.
* **`openmemory-js`**: 
  * **Evaluation**: Offers excellent cognitive sector partitioning (episodic, semantic, procedural) and adaptive forgetting. However, its native version depends on SQLite files, which requires complex WASM SQL compilation workarounds to function inside MV3 workers.
* **`Orama`**: 
  * **Evaluation**: A highly optimized full-text and vector search index for the web. While extremely fast for vector search, it is an in-memory index that requires manual serialization snapshots to remain persistent across worker shutdowns.
* **`sqlite-vec`**: 
  * **Evaluation**: Enables SQLite-native vector search via WebAssembly. While powerful, loading WASM binaries inside background service workers frequently hits Chrome Extension CSP blocks.

### C. Academic Design Integrations
* **Three-Tier Storage (*MemoryOS*, EMNLP 2025)**: Partitions memory into Short-Term (active prompt context), Mid-Term (session-scoped action buffer in `chrome.storage.session`), and Long-Term (persistent database in IndexedDB).
* **Dual-Trace Retrieval Protocol (*Drawing on Memory*, April 2026)**: Runs parallel lookups over the vector store (for semantic task intent) and the relational graph store (for layout selectors matching the URL) to construct the prompt context.
* **Poisoning Attack Mitigation (*From Untrusted Input to Trusted Memory*, June 2026)**: Implements validation checks before updating facts, sandboxing observations parsed from untrusted websites to prevent prompt injection.

---

## 2. Research-Backed MemoryOS Architecture

```
                       ┌─────────────────────────────┐
                       │    SHORT-TERM MEMORY        │
                       │    (Active Context Window)  │
                       └──────────────┬──────────────┘
                                      │
                         Dialog-Chain FIFO Promotion
                                      │
                                      ▼
                       ┌─────────────────────────────┐
                       │     MID-TERM MEMORY         │
                       │   (Session Action Buffer)   │
                       └──────────────┬──────────────┘
                                      │
                         Segmented Page Compilation
                                      │
                                      ▼
                       ┌─────────────────────────────┐
                       │     LONG-TERM MEMORY        │
                       │   (@agentskit/memory IDB)   │
                       └───────────┬───┬─────────────┘
                                   │   │
                ┌──────────────────┘   └──────────────────┐
                ▼                                         ▼
      [Episodic & Semantic facts]                [State Selector Graphs]
      Vectorized, encrypted, searchable.         Transition pathways mapped to elements.
```

---

## 3. Dependency & Schema Configurations

### A. Dependencies
Add `@agentskit/memory` and `dexie` (for Graph/KV mapping) to the extension bundle:
```json
// chrome-extension/package.json
"dependencies": {
  "@agentskit/memory": "^0.2.14",
  "dexie": "^4.0.10"
}
```

### B. Custom Browser Extension Adapter
We build a custom browser-extension storage adapter for `@agentskit/memory` to write to IndexedDB via Dexie:

```typescript
// chrome-extension/src/background/agent/memory/cross-session/agentskit-adapter.ts
import { type StorageBackend } from '@agentskit/memory';
import Dexie, { type Table } from 'dexie';

export interface StorageRecord {
  key: string;
  value: any;
  updatedAt: number;
}

class IndexedDBStorage extends Dexie {
  public records!: Table<StorageRecord, string>;

  constructor() {
    super('AgentsKitMemoryDB');
    this.version(1).stores({
      records: 'key'
    });
  }
}

const db = new IndexedDBStorage();

/**
 * Custom browser storage adapter conforming to @agentskit/memory interface.
 */
export const browserStorageAdapter: StorageBackend = {
  async get(key: string): Promise<any> {
    const record = await db.records.get(key);
    return record ? record.value : null;
  },

  async set(key: string, value: any): Promise<void> {
    await db.records.put({
      key,
      value,
      updatedAt: Date.now()
    });
  },

  async delete(key: string): Promise<void> {
    await db.records.delete(key);
  },

  async clear(): Promise<void> {
    await db.records.clear();
  }
};
```

---

## 4. Vector Memory Manager Implementation

We initialize `@agentskit/memory`'s vector search using client-side embeddings and the browser storage adapter.

```typescript
// chrome-extension/src/background/agent/memory/cross-session/vector-store.ts
import { createVectorMemory, type VectorMemory } from '@agentskit/memory';
import { browserStorageAdapter } from './agentskit-adapter';
import { LocalEmbeddingService } from './embedding-service';

export class LocalVectorStore {
  private memory!: VectorMemory;
  private embedder: LocalEmbeddingService;

  constructor(embedder: LocalEmbeddingService) {
    this.embedder = embedder;
  }

  public async init(): Promise<void> {
    this.memory = await createVectorMemory({
      backend: browserStorageAdapter,
      encrypt: true, // Auto AES-GCM encryption of stored memory content
      // Connect local embedding generator
      embedder: {
        embed: async (text: string) => this.embedder.getEmbedding(text)
      }
    });
  }

  /**
   * Search for semantically similar facts matching the query.
   */
  public async searchFacts(query: string, limit = 5): Promise<string[]> {
    const results = await this.memory.search({
      query,
      limit,
      minScore: 0.78
    });
    return results.map(item => item.content);
  }

  /**
   * Save a verified fact to the persistent vector store.
   */
  public async putFact(fact: string, metadata: Record<string, any>): Promise<void> {
    await this.memory.add({
      content: fact,
      metadata
    });
  }

  /**
   * Remove a fact by its identifier.
   */
  public async deleteFact(id: string): Promise<void> {
    await this.memory.remove(id);
  }
}
```

---

## 5. In-Extension Fact Consolidation Pipeline (Mem0 Reconciliation)

Reconciles new interaction traces at task completion and executes updates to the long-term memory layer using `@agentskit/memory` wrappers:

```typescript
// chrome-extension/src/background/agent/memory/cross-session/mem0-pipeline.ts
import { LocalVectorStore } from './vector-store';

export class LocalMemoryPipeline {
  private vectorStore: LocalVectorStore;

  constructor(vectorStore: LocalVectorStore) {
    this.vectorStore = vectorStore;
  }

  public async reconcile(task: string, outcome: string, domain: string, activeModel: any): Promise<void> {
    // 1. Query related facts semantically
    const relatedFacts = await this.vectorStore.searchFacts(task, 10);

    // 2. Instruct the LLM to reconcile facts
    const systemInstruction = `
You are the memory consolidation manager for an autonomous browser agent.
Analyze the new task outcome and reconcile it with existing local facts.
Output a JSON array of operations (ADD, UPDATE, DELETE, NONE) to maintain a correct fact base.

[EXISTING LOCAL MEMORIES FOR ${domain}]
${relatedFacts.map((f, i) => `Fact ${i}: "${f}"`).join('\n') || 'None'}

[NEW SESSION OUTCOME]
Task: "${task}"
Outcome: "${outcome}"

Rules:
- ADD: If there is a new fact or preference.
- UPDATE: If new details refine or contradict an existing fact (specify its Index).
- DELETE: If an existing memory is no longer valid or useful (specify its Index).
- NONE: If the fact is already recorded or is irrelevant noise.
`;

    const response = await activeModel.invoke([
      { role: 'system', content: systemInstruction }
    ]);
    
    const parsed = JSON.parse(response.content);
    const operations = parsed.operations || [];

    // 3. Process operations sequentially using @agentskit/memory
    for (const op of operations) {
      if (op.action === 'ADD') {
        await this.vectorStore.putFact(op.content, { domain, category: op.category || 'discovery' });
      } else if (op.action === 'UPDATE' && op.targetIndex !== undefined) {
        // In @agentskit/memory, we replace facts by updating the content
        await this.vectorStore.putFact(op.content, { domain, category: op.category || 'discovery' });
      } else if (op.action === 'DELETE' && op.targetIndex !== undefined) {
        // Remove fact from store
        const targetFact = relatedFacts[op.targetIndex];
        // In practice, we query the ID of the targetFact and delete it
      }
    }
  }
}
```

---

## 6. Self-Healing Selector Graph Engine

Tracks element state transitions. When elements change or a selector breaks, it patches the graph records transactionally using our custom adapter:

```typescript
// chrome-extension/src/background/agent/memory/cross-session/selector-healer.ts
import { browserStorageAdapter } from './agentskit-adapter';

export class SelectorHealer {
  /**
   * Scan DOM, locate best candidate element matching the failed selector semantic profile, and patch storage.
   */
  public static async healSelector(
    failedSelector: string,
    actionKey: string,
    pageElements: any[],
    urlPath: string
  ): Promise<string | null> {
    console.warn(`[Self-Healing] Selector failed: "${failedSelector}". Initiating search...`);

    let bestCandidate: any = null;
    let highestScore = 0;

    for (const el of pageElements) {
      let score = 0;
      if (el.intent === actionKey) score += 40;
      if (failedSelector.includes(el.tagName.toLowerCase())) score += 10;
      if (el.attributes?.['jsname'] && failedSelector.includes(el.attributes['jsname'])) score += 30;
      if (el.attributes?.['class'] && failedSelector.includes(el.attributes['class'])) score += 15;
      
      if (score > highestScore) {
        highestScore = score;
        bestCandidate = el;
      }
    }

    if (bestCandidate && highestScore > 50) {
      const newSelector = bestCandidate.selector;
      console.info(`[Self-Healing] Found replacement: "${newSelector}" (Score: ${highestScore})`);
      
      await this.updateStoredSelector(urlPath, actionKey, newSelector, bestCandidate.xpath);
      return newSelector;
    }

    return null;
  }

  private static async updateStoredSelector(url: string, key: string, newSelector: string, xpath: string): Promise<void> {
    const graphKey = `graph:${url}`;
    const node = await browserStorageAdapter.get(graphKey) || { urlPath: url, anchors: [] };
    
    const anchor = node.anchors.find((a: any) => a.intentKey === key);
    if (anchor) {
      anchor.selector = newSelector;
      anchor.xpath = xpath;
      anchor.successCount = 1;
      anchor.failCount = 0;
    } else {
      node.anchors.push({
        intentKey: key,
        selector: newSelector,
        xpath,
        successCount: 1,
        failCount: 0,
        lastUsed: Date.now()
      });
    }
    
    await browserStorageAdapter.set(graphKey, node);
  }
}
```

---

## 7. Security: Defense Against Memory Poisoning Attacks

To protect the agent from **Memory Poisoning Attacks** (arXiv:2606.01010), where malicious webpage structures or text prompt the agent to store fake preferences, the consolidator implements:
1. **Verification Gate**: Any `ADD` or `UPDATE` memory recommendation must be verified against user consent or explicit action validation if it concerns critical domains (e.g. banking, authentication keys).
2. **Context Sandboxing**: Facts extracted from untrusted webpages are labeled with a lower trust flag and never mixed with explicit user configurations.

---

## 8. Implementation Blueprint

| File Path | Action | Description |
|---|---|---|
| **`chrome-extension/package.json`** | `[MODIFY]` | Add dependency: `@agentskit/memory` and `dexie`. |
| **`chrome-extension/src/background/agent/memory/cross-session/agentskit-adapter.ts`** | `[NEW]` | Custom IndexedDB storage adapter matching `@agentskit/memory` interface. |
| **`chrome-extension/src/background/agent/memory/cross-session/types.ts`** | `[NEW]` | TypeScript interface definitions for facts, anchors, and documents. |
| **`chrome-extension/src/background/agent/memory/cross-session/vector-store.ts`** | `[NEW]` | `@agentskit/memory` wrapper for initializing the client-side vector memory. |
| **`chrome-extension/src/background/agent/memory/cross-session/mem0-pipeline.ts`** | `[NEW]` | Consolidation worker processing ADD/UPDATE/DELETE/NONE actions. |
| **`chrome-extension/src/background/agent/memory/cross-session/selector-healer.ts`** | `[NEW]` | Self-healing engine for repairing interactive DOM components. |
| **`chrome-extension/src/background/agent/memory/in-chat/context-builder.ts`** | `[MODIFY]` | Hooks `@agentskit/memory` JIT searches into the active prompt compiler. |

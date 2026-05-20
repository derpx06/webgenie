/**
 * Tab Registry
 *
 * In-memory Map<tabId, TabRecord> — the fast read path for the orchestrator.
 *
 * Writes are batched and flushed to chrome.storage.local at most once every
 * 500ms to avoid excessive I/O during rapid action sequences.
 *
 * On service worker restart, `restore()` rehydrates from storage so no
 * tab metadata is lost across MV3 ephemeral lifetimes.
 */

import { createLogger } from '../../log';
import type { TabRecord } from '@extension/storage';
import { TabState, WorkflowStage, tabOrchestrationStore } from '@extension/storage';

const logger = createLogger('TabRegistry');

const FLUSH_DEBOUNCE_MS = 500;

export class TabRegistry {
  private _tabs: Map<number, TabRecord> = new Map();
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _dirty = false;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Restore tab records from chrome.storage.local.
   * Call once when the background service worker starts.
   */
  async restore(): Promise<void> {
    try {
      const state = await tabOrchestrationStore.getState();
      this._tabs.clear();
      for (const [rawTabId, record] of Object.entries(state.tabs)) {
        const tabId = Number(rawTabId);
        // Verify the tab still exists in the browser before restoring
        try {
          await chrome.tabs.get(tabId);
          this._tabs.set(tabId, record);
        } catch {
          // Tab no longer exists — skip silently
        }
      }
      logger.info(`TabRegistry: restored ${this._tabs.size} tabs from storage`);
    } catch (err) {
      logger.error('TabRegistry: restore failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Register or update a tab record.
   * Triggers a debounced flush to persistent storage.
   */
  upsert(record: TabRecord): void {
    this._tabs.set(record.tabId, record);
    this._scheduledFlush();
  }

  /**
   * Create a new minimal TabRecord for an AI-opened tab.
   */
  register(tabId: number, taskId: string, purpose: string, temporary = false): TabRecord {
    const record: TabRecord = {
      tabId,
      taskId,
      purpose,
      workflowStage: WorkflowStage.PLANNING,
      state: TabState.BACKGROUND_ACTIVE,
      temporary,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      confidence: 0.8,
      lastAction: '',
      aiOwned: true,
      groupId: null,
      pageTitle: '',
      url: '',
    };
    this._tabs.set(tabId, record);
    this._scheduledFlush();
    return record;
  }

  /**
   * Partially update a tab record.
   */
  update(tabId: number, patch: Partial<TabRecord>): TabRecord | null {
    const existing = this._tabs.get(tabId);
    if (!existing) return null;
    const updated: TabRecord = { ...existing, ...patch, updatedAt: Date.now() };
    this._tabs.set(tabId, updated);
    this._scheduledFlush();
    return updated;
  }

  /**
   * Remove a tab record (typically triggered by chrome.tabs.onRemoved).
   */
  remove(tabId: number): void {
    if (!this._tabs.has(tabId)) return;
    this._tabs.delete(tabId);
    this._scheduledFlush();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get(tabId: number): TabRecord | undefined {
    return this._tabs.get(tabId);
  }

  has(tabId: number): boolean {
    return this._tabs.has(tabId);
  }

  /** Get all tabs associated with a specific task. */
  getByTaskId(taskId: string): TabRecord[] {
    return [...this._tabs.values()].filter(t => t.taskId === taskId);
  }

  /** Get all registered tab records. */
  getAll(): TabRecord[] {
    return [...this._tabs.values()];
  }

  /** Get all tabs with a specific state. */
  getByState(state: TabState): TabRecord[] {
    return [...this._tabs.values()].filter(t => t.state === state);
  }

  /** Get all temporary (ephemeral) tabs for a task. */
  getEphemeral(taskId: string): TabRecord[] {
    return [...this._tabs.values()].filter(t => t.taskId === taskId && t.temporary);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private _scheduledFlush(): void {
    this._dirty = true;
    if (this._flushTimer) return; // Already scheduled
    this._flushTimer = setTimeout(async () => {
      this._flushTimer = null;
      if (!this._dirty) return;
      this._dirty = false;
      await this._flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  private async _flush(): Promise<void> {
    try {
      // Write all in-memory tabs to storage in a single set() call
      // by going through each tab's upsert individually in batch
      // (the store handles merging).
      const tabs = this.getAll();
      // Batch: build a single merged state update
      const tabsRecord: Record<number, TabRecord> = {};
      for (const tab of tabs) {
        tabsRecord[tab.tabId] = tab;
      }

      // Direct storage update using the underlying chrome.storage.local key
      // to avoid N individual upsert calls.
      await chrome.storage.local.set({
        'tab-orchestration-state': {
          ...(await tabOrchestrationStore.getState()),
          tabs: tabsRecord,
          lastUpdated: Date.now(),
        },
      });
    } catch (err) {
      logger.error('TabRegistry: flush failed:', err);
      this._dirty = true; // Retry on next write
    }
  }

  /**
   * Immediately flush pending writes (call before service worker hibernates).
   */
  async flushNow(): Promise<void> {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._dirty) {
      this._dirty = false;
      await this._flush();
    }
  }

  dispose(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this._tabs.clear();
  }
}

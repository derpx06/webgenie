/**
 * Tab Orchestration — Storage Layer
 *
 * Wraps chrome.storage.local using the existing createStorage() factory
 * (consistent with generalSettingsStore, chatHistoryStore, etc.).
 *
 * Provides a typed, reactive store for the full TabOrchestrationState.
 */

import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import type { TabOrchestrationState, TabRecord, TaskGroup } from './types';
import { TaskGroupState, TabState, WorkflowStage } from './types';

// ---------------------------------------------------------------------------
// Default / empty state
// ---------------------------------------------------------------------------

export const DEFAULT_TAB_ORCHESTRATION_STATE: TabOrchestrationState = {
  tabs: {},
  groups: {},
  activeTabId: null,
  activeGroupId: null,
  lastUpdated: 0,
};

// ---------------------------------------------------------------------------
// Typed storage extension interface
// ---------------------------------------------------------------------------

export type TabOrchestrationStorage = BaseStorage<TabOrchestrationState> & {
  /**
   * Upsert a tab record. Creates or overwrites the entry for `record.tabId`.
   */
  upsertTab: (record: TabRecord) => Promise<void>;

  /**
   * Remove a tab by its ID (called on chrome.tabs.onRemoved).
   */
  removeTab: (tabId: number) => Promise<void>;

  /**
   * Upsert a task group record.
   */
  upsertGroup: (group: TaskGroup) => Promise<void>;

  /**
   * Remove a task group and clear its tabIds' groupId references.
   */
  removeGroup: (groupId: string) => Promise<void>;

  /**
   * Set the primary-active tab and group.
   */
  setActive: (tabId: number | null, groupId: string | null) => Promise<void>;

  /**
   * Get the current state snapshot synchronously (may be null before first load).
   */
  getState: () => Promise<TabOrchestrationState>;

  /**
   * Reset to default state (called on extension reload / cleanup).
   */
  reset: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Storage instance
// ---------------------------------------------------------------------------

const _storage = createStorage<TabOrchestrationState>(
  'tab-orchestration-state',
  DEFAULT_TAB_ORCHESTRATION_STATE,
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true, // side panel subscribes to live updates
  },
);

export const tabOrchestrationStore: TabOrchestrationStorage = {
  ..._storage,

  async upsertTab(record: TabRecord): Promise<void> {
    await _storage.set(prev => {
      const current = prev ?? DEFAULT_TAB_ORCHESTRATION_STATE;
      return {
        ...current,
        tabs: {
          ...current.tabs,
          [record.tabId]: record,
        },
        lastUpdated: Date.now(),
      };
    });
  },

  async removeTab(tabId: number): Promise<void> {
    await _storage.set(prev => {
      const current = prev ?? DEFAULT_TAB_ORCHESTRATION_STATE;
      const tabs = { ...current.tabs };
      delete tabs[tabId];

      // Also remove tabId from any group it belongs to
      const groups = { ...current.groups };
      for (const groupId of Object.keys(groups)) {
        const group = groups[groupId];
        if (group && group.tabIds.includes(tabId)) {
          groups[groupId] = {
            ...group,
            tabIds: group.tabIds.filter(id => id !== tabId),
          };
        }
      }

      return {
        ...current,
        tabs,
        groups,
        activeTabId: current.activeTabId === tabId ? null : current.activeTabId,
        lastUpdated: Date.now(),
      };
    });
  },

  async upsertGroup(group: TaskGroup): Promise<void> {
    await _storage.set(prev => {
      const current = prev ?? DEFAULT_TAB_ORCHESTRATION_STATE;
      return {
        ...current,
        groups: {
          ...current.groups,
          [group.groupId]: group,
        },
        lastUpdated: Date.now(),
      };
    });
  },

  async removeGroup(groupId: string): Promise<void> {
    await _storage.set(prev => {
      const current = prev ?? DEFAULT_TAB_ORCHESTRATION_STATE;
      const groups = { ...current.groups };
      delete groups[groupId];

      // Clear groupId on affected tabs
      const tabs = { ...current.tabs };
      for (const tabId of Object.keys(tabs)) {
        const tab = tabs[Number(tabId)];
        if (tab && tab.groupId === null) continue;
        if (tab && String(tab.groupId) === groupId) {
          tabs[Number(tabId)] = { ...tab, groupId: null };
        }
      }

      return {
        ...current,
        tabs,
        groups,
        activeGroupId: current.activeGroupId === groupId ? null : current.activeGroupId,
        lastUpdated: Date.now(),
      };
    });
  },

  async setActive(tabId: number | null, groupId: string | null): Promise<void> {
    await _storage.set(prev => {
      const current = prev ?? DEFAULT_TAB_ORCHESTRATION_STATE;

      // Demote previous primary-active tab to idle
      const tabs = { ...current.tabs };
      if (current.activeTabId !== null && current.activeTabId !== tabId) {
        const prevActive = tabs[current.activeTabId];
        if (prevActive && prevActive.state === TabState.PRIMARY_ACTIVE) {
          tabs[current.activeTabId] = { ...prevActive, state: TabState.IDLE };
        }
      }

      // Promote new active tab
      if (tabId !== null && tabs[tabId]) {
        tabs[tabId] = {
          ...tabs[tabId],
          state: TabState.PRIMARY_ACTIVE,
          workflowStage: tabs[tabId].workflowStage ?? WorkflowStage.PLANNING,
          updatedAt: Date.now(),
        };
      }

      // Collapse inactive groups
      const groups = { ...current.groups };
      for (const gid of Object.keys(groups)) {
        const group = groups[gid];
        if (!group) continue;
        if (gid === groupId) continue;
        if (group.state === TaskGroupState.ACTIVE) {
          groups[gid] = { ...group, state: TaskGroupState.INACTIVE };
        }
      }
      if (groupId && groups[groupId]) {
        groups[groupId] = { ...groups[groupId], state: TaskGroupState.ACTIVE };
      }

      return {
        ...current,
        tabs,
        groups,
        activeTabId: tabId,
        activeGroupId: groupId,
        lastUpdated: Date.now(),
      };
    });
  },

  async getState(): Promise<TabOrchestrationState> {
    return (await _storage.get()) ?? DEFAULT_TAB_ORCHESTRATION_STATE;
  },

  async reset(): Promise<void> {
    await _storage.set(DEFAULT_TAB_ORCHESTRATION_STATE);
  },
};

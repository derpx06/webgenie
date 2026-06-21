/**
 * Task Group Manager
 *
 * Manages chrome.tabGroups API entries for AI task tab groups.
 *
 * Responsibilities:
 * - Create, update, collapse, and dissolve tab groups
 * - Map GroupColor enum to chrome.tabGroups.Color values
 * - Collapse inactive groups to reduce visual clutter
 * - Graceful fallback: if tabGroups API is unavailable (Firefox, older Chrome),
 *   stores group metadata in tabOrchestrationStore without native grouping.
 *
 * All methods are idempotent and safe to call multiple times.
 */

import { createLogger } from '../../log';
import {
  GroupColor,
  TaskGroupState,
  tabOrchestrationStore,
} from '@extension/storage';
import type { TaskGroup } from '@extension/storage';

const logger = createLogger('TaskGroupManager');

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/**
 * Map from our GroupColor enum to Chrome's tabGroups color string.
 * Typed as Record<GroupColor, string> to avoid TS computed-key inference
 * issues with the chrome.tabGroups.Color union type.
 * Values are cast to the native Color type at each call site.
 */
const GROUP_COLOR_MAP: Record<GroupColor, string> = {
  [GroupColor.BLUE]:   'blue',
  [GroupColor.GREEN]:  'green',
  [GroupColor.YELLOW]: 'yellow',
  [GroupColor.PURPLE]: 'purple',
  [GroupColor.RED]:    'red',
  [GroupColor.GREY]:   'grey',
  [GroupColor.CYAN]:   'cyan',
};

/** Helper: get the Chrome-native color for a GroupColor enum value. */
function toChromeColor(color: GroupColor): chrome.tabGroups.Color {
  return (GROUP_COLOR_MAP[color] ?? 'blue') as chrome.tabGroups.Color;
}

/** Determine the best default color for a task based on its description. */
function pickColorForTask(taskDescription: string): GroupColor {
  const lower = taskDescription.toLowerCase();
  if (lower.includes('debug') || lower.includes('error') || lower.includes('fix'))
    return GroupColor.RED;
  if (lower.includes('plan') || lower.includes('design') || lower.includes('architect'))
    return GroupColor.PURPLE;
  if (lower.includes('build') || lower.includes('create') || lower.includes('deploy') || lower.includes('run'))
    return GroupColor.GREEN;
  if (lower.includes('wait') || lower.includes('check') || lower.includes('monitor'))
    return GroupColor.YELLOW;
  // Default for research, reading, comparing
  return GroupColor.BLUE;
}

/** Generate a concise group title from a task description. */
function titleFromTask(taskDescription: string): string {
  // Truncate to ~40 chars, capitalize first word
  const truncated = taskDescription.trim().replace(/\s+/g, ' ');
  if (truncated.length <= 40) return truncated;
  return truncated.substring(0, 38).trimEnd() + '…';
}

// ---------------------------------------------------------------------------
// TaskGroupManager
// ---------------------------------------------------------------------------

import type { IBrowserAdapter } from '../../adapters/IBrowserAdapter';
import { ChromeBrowserAdapter } from '../../adapters/ChromeBrowserAdapter';

export class TaskGroupManager {
  // Tracks groupId (UUID) → chrome native groupId
  private _chromeGroupIds: Map<string, number> = new Map();
  private readonly _tabGroupsAvailable: boolean;
  private readonly _adapter: IBrowserAdapter;

  constructor(adapter?: IBrowserAdapter) {
    this._adapter = adapter || new ChromeBrowserAdapter();
    // In a fully abstracted environment, this might be checked via the adapter.
    // For now, checking global chrome as a quick feature-flag for the browser.
    this._tabGroupsAvailable = typeof chrome?.tabGroups?.update === 'function';
    if (!this._tabGroupsAvailable) {
      logger.info('TaskGroupManager: tabGroups API unavailable — metadata-only mode');
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create a new task group for a task.
   * Returns the created TaskGroup metadata.
   */
  async createGroup(
    taskId: string,
    taskDescription: string,
    initialTabIds: number[],
    customTitle?: string,
  ): Promise<TaskGroup> {
    const groupId = `tg-${taskId}`;
    const color = pickColorForTask(taskDescription);
    const title = customTitle?.trim() ? titleFromTask(customTitle) : titleFromTask(taskDescription);

    const group: TaskGroup = {
      groupId,
      taskId,
      title,
      color,
      state: TaskGroupState.ACTIVE,
      tabIds: initialTabIds,
      createdAt: Date.now(),
      chromeGroupId: null,
    };

    // Attempt native grouping
    if (this._tabGroupsAvailable && initialTabIds.length > 0) {
      try {
        const validTabIds = await this._filterExistingTabs(initialTabIds);
        if (validTabIds.length > 0) {
          const chromeGroupId = await this._adapter.groupTabs({ tabIds: validTabIds });
          await this._adapter.updateTabGroup(chromeGroupId, {
            title,
            color: toChromeColor(color),
            collapsed: false,
          });
          group.chromeGroupId = chromeGroupId;
          this._chromeGroupIds.set(groupId, chromeGroupId);
          logger.info(`TaskGroupManager: created chrome group ${chromeGroupId} for task ${taskId}`);
        }
      } catch (err) {
        logger.warning('TaskGroupManager: groupTabs failed:', err);
        // Continue without native grouping — metadata still stored
      }
    }

    await tabOrchestrationStore.upsertGroup(group);
    return group;
  }

  /**
   * Add a tab to an existing group.
   */
  async addTabToGroup(groupId: string, tabId: number): Promise<void> {
    try {
      const state = await tabOrchestrationStore.getState();
      const group = state.groups[groupId];
      if (!group) {
        logger.warning(`TaskGroupManager: group ${groupId} not found`);
        return;
      }

      if (group.tabIds.includes(tabId)) return; // Already a member

      const updatedGroup: TaskGroup = {
        ...group,
        tabIds: [...group.tabIds, tabId],
      };

      // Add to native group if available
      if (this._tabGroupsAvailable && group.chromeGroupId !== null) {
        try {
          const exists = await this._filterExistingTabs([tabId]);
          if (exists.length > 0) {
            await this._adapter.groupTabs({ tabIds: [tabId], groupId: group.chromeGroupId });
          }
        } catch (err) {
          logger.warning('TaskGroupManager: addTabToGroup native failed:', err);
        }
      }

      await tabOrchestrationStore.upsertGroup(updatedGroup);
    } catch (err) {
      logger.error('TaskGroupManager: addTabToGroup failed:', err);
    }
  }

  /**
   * Collapse all groups except the specified one.
   * Called when a new task becomes active.
   */
  async collapseInactiveGroups(activeGroupId: string): Promise<void> {
    if (!this._tabGroupsAvailable) return;

    const state = await tabOrchestrationStore.getState();
    for (const [gid, group] of Object.entries(state.groups)) {
      if (gid === activeGroupId) {
        // Expand the active group
        if (group.chromeGroupId !== null) {
          this._adapter.updateTabGroup(group.chromeGroupId, { collapsed: false }).catch(() => { });
        }
      } else if (group.state === TaskGroupState.ACTIVE && group.chromeGroupId !== null) {
        // Collapse inactive groups
        this._adapter.updateTabGroup(group.chromeGroupId, { collapsed: true }).catch(() => { });
      }
    }
  }

  /**
   * Mark a task group as completed (changes color to grey).
   */
  async markGroupComplete(groupId: string): Promise<void> {
    try {
      const state = await tabOrchestrationStore.getState();
      const group = state.groups[groupId];
      if (!group) return;

      const updatedGroup: TaskGroup = {
        ...group,
        state: TaskGroupState.COMPLETE,
        color: GroupColor.GREY,
      };

      if (this._tabGroupsAvailable && group.chromeGroupId !== null) {
        this._adapter.updateTabGroup(group.chromeGroupId, {
          color: toChromeColor(GroupColor.GREY),
          collapsed: true,
        }).catch(() => { });
      }

      await tabOrchestrationStore.upsertGroup(updatedGroup);
    } catch (err) {
      logger.error('TaskGroupManager: markGroupComplete failed:', err);
    }
  }

  /**
   * Mark a task group as errored (changes color to red).
   */
  async markGroupError(groupId: string): Promise<void> {
    try {
      const state = await tabOrchestrationStore.getState();
      const group = state.groups[groupId];
      if (!group) return;

      const updatedGroup: TaskGroup = {
        ...group,
        state: TaskGroupState.ERROR,
        color: GroupColor.RED,
      };

      if (this._tabGroupsAvailable && group.chromeGroupId !== null) {
        this._adapter.updateTabGroup(group.chromeGroupId, { color: toChromeColor(GroupColor.RED) }).catch(() => { });
      }

      await tabOrchestrationStore.upsertGroup(updatedGroup);
    } catch (err) {
      logger.error('TaskGroupManager: markGroupError failed:', err);
    }
  }

  /**
   * Remove a group (does NOT close its tabs, just ungroups them).
   */
  async dissolveGroup(groupId: string): Promise<void> {
    try {
      const chromeGroupId = this._chromeGroupIds.get(groupId);
      if (this._tabGroupsAvailable && chromeGroupId !== undefined) {
        // Ungrouping is done by moving each tab out
        const state = await tabOrchestrationStore.getState();
        const group = state.groups[groupId];
        if (group?.tabIds.length) {
          const valid = await this._filterExistingTabs(group.tabIds);
          if (valid.length > 0) {
            await this._adapter.ungroupTabs(valid);
          }
        }
        this._chromeGroupIds.delete(groupId);
      }
      await tabOrchestrationStore.removeGroup(groupId);
    } catch (err) {
      logger.error('TaskGroupManager: dissolveGroup failed:', err);
    }
  }

  dispose(): void {
    this._chromeGroupIds.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Filter a list of tab IDs to only those that currently exist in the browser. */
  private async _filterExistingTabs(tabIds: number[]): Promise<number[]> {
    const results = await Promise.allSettled(tabIds.map(id => this._adapter.getTab(id)));
    return tabIds.filter((_, i) => results[i].status === 'fulfilled');
  }
}

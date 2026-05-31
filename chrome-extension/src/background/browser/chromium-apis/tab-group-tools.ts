/**
 * TabGroupTools — chrome.tabGroups + chrome.tabs group management toolkit
 *
 * Lets the agent organize browser tabs into named, colored groups:
 *   - Create and name tab groups (e.g. "Research", "Shopping")
 *   - Move tabs between groups
 *   - Collapse/expand groups to save screen space
 *   - Query groups for context (agent knows which group it's working in)
 *
 * Permissions required: "tabGroups" ✅, "tabs" ✅ (both already in manifest)
 *
 * STATUS: Standalone tool — not yet wired into the agent pipeline.
 */

import { createLogger } from '@src/background/log';

const logger = createLogger('TabGroupTools');

export type GroupColor =
  | 'grey' | 'blue' | 'red' | 'yellow' | 'green'
  | 'pink' | 'purple' | 'cyan' | 'orange';

export interface TabGroupInfo {
  id: number;
  title: string;
  color: GroupColor;
  collapsed: boolean;
  windowId: number;
}

// ── Query ─────────────────────────────────────────────────────────────────────

/** Get all tab groups across all windows. */
export async function getAllGroups(): Promise<TabGroupInfo[]> {
  const groups = await chrome.tabGroups.query({});
  return groups.map(g => ({
    id: g.id,
    title: g.title ?? '',
    color: g.color as GroupColor,
    collapsed: g.collapsed,
    windowId: g.windowId,
  }));
}

/** Get tab groups in a specific window. */
export async function getGroupsInWindow(windowId: number): Promise<TabGroupInfo[]> {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.map(g => ({
    id: g.id,
    title: g.title ?? '',
    color: g.color as GroupColor,
    collapsed: g.collapsed,
    windowId: g.windowId,
  }));
}

/** Find a group by its title. */
export async function findGroupByTitle(title: string): Promise<TabGroupInfo | null> {
  const groups = await getAllGroups();
  return groups.find(g => g.title.toLowerCase() === title.toLowerCase()) ?? null;
}

// ── Create / Modify ───────────────────────────────────────────────────────────

/**
 * Group one or more tabs together and give the group a title and color.
 * Creates a new group and returns the group ID.
 */
export async function groupTabs(
  tabIds: number[],
  title: string,
  color: GroupColor = 'blue',
): Promise<number> {
  logger.info(`[TabGroupTools] Grouping tabs [${tabIds.join(', ')}] as "${title}"`);
  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, { title, color });
  return groupId;
}

/**
 * Add tabs to an existing group.
 */
export async function addTabsToGroup(tabIds: number[], groupId: number): Promise<void> {
  logger.debug(`[TabGroupTools] Adding tabs [${tabIds.join(', ')}] to group ${groupId}`);
  await chrome.tabs.group({ tabIds, groupId });
}

/**
 * Rename a tab group.
 */
export async function renameGroup(groupId: number, title: string): Promise<void> {
  await chrome.tabGroups.update(groupId, { title });
}

/**
 * Change the color of a tab group.
 */
export async function recolorGroup(groupId: number, color: GroupColor): Promise<void> {
  await chrome.tabGroups.update(groupId, { color });
}

/**
 * Collapse a tab group to save screen space.
 */
export async function collapseGroup(groupId: number): Promise<void> {
  logger.debug(`[TabGroupTools] Collapsing group ${groupId}`);
  await chrome.tabGroups.update(groupId, { collapsed: true });
}

/**
 * Expand a collapsed tab group.
 */
export async function expandGroup(groupId: number): Promise<void> {
  logger.debug(`[TabGroupTools] Expanding group ${groupId}`);
  await chrome.tabGroups.update(groupId, { collapsed: false });
}

/**
 * Ungroup tabs (remove them from any group).
 */
export async function ungroupTabs(tabIds: number[]): Promise<void> {
  await chrome.tabs.ungroup(tabIds);
}

// ── Agent Workflow Helpers ─────────────────────────────────────────────────────

/**
 * Create a dedicated "Agent Workspace" group for tabs the agent opens.
 * Automatically assigns a purple color and a title reflecting the task.
 */
export async function createAgentWorkspaceGroup(
  tabIds: number[],
  taskDescription: string,
): Promise<number> {
  const truncatedTitle = taskDescription.slice(0, 30) + (taskDescription.length > 30 ? '…' : '');
  return groupTabs(tabIds, `🤖 ${truncatedTitle}`, 'purple');
}

/**
 * Get the group a specific tab belongs to, if any.
 */
export async function getTabGroup(tabId: number): Promise<TabGroupInfo | null> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.groupId || tab.groupId === -1) return null;
  try {
    const group = await chrome.tabGroups.get(tab.groupId);
    return {
      id: group.id,
      title: group.title ?? '',
      color: group.color as GroupColor,
      collapsed: group.collapsed,
      windowId: group.windowId,
    };
  } catch {
    return null;
  }
}

/**
 * Move a tab group to the end of the tab strip.
 */
export async function moveGroupToEnd(groupId: number): Promise<void> {
  await chrome.tabGroups.move(groupId, { index: -1 });
}

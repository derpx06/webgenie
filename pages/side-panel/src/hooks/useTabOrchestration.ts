/**
 * useTabOrchestration — Side Panel Hook
 *
 * Subscribes to tab orchestration state from chrome.storage.local
 * using the existing useStorage pattern (consistent with other hooks).
 *
 * Returns live task groups and tab records for rendering.
 */

import { useState, useEffect } from 'react';
import type { TabOrchestrationState, TaskGroup, TabRecord } from '@extension/storage';
import { DEFAULT_TAB_ORCHESTRATION_STATE } from '@extension/storage';

const STORAGE_KEY = 'tab-orchestration-state';

function parseOrDefault(raw: unknown): TabOrchestrationState {
  if (raw && typeof raw === 'object') return raw as TabOrchestrationState;
  return DEFAULT_TAB_ORCHESTRATION_STATE;
}

export const useTabOrchestration = () => {
  const [state, setState] = useState<TabOrchestrationState>(DEFAULT_TAB_ORCHESTRATION_STATE);

  useEffect(() => {
    // Initial load
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      setState(parseOrDefault(result?.[STORAGE_KEY]));
    });

    // Live updates (storage.onChanged fires whenever background flushes)
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (!changes[STORAGE_KEY]) return;
      setState(parseOrDefault(changes[STORAGE_KEY].newValue));
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // Derived selectors
  const taskGroups: TaskGroup[] = Object.values(state.groups).sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  const allTabs: TabRecord[] = Object.values(state.tabs);

  const getTabsForGroup = (groupId: string): TabRecord[] => {
    const group = state.groups[groupId];
    if (!group) return [];
    return group.tabIds
      .map(id => state.tabs[id])
      .filter((t): t is TabRecord => Boolean(t));
  };

  const hasActiveTasks = taskGroups.some(g => g.state === 'active');

  return {
    state,
    taskGroups,
    allTabs,
    getTabsForGroup,
    activeTabId: state.activeTabId,
    activeGroupId: state.activeGroupId,
    hasActiveTasks,
  };
};

/**
 * TabOrchestrator Panel
 *
 * Side panel component that renders the live tab workflow visualization.
 *
 * Shows all AI task groups and their tab members with:
 * - Color-coded group headers
 * - Per-tab purpose labels and state indicators
 * - Active tab highlighting with animated dot
 * - Collapsible per-group and per-panel behavior
 *
 * Data source: chrome.storage.local via useTabOrchestration hook.
 * Updates are live — no polling, driven by storage.onChanged.
 */

import React, { useState } from 'react';
import { useTabOrchestration } from '../../hooks/useTabOrchestration';
import { TabGroupCard } from './TabGroupCard';

interface TabOrchestratorProps {
  isDarkMode: boolean;
  /** Only render the panel when the agent is (or recently was) active. */
  showWhenIdle?: boolean;
}

export const TabOrchestrator: React.FC<TabOrchestratorProps> = ({
  isDarkMode,
  showWhenIdle = false,
}) => {
  const { taskGroups, getTabsForGroup, activeTabId, hasActiveTasks } = useTabOrchestration();
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // Only render if there are active tasks or showWhenIdle is set
  if (!hasActiveTasks && !showWhenIdle) return null;
  if (taskGroups.length === 0) return null;

  return (
    <div
      className={`mx-4 mb-2 overflow-hidden rounded-xl border transition-all duration-300 ${
        isDarkMode
          ? 'border-white/8 bg-slate-900/60 backdrop-blur-xl'
          : 'border-slate-200 bg-white/80 backdrop-blur-xl'
      }`}
    >
      {/* Panel header */}
      <button
        type="button"
        id="webgenie-tab-orchestrator-header"
        onClick={() => setPanelCollapsed(c => !c)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-200 ${
          isDarkMode ? 'hover:bg-white/4' : 'hover:bg-slate-50'
        }`}
      >
        {/* Live indicator */}
        <div className="relative flex-shrink-0">
          <div
            className={`size-1.5 rounded-full ${
              hasActiveTasks ? 'bg-cyan-400' : 'bg-slate-500'
            }`}
          />
          {hasActiveTasks && (
            <div className="absolute inset-0 animate-ping rounded-full bg-cyan-400 opacity-60" />
          )}
        </div>

        <span
          className={`flex-1 text-[9px] font-black uppercase tracking-[0.15em] ${
            isDarkMode ? 'text-white/50' : 'text-slate-500'
          }`}
        >
          Workflows · {taskGroups.length} {taskGroups.length === 1 ? 'Task' : 'Tasks'}
        </span>

        {/* Tab count badge */}
        <span
          className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
            isDarkMode ? 'bg-white/8 text-white/50' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {taskGroups.reduce((sum, g) => sum + g.tabIds.length, 0)} tabs
        </span>

        {/* Collapse chevron */}
        <svg
          className={`size-3 flex-shrink-0 transition-transform duration-200 ${
            panelCollapsed ? 'rotate-0' : 'rotate-180'
          } ${isDarkMode ? 'text-white/25' : 'text-slate-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Group list */}
      {!panelCollapsed && (
        <div
          className={`border-t px-2 pb-2 pt-1.5 ${
            isDarkMode ? 'border-white/5' : 'border-slate-100'
          }`}
        >
          <div className="space-y-1.5">
            {taskGroups.map(group => (
              <TabGroupCard
                key={group.groupId}
                group={group}
                tabs={getTabsForGroup(group.groupId)}
                activeTabId={activeTabId}
                isDarkMode={isDarkMode}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TabOrchestrator;

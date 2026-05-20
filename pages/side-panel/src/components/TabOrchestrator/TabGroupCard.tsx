import React, { useState } from 'react';
import type { TaskGroup, TabRecord } from '@extension/storage';
import { GroupColor, TaskGroupState } from '@extension/storage';
import { TabPurposeRow } from './TabPurposeRow';

interface TabGroupCardProps {
  group: TaskGroup;
  tabs: TabRecord[];
  activeTabId: number | null;
  isDarkMode: boolean;
}

// Group color → Tailwind accent mapping
const COLOR_ACCENTS: Record<GroupColor, { bar: string; badge: string; text: string; ring: string }> = {
  [GroupColor.BLUE]:   { bar: 'bg-blue-500',    badge: 'bg-blue-500/15',   text: 'text-blue-400',   ring: 'ring-blue-500/20' },
  [GroupColor.GREEN]:  { bar: 'bg-emerald-500',  badge: 'bg-emerald-500/15', text: 'text-emerald-400', ring: 'ring-emerald-500/20' },
  [GroupColor.YELLOW]: { bar: 'bg-amber-400',    badge: 'bg-amber-400/15',  text: 'text-amber-400',  ring: 'ring-amber-400/20' },
  [GroupColor.PURPLE]: { bar: 'bg-violet-500',   badge: 'bg-violet-500/15', text: 'text-violet-400', ring: 'ring-violet-500/20' },
  [GroupColor.RED]:    { bar: 'bg-red-500',      badge: 'bg-red-500/15',    text: 'text-red-400',    ring: 'ring-red-500/20' },
  [GroupColor.GREY]:   { bar: 'bg-slate-500',    badge: 'bg-slate-500/15',  text: 'text-slate-400',  ring: 'ring-slate-500/20' },
  [GroupColor.CYAN]:   { bar: 'bg-cyan-500',     badge: 'bg-cyan-500/15',   text: 'text-cyan-400',   ring: 'ring-cyan-500/20' },
};

const STATE_LABEL: Record<TaskGroupState, string> = {
  [TaskGroupState.ACTIVE]:   'Active',
  [TaskGroupState.INACTIVE]: 'Inactive',
  [TaskGroupState.COMPLETE]: 'Done',
  [TaskGroupState.ERROR]:    'Error',
};

export const TabGroupCard: React.FC<TabGroupCardProps> = ({ group, tabs, activeTabId, isDarkMode }) => {
  const isActive = group.state === TaskGroupState.ACTIVE;
  // Start expanded if active, collapsed otherwise
  const [collapsed, setCollapsed] = useState(!isActive);

  const accent = COLOR_ACCENTS[group.color] ?? COLOR_ACCENTS[GroupColor.BLUE];
  const tabCount = tabs.length;

  return (
    <div
      className={`overflow-hidden rounded-xl border transition-all duration-300 ${
        isActive
          ? isDarkMode
            ? `bg-white/3 border-white/10 ring-1 ${accent.ring}`
            : `border-slate-200 bg-white ring-1 ${accent.ring}`
          : isDarkMode
          ? 'bg-white/2 border-white/5'
          : 'border-slate-100 bg-slate-50/50'
      }`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-200 ${
          isDarkMode ? 'hover:bg-white/4' : 'hover:bg-slate-50'
        }`}
      >
        {/* Color accent bar */}
        <div className={`h-4 w-1 flex-shrink-0 rounded-full ${accent.bar}`} />

        {/* Title + count */}
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-[11px] font-semibold leading-tight ${
              isDarkMode ? 'text-white/90' : 'text-slate-800'
            } ${!isActive ? 'opacity-60' : ''}`}
            title={group.title}
          >
            {group.title}
          </p>
        </div>

        {/* Tab count */}
        {tabCount > 0 && (
          <span
            className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${accent.badge} ${accent.text}`}
          >
            {tabCount}
          </span>
        )}

        {/* State pill */}
        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${accent.badge} ${accent.text}`}
        >
          {STATE_LABEL[group.state]}
        </span>

        {/* Chevron */}
        <svg
          className={`size-3 flex-shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-0' : 'rotate-180'} ${
            isDarkMode ? 'text-white/30' : 'text-slate-400'
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Tab list */}
      {!collapsed && tabs.length > 0 && (
        <div
          className={`border-t px-2 pb-2 pt-1 ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}
        >
          <div className="space-y-0.5">
            {tabs.map(tab => (
              <TabPurposeRow
                key={tab.tabId}
                tab={tab}
                isActive={tab.tabId === activeTabId}
                isDarkMode={isDarkMode}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!collapsed && tabs.length === 0 && (
        <div
          className={`border-t p-3 text-center ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}
        >
          <p className={`text-[10px] ${isDarkMode ? 'text-white/30' : 'text-slate-400'}`}>
            No tabs in this group
          </p>
        </div>
      )}
    </div>
  );
};

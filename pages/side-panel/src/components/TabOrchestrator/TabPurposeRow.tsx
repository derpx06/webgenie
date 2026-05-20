import React from 'react';
import type { TabRecord } from '@extension/storage';
import { TabState, WorkflowStage } from '@extension/storage';

interface TabPurposeRowProps {
  tab: TabRecord;
  isActive: boolean;
  isDarkMode: boolean;
}

// Map WorkflowStage to a readable label
const STAGE_LABELS: Record<WorkflowStage, string> = {
  [WorkflowStage.RESEARCHING]: 'Researching',
  [WorkflowStage.TYPING]: 'Typing',
  [WorkflowStage.CLICKING]: 'Clicking',
  [WorkflowStage.WAITING]: 'Waiting',
  [WorkflowStage.PLANNING]: 'Planning',
  [WorkflowStage.COMPARING]: 'Comparing',
  [WorkflowStage.COMPLETED]: 'Complete',
  [WorkflowStage.ERROR]: 'Error',
  [WorkflowStage.IDLE]: 'Idle',
};

// State → pill color classes
const STATE_PILL: Record<TabState, { bg: string; text: string; dot: string }> = {
  [TabState.PRIMARY_ACTIVE]: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  [TabState.BACKGROUND_ACTIVE]: { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400' },
  [TabState.WAITING]: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  [TabState.IDLE]: { bg: 'bg-slate-500/20', text: 'text-slate-400', dot: 'bg-slate-500' },
  [TabState.COMPLETE]: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  [TabState.ERROR]: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-500' },
};

// WorkflowStage → glow color for dot
const STAGE_DOT_COLOR: Partial<Record<WorkflowStage, string>> = {
  [WorkflowStage.RESEARCHING]: 'bg-cyan-400',
  [WorkflowStage.TYPING]: 'bg-blue-400',
  [WorkflowStage.CLICKING]: 'bg-indigo-400',
  [WorkflowStage.WAITING]: 'bg-amber-400',
  [WorkflowStage.PLANNING]: 'bg-violet-400',
  [WorkflowStage.COMPARING]: 'bg-teal-400',
  [WorkflowStage.COMPLETED]: 'bg-emerald-400',
  [WorkflowStage.ERROR]: 'bg-red-400',
};

export const TabPurposeRow: React.FC<TabPurposeRowProps> = ({ tab, isActive, isDarkMode }) => {
  const pill = STATE_PILL[tab.state] ?? STATE_PILL[TabState.IDLE];
  const stageLabel = STAGE_LABELS[tab.workflowStage] ?? 'Working';
  const stageDot = STAGE_DOT_COLOR[tab.workflowStage] ?? 'bg-cyan-400';

  return (
    <div
      className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-all duration-200 ${
        isActive
          ? isDarkMode
            ? 'bg-cyan-500/8 ring-1 ring-cyan-500/20'
            : 'bg-cyan-50 ring-1 ring-cyan-200'
          : isDarkMode
          ? 'hover:bg-white/4'
          : 'hover:bg-slate-50'
      }`}
    >
      {/* Status dot */}
      <div className="relative flex-shrink-0">
        <div className={`size-2 rounded-full ${isActive ? stageDot : pill.dot}`} />
        {isActive && tab.state === TabState.PRIMARY_ACTIVE && (
          <div className={`absolute inset-0 animate-ping rounded-full opacity-70 ${stageDot}`} />
        )}
      </div>

      {/* Purpose + URL */}
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[11px] font-medium leading-tight ${
            isDarkMode ? 'text-white/85' : 'text-slate-700'
          }`}
          title={tab.purpose}
        >
          {tab.purpose || tab.pageTitle || 'Loading…'}
        </p>
        {tab.url && (
          <p
            className={`mt-0.5 truncate text-[9px] ${isDarkMode ? 'text-white/30' : 'text-slate-400'}`}
            title={tab.url}
          >
            {tab.url.replace(/^https?:\/\/(www\.)?/, '').substring(0, 40)}
          </p>
        )}
      </div>

      {/* Right side: stage label + ephemeral tag */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {tab.temporary && (
          <span
            title="Ephemeral — auto-close candidate"
            className={`text-[8px] ${isDarkMode ? 'text-amber-400/60' : 'text-amber-500'}`}
          >
            ⚡
          </span>
        )}

        {isActive && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${pill.bg} ${pill.text}`}
          >
            {stageLabel}
          </span>
        )}
      </div>
    </div>
  );
};

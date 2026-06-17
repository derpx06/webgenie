import type { Message } from '@extension/storage';
import { Actors } from '@extension/storage';
import { memo, useState } from 'react';
import { AnswerRow } from './message-list/AnswerRow';
import { ThinkBlock } from './message-list/ThinkBlock';
import { HITLBlock } from './message-list/HITLBlock';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
  onOptionSelect?: (text: string) => void;
  isTaskRunning?: boolean;
}

const formatTimeOnly = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const renderDateSeparator = (timestamp: number, isDarkMode: boolean) => {
  const d = new Date(timestamp);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const text = isToday ? 'Today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="my-4 flex items-center gap-3">
      <div className={`h-[0.5px] grow ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`} />
      <span className="font-mono text-[9px] uppercase tracking-wider opacity-30 select-none">
        {text} · {time}
      </span>
      <div className={`h-[0.5px] grow ${isDarkMode ? 'bg-white/10' : 'bg-slate-200'}`} />
    </div>
  );
};

export default memo(function MessageList({
  messages,
  isDarkMode = false,
  onOptionSelect,
  isTaskRunning = false,
}: MessageListProps) {
  const [isStepsExpanded, setIsStepsExpanded] = useState<Record<number, boolean>>({});

  const toggleSteps = (cIdx: number) => {
    setIsStepsExpanded(prev => ({ ...prev, [cIdx]: !prev[cIdx] }));
  };

  const getElapsedDurationStr = () => {
    if (messages.length < 2) return '';
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];
    const diffMs = lastMsg.timestamp - firstMsg.timestamp;
    if (diffMs <= 0) return '';
    const totalSecs = Math.floor(diffMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };
  const durationStr = getElapsedDurationStr();

  const cycles: {
    userMessage: Message | null;
    blocks: {
      actor: Actors;
      messages: Message[];
    }[];
  }[] = [];

  type MessageBlock = { actor: Actors; messages: Message[] };
  let currentCycle = { userMessage: null as Message | null, blocks: [] as MessageBlock[] };
  let currentBlock: MessageBlock | null = null;

  messages.forEach((msg) => {
    if (msg.actor === Actors.USER) {
      if (currentBlock) {
        currentCycle.blocks.push(currentBlock);
        currentBlock = null;
      }
      if (currentCycle.userMessage || currentCycle.blocks.length > 0) {
        cycles.push(currentCycle);
      }
      currentCycle = { userMessage: msg, blocks: [] };
    } else {
      if (!currentBlock || currentBlock.actor !== msg.actor) {
        if (currentBlock) currentCycle.blocks.push(currentBlock);
        currentBlock = { actor: msg.actor, messages: [msg] };
      } else {
        currentBlock.messages.push(msg);
      }
    }
  });

  if (currentBlock) currentCycle.blocks.push(currentBlock);
  if (currentCycle.userMessage || currentCycle.blocks.length > 0) {
    cycles.push(currentCycle);
  }

  return (
    <div className="flex w-full flex-col gap-[6px] p-2">
      {cycles.map((cycle, cIdx) => {
        const isOverallLastCycle = cIdx === cycles.length - 1;

        // Separate technical agent blocks from conversational result/HITL blocks
        const agentBlocks = cycle.blocks.filter(
          b => b.actor === Actors.PLANNER || b.actor === Actors.NAVIGATOR || b.actor === Actors.VALIDATOR
        );
        const resultBlocks = cycle.blocks.filter(
          b => b.actor === Actors.SYSTEM || b.actor === Actors.HITL
        );

        // Scoped status of this cycle
        const isCycleCancelled = cycle.blocks.some(b => b.messages.some(m => m.isCancelled));
        const isCycleFailed = cycle.blocks.some(b => b.messages.some(m => m.isFailed));
        const isCycleRunning = isOverallLastCycle && isTaskRunning;

        const status = isCycleRunning ? 'running' :
                       isCycleCancelled ? 'cancelled' :
                       isCycleFailed ? 'failed' :
                       'success';

        // Count technical steps in this cycle
        const cycleStepsCount = agentBlocks.reduce(
          (sum, b) => sum + b.messages.filter(m => m.content !== 'Showing progress...').length,
          0
        );

        // Control collapse state. Running is open by default, completed is closed by default.
        const isExpanded = isStepsExpanded[cIdx] ?? isCycleRunning;

        return (
          <div key={cIdx} className="animate-in fade-in slide-in-from-bottom-2 flex w-full flex-col gap-[6px] duration-500">
            {cycle.userMessage && cIdx === 0 && renderDateSeparator(cycle.userMessage.timestamp, isDarkMode)}

            {cycle.userMessage && (
              <div className="mb-1.5 flex flex-col items-end">
                <div className="msg-user">
                  <div className="bub">
                    {cycle.userMessage.content}
                  </div>
                </div>
                <span className="mt-1 font-mono text-[9px] uppercase tracking-wider opacity-30 select-none">
                  {formatTimeOnly(cycle.userMessage.timestamp)}
                </span>
              </div>
            )}

            {/* Collapsible Agent Steps Container */}
            {agentBlocks.length > 0 && (
              <div
                className={`rounded-2xl border transition-all duration-300 ${
                  isDarkMode
                    ? 'border-white/[0.06] bg-white/[0.02]'
                    : 'border-slate-200/80 bg-slate-50/50'
                }`}
                style={{
                  boxShadow: isDarkMode
                    ? '0 4px 20px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.01)'
                    : '0 4px 12px rgba(0,0,0,0.02), inset 0 1px 0 rgba(255,255,255,0.8)',
                }}
              >
                {/* Header Toggle Button */}
                <button
                  type="button"
                  onClick={() => toggleSteps(cIdx)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left font-sans select-none"
                >
                  <div className="flex items-center gap-2.5">
                    {/* Status Dot / Icon */}
                    <div className={`flex items-center justify-center rounded-full p-1 size-5 shrink-0 ${
                      status === 'running' ? 'bg-indigo-500/10 text-indigo-400' :
                      status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                      status === 'cancelled' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-rose-500/10 text-rose-400'
                    }`}>
                      {status === 'running' && (
                        <div className="size-2 rounded-full bg-indigo-400 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                      )}
                      {status === 'success' && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" className="size-3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {status === 'cancelled' && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-3">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      )}
                      {status === 'failed' && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-3">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      )}
                    </div>

                    {/* Status Title & Metadata */}
                    <div className="flex flex-col">
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${
                        status === 'running' ? 'text-indigo-400' :
                        status === 'success' ? 'text-emerald-400' :
                        status === 'cancelled' ? 'text-amber-400' :
                        'text-rose-400'
                      }`}>
                        {status === 'running' ? 'Running Automation' :
                         status === 'success' ? 'Automation Completed' :
                         status === 'cancelled' ? 'Automation Cancelled' :
                         'Automation Failed'}
                      </span>
                      <span className={`text-[9.5px] font-semibold mt-0.5 tracking-tight ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        {cycleStepsCount} step{cycleStepsCount === 1 ? '' : 's'}
                        {durationStr && isOverallLastCycle && ` · ${durationStr}`}
                      </span>
                    </div>
                  </div>

                  {/* Expand Icon */}
                  <div className={`flex items-center gap-1.5 text-[10px] font-bold tracking-tight uppercase ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    <span>Detail</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-3.5 transition-transform duration-200"
                      style={{
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>

                {/* Collapsible Content */}
                {isExpanded && (
                  <div className={`px-4 pb-4 pt-1 flex flex-col gap-2.5 border-t ${
                    isDarkMode ? 'border-white/[0.04]' : 'border-slate-200/50'
                  }`}>
                    {agentBlocks.map((block, bIdx) => {
                      const isLastInCycle = bIdx === agentBlocks.length - 1;
                      const isOverallLastBlock = isOverallLastCycle && isLastInCycle;
                      const progressIndex = block.messages.findIndex(m => m.content === 'Showing progress...');
                      const hasProgress = progressIndex !== -1;
                      const isActive = isOverallLastBlock && (hasProgress || isTaskRunning);

                      return (
                        <ThinkBlock
                          key={bIdx}
                          actor={block.actor}
                          messages={block.messages}
                          isActive={isActive}
                          isDarkMode={isDarkMode}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Results / HITL Blocks */}
            {resultBlocks.length > 0 && (
              <div className="flex flex-col gap-[6px]">
                {resultBlocks.map((block, bIdx) => {
                  if (block.actor === Actors.SYSTEM) {
                    return (
                      <AnswerRow
                        key={bIdx}
                        messages={block.messages}
                        isDarkMode={isDarkMode}
                      />
                    );
                  }

                  if (block.actor === Actors.HITL) {
                    return (
                      <HITLBlock
                        key={bIdx}
                        messages={block.messages}
                        isDarkMode={isDarkMode}
                        onOptionSelect={onOptionSelect}
                      />
                    );
                  }

                  return null;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

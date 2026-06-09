import type { Message } from '@extension/storage';
import { Actors } from '@extension/storage';
import { memo } from 'react';
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

  // Calculate total steps for status rows
  const totalStepsCount = messages.filter(
    m => m.actor !== Actors.USER && m.actor !== Actors.SYSTEM && m.actor !== Actors.HITL && m.content !== 'Showing progress...'
  ).length;

  const isCompleted = !isTaskRunning && messages.length > 0;
  const lastSystemMessage = [...messages].reverse().find(m => m.actor === Actors.SYSTEM);
  const summaryDetail = lastSystemMessage ? lastSystemMessage.content : 'Task finished successfully.';

  return (
    <div className="flex w-full flex-col gap-[8px] p-3">
      {cycles.map((cycle, cIdx) => (
        <div key={cIdx} className="animate-in fade-in slide-in-from-bottom-2 flex w-full flex-col gap-[8px] duration-500">
          {cycle.userMessage && cIdx === 0 && renderDateSeparator(cycle.userMessage.timestamp, isDarkMode)}

          {cycle.userMessage && (
            <div className="mb-2 flex flex-col items-end">
              <div className={`max-w-[85%] rounded-[11px] rounded-br-[3px] border border-solid px-3.5 py-2 text-[13px] leading-relaxed shadow-sm ${isDarkMode
                ? 'bg-[#818cf8]/[0.13] border-[#818cf8]/20 text-[#f1f5f9]'
                : 'bg-[#8B5CF6]/[0.13] border-[#8B5CF6]/20 text-slate-900'
                }`}>
                {cycle.userMessage.content}
              </div>
              <span className="mt-1 font-mono text-[9px] uppercase tracking-wider opacity-30 select-none">
                {formatTimeOnly(cycle.userMessage.timestamp)}
              </span>
            </div>
          )}

          {cycle.blocks.length > 0 && (
            <div className="flex flex-col gap-[8px]">
              {cycle.blocks.map((block, bIdx) => {
                const isLastInCycle = bIdx === cycle.blocks.length - 1;
                const isOverallLastBlock = cIdx === cycles.length - 1 && isLastInCycle;
                const progressIndex = block.messages.findIndex(m => m.content === 'Showing progress...');
                const hasProgress = progressIndex !== -1;
                const isActive = isOverallLastBlock && hasProgress;
                const nextBlockIsSystem = !isLastInCycle && cycle.blocks[bIdx + 1].actor === Actors.SYSTEM;
                const shouldDefaultOpen = isActive || isLastInCycle || nextBlockIsSystem;

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
      ))}

      {/* Status Row at the bottom of the stream */}
      {isTaskRunning && (
        <div className="status-row running animate-slide-in">
          <div className="status-dot" />
          <span className="status-text">RUNNING</span>
          <span className="status-steps">· {totalStepsCount} step{totalStepsCount === 1 ? '' : 's'}</span>
          <div className="status-line" />
        </div>
      )}

      {isCompleted && (
        <>
          <div className="status-row completed animate-slide-in">
            <span className="completed-status-text">✓ COMPLETED</span>
            <span className="status-steps">· {totalStepsCount} step{totalStepsCount === 1 ? '' : 's'}</span>
            <div className="status-line" />
          </div>

          <div className="task-completion-card animate-slide-in">
            <div className="completion-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" className="size-3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="completion-details">
              <span className="completion-title">Task complete</span>
              <span className="completion-subtitle" title={summaryDetail}>
                {summaryDetail}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

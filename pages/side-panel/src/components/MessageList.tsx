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
  const [isCompletionExpanded, setIsCompletionExpanded] = useState(false);

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

  const isResearch = messages.some(m => m.content.toLowerCase().includes('search') || m.content.toLowerCase().includes('research'));
  const titleText = isResearch ? 'Research Completed' : 'Task Completed';
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
    <div className="flex w-full flex-col gap-[6px] p-2">
      {cycles.map((cycle, cIdx) => (
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

          {cycle.blocks.length > 0 && (
            <div className="flex flex-col gap-[6px]">
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

          <div 
            className="task-completion-card animate-slide-in"
            onClick={() => setIsCompletionExpanded(!isCompletionExpanded)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <div className="completion-icon-large">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="completion-details" style={{ flexGrow: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span className="completion-title">✓ {titleText}</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    width: '12px',
                    height: '12px',
                    color: 'var(--ws-muted)',
                    transform: isCompletionExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.2s ease',
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <div className="completion-meta-row">
                <span>{totalStepsCount} step{totalStepsCount === 1 ? '' : 's'} completed</span>
                {durationStr && (
                  <>
                    <span className="completion-bullet-divider">•</span>
                    <span>{durationStr}</span>
                  </>
                )}
              </div>
              {isCompletionExpanded && (
                <span className="completion-subtitle" title={summaryDetail} style={{ display: 'block', marginTop: '6px' }}>
                  {summaryDetail}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

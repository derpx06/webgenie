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
    <div className="my-6 flex items-center gap-4 opacity-40">
      <div className={`h-px grow ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
      <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        {text} • {time}
      </span>
      <div className={`h-px grow ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`} />
    </div>
  );
};

export default memo(function MessageList({ messages, isDarkMode = false, onOptionSelect }: MessageListProps) {
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
    <div className="flex w-full flex-col gap-6 p-4">
      {cycles.map((cycle, cIdx) => (
        <div key={cIdx} className="animate-in fade-in slide-in-from-bottom-2 flex w-full flex-col duration-500">
          {cycle.userMessage && cIdx === 0 && renderDateSeparator(cycle.userMessage.timestamp, isDarkMode)}

          {cycle.userMessage && (
            <div className="mb-6 flex flex-col items-end">
              <div className={`font-inter max-w-[85%] rounded-2xl rounded-tr-none px-4 py-3 text-[14px] font-medium leading-relaxed shadow-sm ${isDarkMode
                ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white'
                : 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white'
                }`}>
                {cycle.userMessage.content}
              </div>
              <span className={`mt-1.5 text-[10px] font-bold uppercase tracking-tighter opacity-40 ${isDarkMode ? 'text-white' : 'text-gray-600'}`}>
                {formatTimeOnly(cycle.userMessage.timestamp)}
              </span>
            </div>
          )}

          {cycle.blocks.length > 0 && (
            <div className="flex flex-col gap-4">
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
                    defaultOpen={shouldDefaultOpen}
                    isDarkMode={isDarkMode}
                  />
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

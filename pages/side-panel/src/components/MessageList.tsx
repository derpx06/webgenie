import type { Message } from '@extension/storage';
import { Actors } from '@extension/storage';
import { memo, useState } from 'react';
import { t } from '@extension/i18n';
import { AnswerRow } from './message-list/AnswerRow';
import { ThinkBlock } from './message-list/ThinkBlock';
import { HITLBlock } from './message-list/HITLBlock';
import { ResumableNotice, SystemNotice } from './message-list/SystemNotice';
import type { ResumableTask } from '../hooks/useAgentConnection';
import type { TaskPhase } from '../types/event';

export const PROGRESS_MARKER = 'Showing progress...';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
  onOptionSelect?: (text: string, displayText?: string, secrets?: string[]) => void;
  isTaskRunning?: boolean;
  /** The live phase, so the newest run card can say "waiting" or "paused" rather than guessing. */
  runPhase?: TaskPhase;
  /** Why the running task is paused (a task.pause event's details), or null. */
  pausedReason?: string | null;
  resumableTask?: ResumableTask | null;
  onResumeSavedTask?: () => void;
  onDiscardSavedTask?: () => void;
}

const formatTimeOnly = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type RunStatus = 'running' | 'waiting' | 'paused' | 'success' | 'cancelled' | 'failed';

const RUN_TONE: Record<RunStatus, string> = {
  running: 'wg-tone-accent',
  waiting: 'wg-tone-wait',
  paused: 'wg-tone-wait',
  success: 'wg-tone-ok',
  cancelled: 'wg-tone-idle',
  failed: 'wg-tone-err',
};

const RUN_LABEL: Record<RunStatus, () => string> = {
  running: () => t('trail_running'),
  waiting: () => t('status_phase_waitingHuman'),
  paused: () => t('status_phase_paused'),
  success: () => t('trail_done'),
  cancelled: () => t('trail_cancelled'),
  failed: () => t('trail_failed'),
};

const RunIcon = ({ status }: { status: RunStatus }) => {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'size-3.5',
    'aria-hidden': true,
  };
  if (status === 'running') return <span className="wg-dot wg-dot-live" aria-hidden="true" />;
  if (status === 'waiting') return <svg {...common}><path d="M8 2.5A5.5 5.5 0 1 1 3.4 11L2 14l3-1.4A5.5 5.5 0 0 1 8 2.5Z" /></svg>;
  if (status === 'paused') return <svg {...common}><path d="M6 4v8M10 4v8" /></svg>;
  if (status === 'success') return <svg {...common}><path d="M3 8.5 6.5 12 13 4.5" /></svg>;
  if (status === 'cancelled') return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M5.5 5.5l5 5" /></svg>;
  return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 5v4M8 11h.01" /></svg>;
};

const Caret = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`wg-caret ${open ? 'wg-caret-open' : ''}`}
    aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
);

type MessageBlock = { actor: Actors; messages: Message[] };
type Cycle = { userMessage: Message | null; blocks: MessageBlock[] };

/** Groups the flat message log into one card per task, each holding its actor blocks in order. */
const toCycles = (messages: Message[]): Cycle[] => {
  const cycles: Cycle[] = [];
  let current: Cycle = { userMessage: null, blocks: [] };
  let block: MessageBlock | null = null;

  const closeBlock = () => {
    if (block) current.blocks.push(block);
    block = null;
  };

  for (const msg of messages) {
    if (msg.actor === Actors.USER) {
      closeBlock();
      if (current.userMessage || current.blocks.length > 0) cycles.push(current);
      current = { userMessage: msg, blocks: [] };
    } else if (!block || block.actor !== msg.actor) {
      closeBlock();
      block = { actor: msg.actor, messages: [msg] };
    } else {
      block.messages.push(msg);
    }
  }

  closeBlock();
  if (current.userMessage || current.blocks.length > 0) cycles.push(current);
  return cycles;
};

export default memo(function MessageList({
  messages,
  isDarkMode = false,
  onOptionSelect,
  isTaskRunning = false,
  runPhase = 'idle',
  pausedReason = null,
  resumableTask = null,
  onResumeSavedTask,
  onDiscardSavedTask,
}: MessageListProps) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const cycles = toCycles(messages);

  return (
    <div className="wg-trail">
      {cycles.map((cycle, cIdx) => {
        const isLastCycle = cIdx === cycles.length - 1;

        const agentBlocks = cycle.blocks.filter(
          b => b.actor === Actors.PLANNER || b.actor === Actors.NAVIGATOR || b.actor === Actors.VALIDATOR,
        );
        const resultBlocks = cycle.blocks.filter(b => b.actor === Actors.SYSTEM || b.actor === Actors.HITL);
        // Every cycle but the last is followed by a user message, which answers its questions; only the
        // newest question of the last cycle is still open.
        const openQuestionIdx = isLastCycle ? resultBlocks.map(b => b.actor).lastIndexOf(Actors.HITL) : -1;

        const isCancelled = cycle.blocks.some(b => b.messages.some(m => m.isCancelled));
        const isFailed = cycle.blocks.some(b => b.messages.some(m => m.isFailed));
        // Only the newest run can still be live, and the live phase decides what it is doing.
        const isLive = isLastCycle && (isTaskRunning || runPhase === 'waiting_human' || runPhase === 'paused');
        const isRunning = isLive && isTaskRunning && runPhase !== 'paused';

        const status: RunStatus = isCancelled
          ? 'cancelled'
          : isFailed
            ? 'failed'
            : isLive && runPhase === 'waiting_human'
              ? 'waiting'
              : isLive && runPhase === 'paused'
                ? 'paused'
                : isRunning
                  ? 'running'
                  : 'success';

        const stepCount = agentBlocks.reduce(
          (sum, b) => sum + b.messages.filter(m => m.content !== PROGRESS_MARKER).length,
          0,
        );

        // A run that is still going is open; a finished one collapses to its summary line.
        const isOpen = expanded[cIdx] ?? isLive;

        return (
          <div key={cIdx} className="wg-turn">
            {cycle.userMessage && (
              <>
                <div className="wg-user-msg">{cycle.userMessage.content}</div>
                <span className="wg-stamp wg-num">{formatTimeOnly(cycle.userMessage.timestamp)}</span>
              </>
            )}

            {agentBlocks.length > 0 && (
              <section className={`wg-run ${RUN_TONE[status]}`}>
                <button
                  type="button"
                  className="wg-run-head"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(prev => ({ ...prev, [cIdx]: !isOpen }))}>
                  <RunIcon status={status} />
                  <span className="wg-run-title">{RUN_LABEL[status]()}</span>
                  <span className="wg-run-sub">
                    <span className="wg-num">
                      {stepCount === 1 ? t('trail_stepOne') : t('trail_steps', [String(stepCount)])}
                    </span>
                    <Caret open={isOpen} />
                  </span>
                  <span className="sr-only">{isOpen ? t('trail_detailsHide') : t('trail_detailsShow')}</span>
                </button>

                {isOpen && (
                  <div className="wg-run-body">
                    {agentBlocks.map((block, bIdx) => (
                      <ThinkBlock
                        key={bIdx}
                        actor={block.actor}
                        messages={block.messages}
                        isActive={isRunning && bIdx === agentBlocks.length - 1}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {resultBlocks.map((block, bIdx) =>
              block.actor === Actors.SYSTEM ? (
                <AnswerRow key={bIdx} messages={block.messages} />
              ) : (
                <HITLBlock
                  key={bIdx}
                  messages={block.messages}
                  onOptionSelect={onOptionSelect}
                  answered={bIdx !== openQuestionIdx}
                />
              ),
            )}
          </div>
        );
      })}

      {/* Transient status, not stored in the chat history. The status bar carries the paused
          reason while a task is live; this covers a pause with no run card to attach it to. */}
      {pausedReason && !isTaskRunning && (
        <SystemNotice tone="wait">
          <p>{pausedReason}</p>
        </SystemNotice>
      )}
      {resumableTask && (
        <ResumableNotice
          task={resumableTask}
          isDarkMode={isDarkMode}
          onResume={onResumeSavedTask}
          onDiscard={onDiscardSavedTask}
        />
      )}
    </div>
  );
});

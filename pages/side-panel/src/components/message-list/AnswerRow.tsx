import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '@extension/i18n';
import type { Message } from '@extension/storage';

interface AnswerRowProps {
  messages: Message[];
}

const formatTimeOnly = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Outcome = 'completed' | 'failed' | 'cancelled';

const OUTCOME: Record<Outcome, { tone: string; label: () => string }> = {
  completed: { tone: 'wg-tone-ok', label: () => t('chat_answer_completed') },
  failed: { tone: 'wg-tone-err', label: () => t('chat_answer_failed') },
  cancelled: { tone: 'wg-tone-idle', label: () => t('chat_answer_cancelled') },
};

const OutcomeIcon = ({ outcome }: { outcome: Outcome }) => {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'size-3',
    'aria-hidden': true,
  };
  if (outcome === 'completed') return <svg {...common}><path d="M3 8.5 6.5 12 13 4.5" /></svg>;
  if (outcome === 'cancelled') return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M5.5 5.5l5 5" /></svg>;
  return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 5v4M8 11h.01" /></svg>;
};

/**
 * What the agent came back with. An error answer is drawn in the error tone so a failure
 * is visible without reading the prose.
 */
export const AnswerRow: React.FC<AnswerRowProps> = ({ messages }) => {
  const lastMsg = messages[messages.length - 1];
  // The badge follows the task state the event recorded on the message (task.ok / task.fail / task.cancel), never the
  // wording. Rows with no recorded state, such as errors the panel reports itself, get no badge.
  const outcome: Outcome | null = messages.some(m => m.isFailed)
    ? 'failed'
    : messages.some(m => m.isCancelled)
      ? 'cancelled'
      : messages.some(m => m.isFailed === false)
        ? 'completed'
        : null;

  // Inside a failure callout the tone already says "failed", so the badge would be a third
  // copy of the same word (status bar, run card, badge). Only a plain answer carries it.
  const showBadge = outcome !== null && outcome !== 'failed';

  const body = (
    <>
      {messages.map((m, i) => (
        <div key={i} className="wg-answer">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        {showBadge && outcome && (
          <span className="wg-chip">
            <OutcomeIcon outcome={outcome} />
            {OUTCOME[outcome].label()}
          </span>
        )}
        <span className="wg-meta wg-num">{formatTimeOnly(lastMsg.timestamp)}</span>
      </div>
    </>
  );

  // A failure gets the callout treatment; an ordinary answer stays plain so the text leads.
  if (outcome === 'failed') {
    return <div className="wg-callout wg-tone-err">{body}</div>;
  }

  return <div className={`flex flex-col ${outcome ? OUTCOME[outcome].tone : 'wg-tone-idle'}`}>{body}</div>;
};

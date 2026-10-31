import type { ReactNode } from 'react';
import { t } from '@extension/i18n';
import type { ResumableTask } from '../../hooks/useAgentConnection';

interface SystemNoticeProps {
  children: ReactNode;
  /** Which semantic colour the notice carries. Waiting is the default. */
  tone?: 'wait' | 'err' | 'idle';
  /** Unused; kept so callers that still pass it keep type-checking. */
  isDarkMode?: boolean;
}

/** A status notice from the agent inside the chat. It is not an answer, so it carries no Completed/Failed badge. */
export const SystemNotice = ({ children, tone = 'wait' }: SystemNoticeProps) => (
  <div role="status" className={`wg-callout wg-tone-${tone}`}>
    <div className="wg-callout-note">{children}</div>
  </div>
);

interface ResumableNoticeProps {
  task: ResumableTask;
  isDarkMode?: boolean;
  onResume?: () => void;
  onDiscard?: () => void;
}

/** A saved task the background can continue: offered while the panel is open, never stored in the chat history. */
export const ResumableNotice = ({ task, onResume, onDiscard }: ResumableNoticeProps) => (
  <div role="status" className="wg-callout wg-tone-wait">
    <div className="wg-callout-head">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
        <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
        <path d="M2.2 2.5v3h3" />
      </svg>
      <span>{task.status === 'waiting_human' ? t('chat_resumable_waitingHuman') : t('chat_resumable_interrupted')}</span>
    </div>

    {task.task && <p className="wg-callout-note line-clamp-3 break-words">{task.task}</p>}
    {task.question && <p className="wg-callout-body mt-1">{task.question}</p>}

    <div className="wg-callout-actions">
      <button type="button" className="wg-btn wg-btn-primary" onClick={onResume}>
        {t('chat_buttons_resume')}
      </button>
      <button type="button" className="wg-btn wg-btn-quiet" onClick={onDiscard}>
        {t('chat_buttons_discard')}
      </button>
    </div>
  </div>
);

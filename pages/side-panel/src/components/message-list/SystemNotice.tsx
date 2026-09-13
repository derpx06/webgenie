import type { ReactNode } from 'react';
import { t } from '@extension/i18n';
import type { ResumableTask } from '../../hooks/useAgentConnection';

interface SystemNoticeProps {
  isDarkMode: boolean;
  children: ReactNode;
}

/** A status notice from the agent inside the chat. It is not an answer, so it carries no Completed/Failed badge. */
export const SystemNotice = ({ isDarkMode, children }: SystemNoticeProps) => (
  <div
    role="status"
    className={`my-2 rounded-2xl border px-4 py-3 text-[13px] ${
      isDarkMode ? 'border-amber-500/30 bg-amber-500/10 text-slate-200' : 'border-amber-200 bg-amber-50 text-slate-800'
    }`}>
    {children}
  </div>
);

interface ResumableNoticeProps {
  task: ResumableTask;
  isDarkMode: boolean;
  onResume?: () => void;
  onDiscard?: () => void;
}

/** A saved task the background can continue: offered while the panel is open, never stored in the chat history. */
export const ResumableNotice = ({ task, isDarkMode, onResume, onDiscard }: ResumableNoticeProps) => (
  <SystemNotice isDarkMode={isDarkMode}>
    <p className="font-semibold">
      {task.status === 'waiting_human' ? t('chat_resumable_waitingHuman') : t('chat_resumable_interrupted')}
    </p>
    {task.task && <p className="mt-1 line-clamp-3 break-words opacity-80">{task.task}</p>}
    {task.question && <p className="mt-1 break-words font-medium">{task.question}</p>}
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        onClick={onResume}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-500">
        {t('chat_buttons_resume')}
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
          isDarkMode ? 'border-white/10 hover:bg-white/10' : 'border-slate-200 hover:bg-slate-100'
        }`}>
        {t('chat_buttons_discard')}
      </button>
    </div>
  </SystemNotice>
);

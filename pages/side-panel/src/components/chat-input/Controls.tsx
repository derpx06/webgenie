import React from 'react';

interface ChatActionButtonsProps {
    showStopButton: boolean;
    onStopTask: () => void;
    isSendButtonDisabled: boolean;
    isDarkMode: boolean;
}

export const ChatActionButtons: React.FC<ChatActionButtonsProps> = ({
    showStopButton,
    onStopTask,
    isSendButtonDisabled,
    isDarkMode
}) => {
    if (showStopButton) {
        return (
            <button
                type="button"
                onClick={onStopTask}
                className={`group/stop flex items-center gap-1.5 rounded-[10px] bg-gradient-to-r from-rose-500 to-red-600 px-3.5 py-1.5 font-sans text-[11px] font-medium uppercase tracking-wider text-white shadow-sm transition-all duration-200 hover:-translate-y-px hover:from-rose-600 hover:to-red-700 hover:shadow-[0_0_15px_rgba(244,63,94,0.4)] active:translate-y-0 active:scale-95`}>
                <span>Stop</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3 transition-transform duration-300 group-hover/stop:rotate-90">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                </svg>
            </button>
        );
    }

    return (
        <button
            type="submit"
            disabled={isSendButtonDisabled}
            className={`group/send relative flex items-center gap-1.5 overflow-hidden rounded-[10px] px-4 py-1.5 font-sans text-[11px] font-medium uppercase tracking-wider shadow-sm transition-all duration-300 ${
                isSendButtonDisabled
                    ? (isDarkMode
                        ? 'border border-white/[0.06] bg-white/[0.04] text-slate-500'
                        : 'border border-slate-200 bg-slate-100 text-slate-400')
                    : `text-white hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-95 ${
                        isDarkMode 
                            ? 'bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 hover:from-violet-500 hover:via-indigo-500 hover:to-blue-500 hover:shadow-[0_0_20px_rgba(99,102,241,0.45)]' 
                            : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 hover:shadow-[0_0_20px_rgba(99,102,241,0.35)]'
                      }`
            }`}>
            <span className="relative z-10">Run task</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`relative z-10 size-3 transition-all duration-300 ${!isSendButtonDisabled ? 'group-hover/send:-translate-y-px group-hover/send:translate-x-px' : 'opacity-40'}`}>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            {!isSendButtonDisabled && (
                <div className="via-white/12 absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent to-transparent transition-transform duration-700 group-hover/send:translate-x-full" />
            )}
        </button>
    );
};

interface ShortcutHintProps {
    isDarkMode: boolean;
    disabled: boolean;
}

export const ShortcutHint: React.FC<ShortcutHintProps> = ({ isDarkMode, disabled }) => {
    if (disabled) return null;

    return (
        <div className="mt-2.5 flex select-none items-center justify-center gap-1.5 font-mono text-[9px] uppercase tracking-wider opacity-35">
            <span className={`rounded border px-1 py-0.5 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.04] text-slate-300' : 'border-slate-500/15 bg-slate-500/10 text-slate-600'}`}>[⌘]</span>
            <span className={`rounded border px-1 py-0.5 ${isDarkMode ? 'border-white/[0.08] bg-white/[0.04] text-slate-300' : 'border-slate-500/15 bg-slate-500/10 text-slate-600'}`}>[↵]</span>
            <span>· SEARCH · EXTRACT · AUTOMATE</span>
        </div>
    );
};

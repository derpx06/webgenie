import React from 'react';

interface ChatActionButtonsProps {
    showStopButton: boolean;
    onStopTask: () => void;
    historicalSessionId?: string | null;
    handleReplay: () => void;
    isSendButtonDisabled: boolean;
    isDarkMode: boolean;
}

export const ChatActionButtons: React.FC<ChatActionButtonsProps> = ({
    showStopButton,
    onStopTask,
    historicalSessionId,
    handleReplay,
    isSendButtonDisabled,
    isDarkMode
}) => {
    if (showStopButton) {
        return (
            <button
                type="button"
                onClick={onStopTask}
                className={`group/stop flex items-center gap-1.5 rounded-[6px] px-3.5 py-1.5 font-sans text-[11px] font-medium uppercase tracking-wider text-white shadow-sm transition-all duration-200 hover:-translate-y-[1px] active:translate-y-0 active:scale-95 ${
                    isDarkMode ? 'bg-[#f87171] hover:bg-[#ef4444]' : 'bg-[#DC2626] hover:bg-[#b91c1c]'
                }`}>
                <span>Stop</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3 transition-transform duration-300 group-hover/stop:rotate-90">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                </svg>
            </button>
        );
    }

    if (historicalSessionId) {
        return (
            <button
                type="button"
                onClick={handleReplay}
                className={`group/replay flex items-center gap-1.5 rounded-[6px] px-3.5 py-1.5 font-sans text-[11px] font-medium uppercase tracking-wider text-white shadow-sm transition-all duration-200 hover:-translate-y-[1px] active:translate-y-0 active:scale-95 ${
                    isDarkMode ? 'bg-[#818cf8] hover:bg-[#6366f1]' : 'bg-[#8B5CF6] hover:bg-[#7c3aed]'
                }`}>
                <span>Replay</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3 transition-transform duration-500 group-hover/replay:rotate-180">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
            </button>
        );
    }

    return (
        <button
            type="submit"
            disabled={isSendButtonDisabled}
            className={`group/send relative flex items-center gap-1.5 overflow-hidden rounded-[6px] px-4 py-1.5 font-sans text-[11px] font-medium uppercase tracking-wider shadow-sm transition-all duration-300 ${
                isSendButtonDisabled
                    ? (isDarkMode
                        ? 'bg-white/[0.04] text-slate-500 border border-white/[0.06]'
                        : 'bg-slate-100 text-slate-400 border border-slate-200')
                    : `text-white hover:-translate-y-[1px] hover:shadow-md active:translate-y-0 active:scale-95 ${
                        isDarkMode ? 'bg-[#818cf8] hover:bg-[#6366f1]' : 'bg-[#8B5CF6] hover:bg-[#7c3aed]'
                      }`
            }`}>
            <span className="relative z-10">Run task</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`size-3 relative z-10 transition-all duration-300 ${!isSendButtonDisabled ? 'group-hover/send:-translate-y-[1px] group-hover/send:translate-x-[1px]' : 'opacity-40'}`}>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            {!isSendButtonDisabled && (
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/12 to-transparent transition-transform duration-700 group-hover/send:translate-x-full" />
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
        <div className="mt-2.5 flex items-center justify-center gap-1.5 font-mono text-[9px] uppercase tracking-wider opacity-35 select-none">
            <span className={`px-1 py-0.5 rounded border ${isDarkMode ? 'bg-white/[0.04] border-white/[0.08] text-slate-300' : 'bg-slate-500/10 border-slate-500/15 text-slate-600'}`}>[⌘]</span>
            <span className={`px-1 py-0.5 rounded border ${isDarkMode ? 'bg-white/[0.04] border-white/[0.08] text-slate-300' : 'bg-slate-500/10 border-slate-500/15 text-slate-600'}`}>[↵]</span>
            <span>· SEARCH · EXTRACT · AUTOMATE</span>
        </div>
    );
};

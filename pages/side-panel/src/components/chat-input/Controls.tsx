import React from 'react';
import { FaRegStopCircle } from 'react-icons/fa';
import { BsArrowRepeat, BsSendFill } from 'react-icons/bs';

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
                className="group/stop flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-500 px-4 py-2 text-[13px] font-black text-white shadow-lg transition-all hover:from-red-500 hover:to-red-400 active:scale-95">
                <span className="uppercase tracking-tight">Stop</span>
                <FaRegStopCircle size={14} className="transition-transform duration-300 group-hover/stop:rotate-90" />
            </button>
        );
    }

    if (historicalSessionId) {
        return (
            <button
                type="button"
                onClick={handleReplay}
                className={`group/replay flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-black shadow-lg transition-all active:scale-95 ${isDarkMode
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-indigo-500/10'
                    : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                    }`}>
                <span className="uppercase tracking-tight">Replay</span>
                <BsArrowRepeat size={16} className="transition-transform duration-500 group-hover/replay:rotate-180" />
            </button>
        );
    }

    return (
        <button
            type="submit"
            disabled={isSendButtonDisabled}
            className={`group/send relative flex items-center gap-3 overflow-hidden rounded-xl px-6 py-2.5 text-[13px] font-black uppercase tracking-widest shadow-2xl transition-all duration-500 ${isSendButtonDisabled
                ? (isDarkMode ? 'bg-white/5 text-slate-600' : 'bg-slate-100 text-slate-400')
                : 'bg-gradient-to-br from-cyan-500 via-indigo-500 to-indigo-600 text-white hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(34,211,238,0.4)] active:translate-y-0 active:scale-95'
                }`}
            style={{ fontFamily: "'Outfit', sans-serif" }}>
            <span className="relative z-10 transition-colors duration-300">Run task</span>
            <BsSendFill
                size={14}
                className={`relative z-10 transition-all duration-500 ${!isSendButtonDisabled ? 'group-hover/send:-translate-y-1 group-hover/send:translate-x-1 group-hover/send:scale-110' : ''}`}
            />
            {!isSendButtonDisabled && (
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover/send:translate-x-full" />
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
        <div className="mt-4 flex items-center justify-center gap-3 opacity-70 transition-opacity duration-500 hover:opacity-100">
            <div className="flex items-center gap-1.5 opacity-100 grayscale-0 transition-all duration-500">
                <span className={`flex h-[20px] min-w-[20px] items-center justify-center rounded-md border px-1 font-mono text-[10px] font-black shadow-sm ${isDarkMode ? 'border-white/20 bg-white/10 text-slate-300' : 'border-slate-300 bg-white text-slate-600'}`}>⌘</span>
                <span className={`flex h-[20px] items-center justify-center rounded-md border px-2 font-mono text-[10px] font-black shadow-sm ${isDarkMode ? 'border-white/20 bg-white/10 text-slate-300' : 'border-slate-300 bg-white text-slate-600'}`}>ENTER</span>
            </div>
            <span className={`font-outfit text-[10px] font-black uppercase tracking-[0.2em] ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Search, extract, automate</span>
        </div>
    );
};

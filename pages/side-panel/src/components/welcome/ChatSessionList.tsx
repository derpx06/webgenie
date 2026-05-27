import React from 'react';
import { FaHistory, FaArrowRight } from 'react-icons/fa';
import type { ChatSessionMetadata } from '@extension/storage';

interface ChatSessionListProps {
    sessions: ChatSessionMetadata[];
    isDarkMode: boolean;
    onSelectPrompt: (text: string) => void;
}

export const ChatSessionList: React.FC<ChatSessionListProps> = ({ sessions, isDarkMode, onSelectPrompt }) => {
    return (
        <div className="w-full">
            <div className="mb-4 flex items-center gap-3 px-1">
                <h3 className={`text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-indigo-300/85' : 'text-indigo-700/80'}`}>
                    Recent Activity
                </h3>
                <div className={`h-px grow opacity-5 ${isDarkMode ? 'bg-white' : 'bg-slate-900'}`} />
            </div>

            <div className="grid grid-cols-1 gap-2">
                {sessions.map((session, idx) => (
                    <button
                        key={session.id || idx}
                        onClick={() => onSelectPrompt(session.title)}
                        className={`group relative flex items-center gap-4 overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 ${
                            isDarkMode
                                ? 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.05]'
                                : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-sm'
                        }`}
                    >
                        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                            isDarkMode
                                ? 'border-indigo-500/10 bg-indigo-500/5 text-indigo-400'
                                : 'border-indigo-100 bg-indigo-50 text-indigo-600'
                        }`}>
                            <div className="text-sm"><FaHistory /></div>
                        </div>

                        <div className="flex-1 overflow-hidden">
                            <h4 className={`mb-0.5 font-sans text-[14px] font-bold tracking-tight ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                {session.title}
                            </h4>
                            <p className={`text-[11px] font-normal leading-relaxed ${isDarkMode ? 'text-slate-300/80' : 'text-slate-600/80'}`}>
                                {new Date(session.createdAt).toLocaleDateString()}
                            </p>
                        </div>

                        <div className={`flex size-7 shrink-0 -translate-x-2 items-center justify-center rounded-full border opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 ${
                            isDarkMode ? 'border-white/5 bg-white/5 text-slate-400' : 'border-indigo-100 bg-indigo-50 text-indigo-600'
                        }`}>
                            <FaArrowRight size={10} />
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};

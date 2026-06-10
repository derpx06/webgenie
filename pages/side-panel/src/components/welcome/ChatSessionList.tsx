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
                <h3 className={`text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-indigo-300/80' : 'text-indigo-700/85'}`}>
                    Recent Activity
                </h3>
                <div className={`h-px grow opacity-10 ${isDarkMode ? 'bg-indigo-500/35' : 'bg-indigo-600/20'}`} />
            </div>

            <div className="grid grid-cols-1 gap-3">
                {sessions.map((session, idx) => (
                    <button
                        key={session.id || idx}
                        onClick={() => onSelectPrompt(session.title)}
                        className={`premium-history-item group flex items-center gap-4 overflow-hidden rounded-xl p-3.5 transition-all duration-300`}
                    >
                        {/* Glow effect on hover */}
                        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-indigo-500/0 via-indigo-500/0 to-indigo-500/0 opacity-0 transition-opacity duration-500 group-hover:from-indigo-500/[0.02] group-hover:to-cyan-500/[0.02] group-hover:opacity-100" />

                        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 group-hover:scale-105 ${
                            isDarkMode
                                ? 'border-indigo-500/15 bg-indigo-500/10 text-indigo-300 group-hover:border-indigo-500/35 group-hover:bg-indigo-500/15 group-hover:text-indigo-200'
                                : 'border-indigo-100 bg-indigo-50/70 text-indigo-600 group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-700'
                        }`}>
                            <div className="text-sm transition-transform duration-300 group-hover:rotate-6"><FaHistory /></div>
                        </div>

                        <div className="flex-1 overflow-hidden">
                            <h4 className={`mb-0.5 truncate font-sans text-[13px] font-bold tracking-tight ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                {session.title}
                            </h4>
                            <p className={`text-[11px] font-normal leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                                {new Date(session.createdAt).toLocaleDateString()}
                            </p>
                        </div>

                        <div className={`flex size-6 shrink-0 -translate-x-2 items-center justify-center rounded-full border opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 ${
                            isDarkMode 
                                ? 'border-white/10 bg-white/5 text-slate-300' 
                                : 'border-indigo-100 bg-indigo-50/80 text-indigo-600'
                        }`}>
                            <FaArrowRight size={8} />
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};

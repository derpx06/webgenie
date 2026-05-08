import React from 'react';
import { OrbVisual } from './welcome/OrbVisual';
import { FaTerminal, FaSearch, FaShoppingBag, FaArrowRight, FaHistory } from 'react-icons/fa';
import type { ChatSessionMetadata } from '@extension/storage';

interface EmptyChatProps {
    onSelectPrompt: (text: string) => void;
    isDarkMode: boolean;
    recentSessions?: ChatSessionMetadata[];
    children?: React.ReactNode;
}

const EmptyChat: React.FC<EmptyChatProps> = ({ onSelectPrompt, isDarkMode, recentSessions = [], children }) => {
    const workflows = [
        {
            title: 'Market Intelligence',
            desc: 'Autonomous deep research across websites, documents, and live sources.',
            prompt: 'Research the latest funding rounds and hiring trends for AI startups in San Francisco',
            icon: <FaSearch />,
            accent: 'indigo'
        },
        {
            title: 'Task Automation',
            desc: 'Execute multi-step browser actions with intelligent decision making.',
            prompt: 'Search across major tech news sites and summarize the latest advancements in browser-based AI agents',
            icon: <FaTerminal />,
            accent: 'indigo'
        },
        {
            title: 'Inventory Analysis',
            desc: 'Track products, pricing, inventory, and market signals in real time.',
            prompt: 'Compare pricing and availability for the RTX 4090 across major electronics retailers',
            icon: <FaShoppingBag />,
            accent: 'indigo'
        },
    ];

    return (
        <div className={`relative w-full flex-1 overflow-hidden transition-colors duration-500 ${isDarkMode ? 'bg-slate-950' : 'bg-slate-50'}`}>
            {/* Minimal Background Infrastructure */}
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-50">
                <div className={`absolute left-[-10%] top-[-10%] size-3/5 rounded-full blur-[120px] ${isDarkMode ? 'bg-indigo-500/5' : 'bg-indigo-500/[0.02]'}`}></div>
                <div className={`absolute bottom-[-10%] right-[-10%] size-3/5 rounded-full blur-[120px] ${isDarkMode ? 'bg-slate-500/5' : 'bg-slate-500/[0.02]'}`}></div>
            </div>

            <div className={`relative z-10 flex h-full flex-col justify-start overflow-y-auto px-6 pb-8 pt-4 ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                <div className="mx-auto w-full max-w-xl">
                    <div className="relative mb-4 flex flex-col items-center text-center">
                        <div className="relative mb-3 opacity-95 transition-all duration-700">
                            <OrbVisual isDarkMode={isDarkMode} />
                        </div>

                        <div className="space-y-2 px-4">
                            <h1 className={`text-5xl font-black leading-none -tracking-wider transition-all duration-700 ${isDarkMode
                                ? 'bg-gradient-to-b from-white via-white to-white/40 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]'
                                : 'bg-gradient-to-b from-slate-900 via-slate-800 to-slate-500 bg-clip-text text-transparent'
                                }`}>
                                WebGenie
                            </h1>
                            <p className={`mx-auto max-w-[340px] px-2 font-sans text-[14px] font-medium leading-relaxed tracking-tight ${isDarkMode ? 'text-slate-500/80' : 'text-slate-400'}`}>
                                Professional-grade autonomous intelligence for <br />
                                <span className={isDarkMode ? 'text-indigo-400/60' : 'text-indigo-600/60'}>web research and multi-step task execution.</span>
                            </p>
                        </div>
                    </div>

                    <div className="mb-6 w-full">
                        {children}
                    </div>

                    {recentSessions.length > 0 ? (
                        <div className="w-full">
                            <div className="mb-4 flex items-center gap-3 px-1">
                                <h3 className={`text-[9px] font-bold uppercase tracking-wider opacity-30 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                                    Recent Activity
                                </h3>
                                <div className={`h-px grow opacity-5 ${isDarkMode ? 'bg-white' : 'bg-slate-900'}`} />
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                {recentSessions.map((session, idx) => (
                                    <button
                                        key={session.id || idx}
                                        onClick={() => onSelectPrompt(session.title)}
                                        className={`group relative flex items-center gap-4 overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 ${isDarkMode
                                            ? 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.05]'
                                            : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-sm'
                                            }`}>

                                        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${isDarkMode
                                            ? 'border-indigo-500/10 bg-indigo-500/5 text-indigo-400'
                                            : 'border-indigo-100 bg-indigo-50 text-indigo-600'
                                            }`}>
                                            <div className="text-sm"><FaHistory /></div>
                                        </div>

                                        <div className="flex-1 overflow-hidden">
                                            <h4 className={`mb-0.5 font-sans text-[14px] font-bold tracking-tight ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                                {session.title}
                                            </h4>
                                            <p className={`text-[11px] font-normal leading-relaxed opacity-40 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                                                {new Date(session.createdAt).toLocaleDateString()}
                                            </p>
                                        </div>

                                        <div className={`flex size-7 shrink-0 -translate-x-2 items-center justify-center rounded-full border opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 ${isDarkMode ? 'border-white/5 bg-white/5 text-slate-400' : 'border-indigo-100 bg-indigo-50 text-indigo-600'}`}>
                                            <FaArrowRight size={10} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="w-full">
                            <div className="mb-4 flex items-center gap-3 px-1">
                                <h3 className={`text-[9px] font-bold uppercase tracking-wider opacity-30 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                                    System Capabilities
                                </h3>
                                <div className={`h-px grow opacity-5 ${isDarkMode ? 'bg-white' : 'bg-slate-900'}`} />
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                {workflows.map((item, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => onSelectPrompt(item.prompt)}
                                        className={`group relative flex items-center gap-4 overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 ${isDarkMode
                                            ? 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.05]'
                                            : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-sm'
                                            }`}>

                                        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${isDarkMode
                                            ? 'border-indigo-500/10 bg-indigo-500/5 text-indigo-400'
                                            : 'border-indigo-100 bg-indigo-50 text-indigo-600'
                                            }`}>
                                            <div className="text-sm">{item.icon}</div>
                                        </div>

                                        <div className="flex-1">
                                            <h4 className={`mb-0.5 font-sans text-[14px] font-bold tracking-tight ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                                {item.title}
                                            </h4>
                                            <p className={`text-[11px] font-normal leading-relaxed opacity-40 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                                                {item.desc}
                                            </p>
                                        </div>

                                        <div className={`flex size-7 shrink-0 -translate-x-2 items-center justify-center rounded-full border opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 ${isDarkMode ? 'border-white/5 bg-white/5 text-slate-400' : 'border-indigo-100 bg-indigo-50 text-indigo-600'}`}>
                                            <FaArrowRight size={10} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Operational Status */}
                    <div className="mt-6 flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2">
                            <div className="size-1.5 animate-pulse rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                            <span className={`text-[9px] font-bold uppercase tracking-widest opacity-30 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                                Runtime Operational
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmptyChat;

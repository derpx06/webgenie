import React from 'react';
import { FaTerminal, FaSearch, FaShoppingBag, FaArrowRight } from 'react-icons/fa';

interface WorkflowGalleryProps {
    isDarkMode: boolean;
    onSelectPrompt: (text: string) => void;
}

export const WorkflowGallery: React.FC<WorkflowGalleryProps> = ({ isDarkMode, onSelectPrompt }) => {
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
        }
    ];

    return (
        <div className="w-full">
            <div className="mb-4 flex items-center gap-3 px-1">
                <h3 className={`text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-indigo-300/80' : 'text-indigo-700/85'}`}>
                    Capabilities & Workflows
                </h3>
                <div className={`h-px grow opacity-10 ${isDarkMode ? 'bg-indigo-500/35' : 'bg-indigo-600/20'}`} />
            </div>

            <div className="grid grid-cols-1 gap-3">
                {workflows.map((item, idx) => (
                    <button
                        key={idx}
                        onClick={() => onSelectPrompt(item.prompt)}
                        className={`group relative flex items-center gap-4 overflow-hidden rounded-xl border p-3.5 text-left transition-all duration-300 ${
                            isDarkMode
                                ? 'border-white/[0.04] bg-slate-900/30 backdrop-blur-md hover:border-indigo-500/30 hover:bg-slate-900/50 hover:shadow-[0_8px_32px_rgba(99,102,241,0.08)] hover:-translate-y-0.5'
                                : 'border-slate-200/60 bg-white/60 backdrop-blur-md hover:border-indigo-300/60 hover:bg-white/80 hover:shadow-[0_8px_32px_rgba(99,102,241,0.04)] hover:-translate-y-0.5'
                        }`}
                        style={{
                            boxShadow: isDarkMode 
                                ? '0 4px 20px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.02)' 
                                : '0 4px 15px rgba(0,0,0,0.01), inset 0 1px 1px rgba(255,255,255,0.6)'
                        }}
                    >
                        {/* Glow effect on hover */}
                        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-indigo-500/0 via-indigo-500/0 to-indigo-500/0 opacity-0 transition-opacity duration-500 group-hover:from-indigo-500/[0.02] group-hover:to-cyan-500/[0.02] group-hover:opacity-100" />

                        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 group-hover:scale-105 ${
                            isDarkMode
                                ? 'border-indigo-500/15 bg-indigo-500/10 text-indigo-300 group-hover:border-indigo-500/35 group-hover:bg-indigo-500/15 group-hover:text-indigo-200'
                                : 'border-indigo-100 bg-indigo-50/70 text-indigo-600 group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-700'
                        }`}>
                            <div className="text-sm transition-transform duration-300 group-hover:rotate-6">{item.icon}</div>
                        </div>

                        <div className="flex-1">
                            <h4 className={`mb-0.5 font-sans text-[13px] font-bold tracking-tight ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                {item.title}
                            </h4>
                            <p className={`text-[11px] font-normal leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                                {item.desc}
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

import React from 'react';
import { OrbVisual } from './welcome/OrbVisual';
import { FaTerminal, FaSearch, FaShoppingBag, FaArrowRight } from 'react-icons/fa';

interface EmptyChatProps {
    onSelectPrompt: (text: string) => void;
    isDarkMode: boolean;
    children?: React.ReactNode;
}

const EmptyChat: React.FC<EmptyChatProps> = ({ onSelectPrompt, isDarkMode, children }) => {
    const workflows = [
        {
            title: 'Deep Intelligence',
            desc: 'Autonomous deep research across websites, documents, and live sources.',
            prompt: 'Research the latest funding rounds and hiring trends for AI startups in San Francisco',
            icon: <FaSearch />,
            color: 'from-cyan-500/20 to-blue-500/20',
            accent: 'cyan'
        },
        {
            title: 'Neural Automation',
            desc: 'Execute multi-step browser actions with intelligent decision making.',
            prompt: 'Search across major tech news sites and summarize the latest advancements in browser-based AI agents',
            icon: <FaTerminal />,
            color: 'from-violet-500/20 to-purple-500/20',
            accent: 'violet'
        },
        {
            title: 'Global Sourcing',
            desc: 'Track products, pricing, inventory, and market signals in real time.',
            prompt: 'Compare pricing and availability for the RTX 4090 across major electronics retailers',
            icon: <FaShoppingBag />,
            color: 'from-amber-500/20 to-orange-500/20',
            accent: 'amber'
        },
    ];

    const getAccentStyles = (accent: string, isDark: boolean) => {
        const styles = {
            cyan: isDark 
                ? 'hover:border-cyan-500/30 hover:shadow-[0_20px_40px_rgba(6,182,212,0.15)] group-hover/module:text-cyan-200' 
                : 'hover:border-cyan-300 hover:shadow-[0_15px_35px_rgba(6,182,212,0.1)] group-hover/module:text-cyan-600',
            violet: isDark 
                ? 'hover:border-violet-500/30 hover:shadow-[0_20px_40px_rgba(139,92,246,0.15)] group-hover/module:text-violet-200' 
                : 'hover:border-violet-300 hover:shadow-[0_15px_35px_rgba(139,92,246,0.15)] group-hover/module:text-violet-600',
            amber: isDark 
                ? 'hover:border-amber-500/30 hover:shadow-[0_20px_40px_rgba(245,158,11,0.15)] group-hover/module:text-amber-200' 
                : 'hover:border-amber-300 hover:shadow-[0_15px_35px_rgba(245,158,11,0.15)] group-hover/module:text-amber-600',
        };
        return styles[accent as keyof typeof styles] || '';
    };

    return (
        <div className={`relative flex-1 w-full overflow-hidden transition-colors duration-500 ${isDarkMode ? 'bg-[#020617]' : 'bg-[#fcfcff]'}`}>
            {/* 1. LIVING BACKGROUND SYSTEM */}
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                {/* Animated Radial Lighting */}
                <div className={`absolute -top-[10%] -left-[10%] size-[80%] rounded-full blur-[120px] animate-haze ${isDarkMode ? 'bg-indigo-500/10' : 'bg-indigo-500/[0.04]'}`}></div>
                <div className={`absolute -bottom-[10%] -right-[10%] size-[80%] rounded-full blur-[120px] animate-haze [animation-delay:4s] ${isDarkMode ? 'bg-cyan-500/10' : 'bg-violet-500/[0.04]'}`}></div>

                {/* Micro-Noise Texture */}
                <div className={`absolute inset-0 opacity-[0.04] mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] ${isDarkMode ? '' : 'invert opacity-[0.02]'}`}></div>

                {/* Subtle Grid / Neural Mesh Overlay */}
                <div className={`absolute inset-0 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:60px_60px] ${isDarkMode ? '' : 'invert opacity-[0.01]'}`}></div>

                {/* Floating Neural Particles */}
                {[...Array(12)].map((_, i) => (
                    <div
                        key={i}
                        className={`absolute size-1 rounded-full blur-[1px] animate-float ${isDarkMode ? 'bg-white/20' : 'bg-indigo-500/10'}`}
                        style={{
                            top: `${Math.random() * 100}%`,
                            left: `${Math.random() * 100}%`,
                            animationDelay: `${i * 0.8}s`,
                            animationDuration: `${10 + Math.random() * 10}s`
                        }}
                    />
                ))}
            </div>

            <div className={`relative z-10 flex h-full flex-col justify-center overflow-y-auto scrollbar-none px-6 py-12 ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                <div className="w-full max-w-xl mx-auto">
                    <div className="relative mb-8 flex flex-col items-center text-center">
                        <div className="relative mb-6 group scale-90">
                            <div className={`absolute inset-0 scale-150 rounded-full blur-[60px] animate-pulse-soft ${isDarkMode ? 'bg-indigo-500/10' : 'bg-indigo-500/5'}`}></div>
                            <OrbVisual isDarkMode={isDarkMode} />

                            <div className={`absolute inset-0 rounded-full border opacity-0 group-hover:opacity-100 transition-opacity duration-1000 scale-125 ${isDarkMode ? 'border-white/5' : 'border-indigo-500/10'}`}></div>
                        </div>

                        <div className="animate-rise space-y-3 px-4">
                            <h1 className={`font-outfit text-[38px] font-black leading-[1] tracking-[-0.04em] pb-1 ${isDarkMode ? 'bg-gradient-to-b from-white via-white to-white/30 bg-clip-text text-transparent' : 'text-slate-900'}`}>
                                Web Genie
                            </h1>
                            <p className={`max-w-[400px] text-[15px] font-semibold leading-relaxed tracking-wide ${isDarkMode ? 'text-slate-400 opacity-70' : 'text-slate-500 opacity-80'} font-outfit`}>
                                Agent online. <br /> Ready to navigate, research, and execute.
                            </p>
                        </div>
                    </div>

            <div className="mb-10 w-full animate-rise [animation-delay:200ms] relative">
                <div className={`absolute -inset-4 blur-2xl rounded-full pointer-events-none opacity-50 ${isDarkMode ? 'bg-indigo-500/5' : 'bg-indigo-500/[0.02]'}`}></div>
                {children}
            </div>

            <div className="w-full animate-rise [animation-delay:400ms]">
                <div className="mb-5 flex items-center justify-between px-1">
                    <h3 className={`font-outfit text-[10px] font-black uppercase tracking-[0.4em] ${isDarkMode ? 'text-indigo-400/30' : 'text-indigo-600/40'}`}>
                        Neural Modules
                    </h3>
                    <div className={`h-px flex-1 ml-6 ${isDarkMode ? 'bg-gradient-to-r from-indigo-500/20 to-transparent' : 'bg-gradient-to-r from-indigo-500/10 to-transparent'}`}></div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    {workflows.map((item, idx) => (
                        <button
                            key={idx}
                            onClick={() => onSelectPrompt(item.prompt)}
                            className={`group/module relative flex items-center gap-4 rounded-xl border p-3.5 text-left transition-all duration-700 backdrop-blur-3xl overflow-hidden ${
                                isDarkMode 
                                    ? `border-white/5 bg-slate-950/40 hover:bg-slate-900/60 ${getAccentStyles(item.accent, true)}` 
                                    : `border-slate-200/60 bg-white/70 hover:bg-white ${getAccentStyles(item.accent, false)}`
                            }`}>

                            <div className={`flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${item.color} border transition-all duration-700 group-hover/module:scale-110 group-hover/module:rotate-3 ${isDarkMode ? 'border-white/5 text-indigo-300 shadow-inner' : 'border-white text-indigo-600 shadow-sm'}`}>
                                <div className={`text-lg ${isDarkMode ? 'drop-shadow-glow' : ''}`}>{item.icon}</div>
                            </div>

                            <div className="flex-1">
                                <h4 className={`mb-0.5 font-outfit text-[14px] font-black tracking-tight transition-colors ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                                    {item.title}
                                </h4>
                                <p className={`text-[11px] font-semibold leading-[1.4] transition-opacity ${isDarkMode ? 'text-slate-400 opacity-60 group-hover/module:opacity-90' : 'text-slate-500 opacity-70 group-hover/module:opacity-100'}`}>
                                    {item.desc}
                                </p>
                            </div>

                            <div className={`flex size-8 items-center justify-center rounded-full text-indigo-400 opacity-0 transition-all duration-700 group-hover/module:opacity-100 group-hover/module:translate-x-0 -translate-x-3 border ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-indigo-50 border-indigo-100'}`}>
                                <FaArrowRight size={12} />
                            </div>

                            <div className={`absolute inset-0 -z-10 -translate-x-full group-hover/module:translate-x-full transition-transform duration-1000 ${isDarkMode ? 'bg-gradient-to-r from-transparent via-indigo-500/10 to-transparent' : 'bg-gradient-to-r from-transparent via-indigo-500/5 to-transparent'}`}></div>
                        </button>
                    ))}
                </div>
            </div>

            {/* 6. SYSTEM STATUS FOOTER */}
            <div className="mt-12 flex flex-col items-center gap-3 animate-fade-in [animation-delay:1s]">
                <div className="flex items-center gap-3">
                    <div className={`size-1 rounded-full animate-pulse ${isDarkMode ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,1)]' : 'bg-indigo-500 shadow-[0_0_8px_rgba(79,70,229,0.4)]'}`}></div>
                    <span className={`text-[9px] font-black uppercase tracking-[0.4em] ${isDarkMode ? 'text-slate-500/80' : 'text-slate-400'}`}>
                        Autonomous System Active
                    </span>
                </div>
                <div className={`h-[1px] w-16 rounded-full bg-gradient-to-r from-transparent via-white/5 to-transparent ${isDarkMode ? '' : 'invert opacity-20'}`}></div>
            </div>
                </div>
            </div>
        </div>
    );
};

export default EmptyChat;

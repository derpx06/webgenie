/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import React from 'react';
import type { TabTypes } from '../Options';
import { TABS } from '../Options';
import { FiSun, FiMoon } from 'react-icons/fi';

interface OptionsSidebarProps {
    activeTab: TabTypes;
    onTabClick: (tabId: TabTypes) => void;
    isDarkMode: boolean;
    onToggleDarkMode: () => void;
}

export const OptionsSidebar: React.FC<OptionsSidebarProps> = ({
    activeTab,
    onTabClick,
    isDarkMode,
    onToggleDarkMode
}) => {
    return (
        <aside className={`flex w-64 shrink-0 flex-col border-r backdrop-blur-2xl transition-all duration-500 ${isDarkMode ? 'border-white/5 bg-[#0f1117]/70 shadow-2xl' : 'border-slate-200 bg-white/80 shadow-xl'}`}>
            <div className="group flex cursor-pointer items-center gap-3 p-6 pb-4" onClick={() => window.open('https://webgenie.ai', '_blank')}>
                <div className={`flex size-9 items-center justify-center transition-all duration-700 group-hover:scale-110`}>
                    <img
                        src={chrome.runtime.getURL('webgenie-logo.png')}
                        alt="WebGenie"
                        className="size-8 object-contain drop-shadow-[0_0_8px_rgba(99,102,241,0.2)]"
                    />
                </div>
                <div className="flex flex-col">
                    <span className="font-outfit text-[16px] font-black uppercase tracking-tight">WebGenie</span>
                    <span className={`text-[8px] font-black uppercase tracking-[0.25em] opacity-50 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Operational UI</span>
                </div>
            </div>

            <nav className="scrollbar-none mt-2 flex-1 space-y-1 overflow-y-auto px-3">
                <div className={`px-4 py-2 text-[9px] font-black uppercase tracking-[0.2em] opacity-40 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>System Modules</div>
                {TABS.map(item => (
                    <button
                        key={item.id}
                        onClick={() => onTabClick(item.id)}
                        className={`group relative flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[12px] font-bold transition-all duration-300 ${activeTab === item.id
                            ? (isDarkMode ? 'bg-indigo-600/10 text-indigo-400 shadow-lg shadow-indigo-500/5 ring-1 ring-indigo-500/20' : 'bg-indigo-50 text-indigo-600 shadow-sm ring-1 ring-indigo-100')
                            : (isDarkMode ? 'text-slate-400 hover:bg-white/5 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900')
                            }`}
                    >
                        <item.icon size={16} className={`transition-transform duration-300 group-hover:scale-110 ${activeTab === item.id ? 'opacity-100' : 'opacity-60'}`} />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.id === 'firewall' && <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-tighter text-red-500">Secure</span>}
                        {activeTab === item.id && <div className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>}
                    </button>
                ))}
            </nav>

            <div className="mt-auto space-y-2 p-4">
                <button
                    onClick={onToggleDarkMode}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[11px] font-bold transition-all duration-300 ${isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                    {isDarkMode ? <FiSun size={12} /> : <FiMoon size={12} />}
                    <span>{isDarkMode ? 'Light Protocol' : 'Dark Protocol'}</span>
                </button>

                <div className={`rounded-xl border p-3 backdrop-blur-3xl ${isDarkMode ? 'border-white/5 bg-black/20' : 'border-slate-200 bg-white/50'}`}>
                    <div className="mb-1 flex items-center justify-between">
                        <div className="text-[9px] font-black uppercase tracking-widest opacity-30">v2.1.4</div>
                        <div className="size-1.5 animate-pulse rounded-full bg-emerald-500/50"></div>
                    </div>
                    <div className={`text-[8px] font-bold uppercase tracking-tighter opacity-20 ${isDarkMode ? 'text-white' : 'text-black'}`}>© 2026 Neural Runtime</div>
                </div>
            </div>
        </aside>
    );
};

export const OptionsBackground: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className={`absolute -left-[10%] -top-[10%] size-2/5 rounded-full opacity-20 blur-[120px] ${isDarkMode ? 'bg-indigo-600' : 'bg-indigo-300'}`}></div>
        <div className={`absolute -right-[5%] top-[40%] size-[35%] rounded-full opacity-15 blur-[100px] ${isDarkMode ? 'bg-violet-600' : 'bg-violet-300'}`}></div>
        <div className={`absolute -bottom-[5%] left-[20%] size-[30%] rounded-full opacity-10 blur-[90px] ${isDarkMode ? 'bg-emerald-500' : 'bg-emerald-200'}`}></div>
        <div className={`absolute inset-0 opacity-[0.02] ${isDarkMode ? 'invert' : ''}`} style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
    </div>
);

export const OptionsHeader: React.FC<{ title: string; isDarkMode: boolean }> = ({ title, isDarkMode }) => (
    <header className="mb-8 animate-[fadeIn_0.8s_ease-out]">
        <div className="mb-1 flex items-center gap-2">
            <div className="h-px w-6 bg-indigo-500"></div>
            <span className={`text-[10px] font-black uppercase tracking-[0.4em] ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>System Node</span>
        </div>
        <h1 className="font-outfit mb-2 text-4xl font-black uppercase leading-tight tracking-tighter">{title}</h1>
        <p className={`max-w-md text-[13px] font-medium leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'} opacity-60`}>
            Configure the autonomous runtime parameters and cognitive bio-feedback loops for this node.
        </p>
    </header>
);

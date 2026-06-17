/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import React, { useState, useEffect } from 'react';
import type { TabTypes } from '../Options';
import { TABS } from '../Options';
import { FiSun, FiMoon } from 'react-icons/fi';
import { firewallStore } from '@extension/storage';

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
    const [firewallStatus, setFirewallStatus] = useState<{ text: string; type: 'success' | 'caution' | 'neutral' }>({
        text: 'Active',
        type: 'success'
    });

    useEffect(() => {
        const updateStatus = async () => {
            try {
                const config = await firewallStore.getFirewall();
                if (!config.enabled) {
                    setFirewallStatus({ text: 'Inactive', type: 'neutral' });
                } else if (config.allowList.length === 0 && config.denyList.length === 0) {
                    setFirewallStatus({ text: 'Unrestricted', type: 'caution' });
                } else {
                    setFirewallStatus({ text: 'Active', type: 'success' });
                }
            } catch (e) {
                console.error('Failed to update sidebar firewall status', e);
            }
        };
        updateStatus();
        const unsub = firewallStore.subscribe(updateStatus);
        return () => unsub();
    }, []);

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
                        {item.id === 'firewall' && (
                            <span className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider transition-all ${
                                firewallStatus.type === 'success'
                                    ? 'border-[#2ED9A8]/20 bg-[#2ED9A8]/10 text-[#2ED9A8]'
                                    : firewallStatus.type === 'caution'
                                    ? 'border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#F59E0B]'
                                    : 'border-[#6B7280]/20 bg-[#6B7280]/10 text-[#6B7280]'
                            }`}>
                                {firewallStatus.text}
                            </span>
                        )}
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

                <a
                    href="https://github.com/derpx06/webgenie"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[11px] font-bold transition-all duration-300 ${isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                    <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="12" width="12">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    <span>GitHub Repository</span>
                </a>

                <div className={`rounded-xl border p-3 backdrop-blur-3xl ${isDarkMode ? 'border-white/5 bg-black/20' : 'border-slate-200 bg-white/50'}`}>
                    <div className="mb-1 flex items-center justify-between">
                        <div className="font-mono text-[9px] font-black uppercase tracking-widest opacity-30">v2.1.4</div>
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

export const OptionsHeader: React.FC<{ title: string; subtitle: string; isDarkMode: boolean }> = ({ title, subtitle, isDarkMode }) => (
    <header className="mb-8 animate-[fadeIn_0.8s_ease-out]">
        <div className="mb-1 flex items-center gap-2">
            <div className="h-px w-6 bg-indigo-500"></div>
            <span className={`text-[10px] font-black uppercase tracking-[0.4em] ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>System Node</span>
        </div>
        <h1 className="font-outfit mb-2 text-4xl font-black uppercase leading-tight tracking-tighter">{title}</h1>
        <p className={`max-w-md text-[13px] font-medium leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'} opacity-60`}>
            {subtitle}
        </p>
    </header>
);

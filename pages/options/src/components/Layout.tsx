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
        <aside className={`flex w-16 shrink-0 flex-col border-r transition-colors duration-300 md:w-64 ${isDarkMode ? 'border-white/5 bg-[#0f1117]' : 'border-slate-200 bg-white'}`}>
            <div className="group flex cursor-pointer items-center justify-center gap-3 p-3 md:justify-start md:p-6 md:pb-4" onClick={() => window.open('https://github.com/derpx06/webgenie', '_blank')}>
                <div className={`flex size-9 items-center justify-center transition-all duration-700 group-hover:scale-110`}>
                    <img
                        src={chrome.runtime.getURL('webgenie-logo.png')}
                        alt="WebGenie"
                        className="size-8 object-contain drop-shadow-[0_0_8px_rgba(99,102,241,0.2)]"
                    />
                </div>
                <div className="flex flex-col max-md:hidden">
                    <span className="text-[15px] font-semibold tracking-tight">WebGenie</span>
                </div>
            </div>

            <nav className="scrollbar-none mt-2 flex-1 space-y-1 overflow-y-auto px-3">
                {TABS.map(item => (
                    <button
                        key={item.id}
                        onClick={() => onTabClick(item.id)}
                        title={item.label}
                        aria-label={item.label}
                        className={`group relative flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[12px] font-semibold transition-all duration-300 max-md:justify-center max-md:px-0 ${activeTab === item.id
                            ? (isDarkMode ? 'bg-indigo-600/10 text-indigo-400 shadow-lg shadow-indigo-500/5 ring-1 ring-indigo-500/20' : 'bg-indigo-50 text-indigo-600 shadow-sm ring-1 ring-indigo-100')
                            : (isDarkMode ? 'text-slate-400 hover:bg-white/5 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900')
                            }`}
                    >
                        <item.icon size={16} className={`transition-transform duration-300 group-hover:scale-110 ${activeTab === item.id ? 'opacity-100' : 'opacity-60'}`} />
                        <span className="flex-1 text-left max-md:hidden">{item.label}</span>
                        {item.id === 'firewall' && (
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-all max-md:hidden ${
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

            <div className="mt-auto space-y-2 p-2 md:p-4">
                <button
                    onClick={onToggleDarkMode}
                    aria-label={isDarkMode ? 'Light mode' : 'Dark mode'}
                    title={isDarkMode ? 'Light mode' : 'Dark mode'}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[11px] font-semibold transition-all duration-300 max-md:justify-center max-md:px-0 ${isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                    {isDarkMode ? <FiSun size={12} /> : <FiMoon size={12} />}
                    <span className="max-md:hidden">{isDarkMode ? 'Light mode' : 'Dark mode'}</span>
                </button>

                <a
                    href="https://github.com/derpx06/webgenie"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="GitHub repository"
                    title="GitHub repository"
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[11px] font-semibold transition-all duration-300 max-md:justify-center max-md:px-0 ${isDarkMode ? 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                    <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="12" width="12">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    <span className="max-md:hidden">GitHub Repository</span>
                </a>

                <div className="px-2 pt-1 font-mono text-[11px] opacity-60 max-md:hidden">v{chrome.runtime.getManifest().version}</div>
            </div>
        </aside>
    );
};

export const OptionsBackground: React.FC<{ isDarkMode: boolean }> = () => null; // kept so callers need not change

export const OptionsHeader: React.FC<{ title: string; subtitle: string; isDarkMode: boolean }> = ({ title, subtitle, isDarkMode }) => (
    <header className="mb-8">
        <h1 className="mb-1.5 text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        <p className={`max-w-xl text-sm leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{subtitle}</p>
    </header>
);

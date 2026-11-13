import React, { useEffect, useState, useRef } from 'react';
import { FaGlobe, FaWindowMaximize } from 'react-icons/fa';

export interface Tab {
    id?: number;
    title?: string;
    url?: string;
    favIconUrl?: string;
}

interface TabMentionsDropdownProps {
    searchQuery: string;
    onSelect: (tab: Tab) => void;
    onClose: () => void;
    isDarkMode?: boolean;
}

export const TabMentionsDropdown: React.FC<TabMentionsDropdownProps> = ({
    searchQuery,
    onSelect,
    onClose,
    isDarkMode = false,
}) => {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [filteredTabs, setFilteredTabs] = useState<Tab[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Fetch all open tabs using chrome.tabs API
        if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.query({}, (allTabs) => {
                setTabs(allTabs);
                setFilteredTabs(allTabs);
            });
        } else {
            // Mock for development if needed
            const mockTabs = [
                { id: 1, title: 'Google', url: 'https://google.com' },
                { id: 2, title: 'GitHub', url: 'https://github.com' },
            ];
            setTabs(mockTabs);
            setFilteredTabs(mockTabs);
        }
    }, []);

    useEffect(() => {
        const filtered = tabs.filter((tab) => {
            const titleMatch = tab.title?.toLowerCase().includes(searchQuery.toLowerCase());
            const urlMatch = tab.url?.toLowerCase().includes(searchQuery.toLowerCase());
            return titleMatch || urlMatch;
        });
        setFilteredTabs(filtered);
        setSelectedIndex(0);
    }, [searchQuery, tabs]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % filteredTabs.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + filteredTabs.length) % filteredTabs.length);
            } else if (e.key === 'Enter') {
                if (filteredTabs[selectedIndex]) {
                    e.preventDefault();
                    onSelect(filteredTabs[selectedIndex]);
                }
            } else if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [filteredTabs, selectedIndex, onSelect, onClose]);

    if (filteredTabs.length === 0) return null;

    return (
        <div
            ref={dropdownRef}
            className={`animate-in fade-in slide-in-from-bottom-2 absolute bottom-full left-0 mb-3 max-h-64 w-72 overflow-y-auto rounded-2xl border p-2 shadow-2xl backdrop-blur-3xl transition-all duration-300 ${isDarkMode
                ? 'border-white/10 bg-slate-900/90 text-white'
                : 'border-slate-200 bg-white/90 text-slate-900'
                } theme-scrollbar z-[100]`}
        >
            <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Mention Tab
            </div>
            <div className="mt-1 space-y-0.5">
                {filteredTabs.map((tab, index) => (
                    <button
                        key={tab.id}
                        onClick={() => onSelect(tab)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${index === selectedIndex
                            ? isDarkMode ? 'bg-indigo-500/30 text-white shadow-lg shadow-indigo-500/10' : 'bg-indigo-50 text-indigo-700'
                            : 'hover:bg-slate-400/5'
                            }`}
                    >
                        <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}>
                            {tab.favIconUrl ? (
                                <img src={tab.favIconUrl} className="size-4" alt="" />
                            ) : (
                                <FaGlobe size={14} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'} />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-bold leading-tight">{tab.title}</div>
                            <div className={`mt-0.5 truncate text-[11px] opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{tab.url}</div>
                        </div>
                        {index === selectedIndex && (
                            <FaWindowMaximize size={12} className="text-white/40" />
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};

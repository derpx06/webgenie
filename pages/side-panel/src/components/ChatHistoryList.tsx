import React, { useState, useMemo } from 'react';
import { FaTrash, FaSearch, FaTerminal, FaRegClock } from 'react-icons/fa';
import { BsBookmark, BsChatSquareDotsFill, BsLightningChargeFill, BsLayersHalf } from 'react-icons/bs';
import { t } from '@extension/i18n';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messageCount?: number;
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  visible: boolean;
  isDarkMode?: boolean;
}

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  visible,
  isDarkMode = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!visible) return null;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getTimeAgo = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return formatDate(timestamp);
  };

  const filteredSessions = useMemo(() => 
    sessions.filter(session =>
      (session.title || 'Untitled Session').toLowerCase().includes(searchQuery.toLowerCase())
    ), [sessions, searchQuery]
  );

  const groupedSessions = useMemo(() => 
    filteredSessions.reduce((acc, session) => {
      const date = new Date(session.createdAt);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let group = '';
      if (date.toDateString() === today.toDateString()) {
        group = 'Live Channels';
      } else if (date.toDateString() === yesterday.toDateString()) {
        group = 'Yesterday';
      } else {
        group = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
      }

      if (!acc[group]) acc[group] = [];
      acc[group].push(session);
      return acc;
    }, {} as Record<string, ChatSession[]>), [filteredSessions]
  );

  const getIconColor = (title: string, isDark: boolean) => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorsDark = [
      'from-blue-500/20 to-indigo-500/20 text-blue-400 border-blue-500/20',
      'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/20',
      'from-rose-500/20 to-pink-500/20 text-rose-400 border-rose-500/20',
      'from-purple-500/20 to-violet-500/20 text-purple-400 border-purple-500/20',
      'from-amber-500/20 to-orange-500/20 text-amber-400 border-amber-500/20'
    ];
    return colorsDark[Math.abs(hash) % colorsDark.length];
  };

  return (
    <div className="flex h-full flex-col overflow-hidden pb-4">
      {/* Search and Command Area */}
      <div className={`sticky top-0 z-10 px-4 pb-4 pt-6 transition-all duration-500 ${
        isDarkMode ? 'bg-transparent' : 'bg-transparent'
      }`}>
        <div className="mb-6 flex items-center justify-between px-1">
          <div className="flex flex-col">
            <h2 className={`font-outfit text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              Session Index
            </h2>
            <p className={`text-[10px] font-bold uppercase tracking-[0.2em] opacity-40 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              Neural Command Center
            </p>
          </div>
          <div className={`flex size-10 items-center justify-center rounded-2xl border transition-all ${
            isDarkMode ? 'border-white/5 bg-white/5 text-indigo-400' : 'border-slate-200 bg-white text-indigo-600 shadow-sm'
          }`}>
            <BsLayersHalf size={18} />
          </div>
        </div>

        {/* Command Search Hybrid */}
        <div className="group relative">
          <div className={`absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-0 blur transition duration-500 group-focus-within:opacity-20 group-hover:opacity-15`} />
          <div className={`relative flex items-center rounded-2xl border transition-all duration-300 ${
            isDarkMode 
              ? 'border-white/5 bg-white/5 backdrop-blur-2xl focus-within:border-indigo-500/30 focus-within:bg-white/10' 
              : 'border-slate-200 bg-white/80 backdrop-blur-2xl focus-within:border-indigo-300 focus-within:shadow-xl'
          }`}>
            <div className={`flex shrink-0 items-center pl-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              <FaTerminal size={12} className="opacity-50" />
            </div>
            <input
              type="text"
              className={`block w-full border-0 bg-transparent py-3.5 pl-3 pr-4 text-sm font-semibold tracking-wide transition-all focus:ring-0 ${
                isDarkMode ? 'text-white placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'
              }`}
              placeholder="Search sessions, objectives, or commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className={`mr-3 hidden items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-black tracking-widest sm:flex ${
              isDarkMode ? 'border-white/10 bg-white/5 text-slate-500' : 'border-slate-100 bg-slate-50 text-slate-400'
            }`}>
              <span className="opacity-60">CTRL</span>
              <span className="opacity-60">K</span>
            </div>
          </div>
        </div>
      </div>

      <div className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700 mt-2 flex-1 overflow-y-auto px-4 pb-20">
        {filteredSessions.length === 0 ? (
          <div className="mt-12 flex flex-col items-center justify-center text-center">
            <div className={`mb-6 flex size-20 items-center justify-center rounded-[2rem] border transition-all ${
              isDarkMode ? 'border-white/5 bg-white/5 text-slate-600' : 'border-slate-100 bg-slate-50 text-slate-300 shadow-inner'
            }`}>
              <FaSearch size={32} />
            </div>
            <p className={`text-lg font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              No neural traces found
            </p>
            <p className={`mt-2 max-w-[200px] text-xs font-medium leading-relaxed opacity-40 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              {searchQuery ? "Your search parameters did not yield any active sessions." : "Initialise your first session to begin your journey."}
            </p>
          </div>
        ) : (
          <div className="space-y-10 pb-6 pt-2">
            {Object.entries(groupedSessions).map(([group, groupSessions]) => (
              <div key={group}>
                <div className="mb-4 flex items-center justify-between px-1">
                  <span className={`text-[10px] font-black uppercase tracking-[0.25em] ${isDarkMode ? 'text-indigo-400/80' : 'text-indigo-600/80'}`}>
                    {group}
                  </span>
                  <div className={`h-px grow ml-4 opacity-10 ${isDarkMode ? 'bg-white' : 'bg-slate-900'}`} />
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {groupSessions.map((session, sIdx) => {
                    const isComplex = session.title && session.title.length > 25;
                    const sessionColor = getIconColor(session.title, isDarkMode);
                    
                    return (
                      <div
                        key={session.id}
                        className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-[1.5rem] border transition-all duration-500 hover:shadow-2xl ${
                          isDarkMode 
                            ? 'border-white/5 bg-white/5 hover:border-white/10 hover:bg-white/[0.07]' 
                            : 'border-slate-200/60 bg-white/50 hover:border-indigo-200 hover:bg-white hover:shadow-indigo-500/5'
                        }`}
                        onClick={() => onSessionSelect(session.id)}
                      >
                        {/* Directional Light Hover Effect */}
                        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent" />
                        
                        <div className="flex items-center gap-4 p-4">
                          <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br shadow-sm transition-transform duration-500 group-hover:scale-110 ${sessionColor}`}>
                            <BsChatSquareDotsFill size={20} className="transition-transform group-hover:rotate-12" />
                          </div>

                          <div className="grow overflow-hidden">
                            <h3 className={`truncate font-outfit text-[14px] font-black tracking-tight ${
                              isDarkMode ? 'text-white' : 'text-slate-900'
                            } transition-colors group-hover:text-indigo-500`}>
                              {session.title || 'Untitled Protocol'}
                            </h3>
                            <div className="mt-1 flex items-center gap-3">
                              <span className={`flex items-center gap-1.5 text-[10px] font-bold ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                <FaRegClock size={10} className="opacity-50" />
                                {getTimeAgo(session.createdAt)}
                              </span>
                              {session.messageCount && (
                                <span className={`flex items-center gap-1.5 text-[10px] font-bold ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                                  <BsLightningChargeFill size={10} />
                                  {session.messageCount} ops
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 translate-x-2 items-center gap-1 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
                            {onSessionBookmark && (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  onSessionBookmark(session.id);
                                }}
                                className={`rounded-xl p-2.5 transition-all ${
                                  isDarkMode
                                    ? 'text-slate-400 hover:bg-white/5 hover:text-sky-400'
                                    : 'text-slate-400 hover:bg-indigo-50 hover:text-sky-500'
                                }`}
                                type="button">
                                <BsBookmark size={14} />
                              </button>
                            )}

                            <button
                              onClick={e => {
                                e.stopPropagation();
                                onSessionDelete(session.id);
                              }}
                              className={`rounded-xl p-2.5 transition-all ${
                                isDarkMode
                                  ? 'text-slate-400 hover:bg-white/5 hover:text-red-400'
                                  : 'text-slate-400 hover:bg-red-50 hover:text-red-500'
                              }`}
                              type="button">
                              <FaTrash size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Execution Summary for complex tasks */}
                        {isComplex && (
                          <div className={`mt-0.5 px-4 pb-4 transition-all duration-500 ${isDarkMode ? 'opacity-40' : 'opacity-60'}`}>
                            <div className={`rounded-xl px-3 py-2 text-[11px] font-medium italic leading-relaxed ${
                              isDarkMode ? 'bg-black/20 text-slate-400' : 'bg-slate-50 text-slate-500'
                            }`}>
                              "Agent successfully analyzed market trends and generated a comparative report across 12 sectors..."
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHistoryList;

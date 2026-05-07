import React, { useState, useMemo } from 'react';
import { FaTrash, FaSearch, FaTerminal, FaRegClock } from 'react-icons/fa';
import { BsBookmark, BsChatSquareDotsFill, BsLightningChargeFill, BsLayersHalf } from 'react-icons/bs';

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
        group = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        group = 'Yesterday';
      } else {
        group = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      }

      if (!acc[group]) acc[group] = [];
      acc[group].push(session);
      return acc;
    }, {} as Record<string, ChatSession[]>), [filteredSessions]
  );

  if (!visible) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden pb-4">
      {/* Search and Header Area */}
      <div className="sticky top-0 z-10 px-5 pb-4 pt-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className={`font-outfit text-xl font-bold tracking-tight ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
              History
            </h2>
            <p className={`text-[10px] font-bold uppercase tracking-wider opacity-40 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Workspace Sessions
            </p>
          </div>
          <div className={`flex size-9 items-center justify-center rounded-xl border transition-all ${
            isDarkMode ? 'border-white/5 bg-white/5 text-indigo-400' : 'border-slate-200 bg-white text-indigo-600 shadow-sm'
          }`}>
            <BsLayersHalf size={16} />
          </div>
        </div>

        {/* Command Search Bar */}
        <div className="group relative">
          <div className={`relative flex items-center rounded-xl border transition-all duration-300 ${
            isDarkMode 
              ? 'border-white/5 bg-white/[0.03] backdrop-blur-md focus-within:border-indigo-500/40 focus-within:bg-white/[0.08] focus-within:shadow-[0_0_20px_rgba(99,102,241,0.1)]' 
              : 'border-slate-200/60 bg-white/60 backdrop-blur-md focus-within:border-indigo-300 focus-within:bg-white focus-within:shadow-md'
          }`}>
            <div className={`flex shrink-0 items-center pl-3.5 transition-colors duration-300 ${isDarkMode ? 'text-slate-600 group-focus-within:text-indigo-400' : 'text-slate-400 group-focus-within:text-indigo-500'}`}>
              <FaTerminal size={11} className="opacity-60" />
            </div>
            <input
              type="text"
              className={`block w-full border-0 bg-transparent py-2.5 pl-3 pr-4 text-[13px] font-semibold tracking-tight transition-all focus:outline-none focus:ring-0 ${
                isDarkMode ? 'text-slate-200 placeholder:text-slate-700' : 'text-slate-900 placeholder:text-slate-400'
              }`}
              placeholder="Search sessions or commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="scrollbar-thin mt-2 flex-1 overflow-y-auto px-5 pb-20">
        {filteredSessions.length === 0 ? (
          <div className="mt-16 flex flex-col items-center justify-center text-center">
            <div className={`mb-4 flex size-14 items-center justify-center rounded-2xl border ${
              isDarkMode ? 'border-white/5 bg-white/5 text-slate-700' : 'border-slate-100 bg-slate-50 text-slate-300'
            }`}>
              <FaSearch size={20} />
            </div>
            <p className={`text-sm font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
              No sessions found
            </p>
            <p className={`mt-1 max-w-[180px] text-[11px] font-medium leading-relaxed opacity-40 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              {searchQuery ? "No matches for your current search filter." : "Your session history will appear here."}
            </p>
          </div>
        ) : (
          <div className="space-y-8 pt-2">
            {Object.entries(groupedSessions).map(([group, groupSessions]) => (
              <div key={group}>
                <div className="mb-3 flex items-center gap-3 px-1">
                  <span className={`text-[9px] font-bold uppercase tracking-wider opacity-40 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                    {group}
                  </span>
                  <div className={`h-px grow opacity-5 ${isDarkMode ? 'bg-white' : 'bg-slate-900'}`} />
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {groupSessions.map((session, index) => (
                    <div
                      key={session.id}
                      style={{ animationDelay: `${index * 50}ms` }}
                      className={`animate-in fade-in slide-in-from-bottom-4 fill-mode-both group relative flex cursor-pointer items-center gap-3.5 rounded-xl border p-3.5 transition-all duration-300 ${
                        isDarkMode 
                          ? 'border-white/10 bg-white/[0.04] backdrop-blur-md hover:-translate-y-px hover:border-indigo-500/30 hover:bg-white/[0.08] hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)]' 
                          : 'border-slate-200/60 bg-white/70 backdrop-blur-md hover:-translate-y-px hover:border-indigo-200 hover:bg-white hover:shadow-[0_4px_20px_rgba(0,0,0,0.03)]'
                      }`}
                      onClick={() => onSessionSelect(session.id)}
                    >
                      {/* Active Indicator Glow */}
                      <div className={`absolute -left-px top-1/2 h-8 w-[2px] -translate-y-1/2 rounded-full opacity-0 transition-all duration-300 group-hover:opacity-100 ${
                        isDarkMode ? 'bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)]' : 'bg-indigo-600'
                      }`} />

                      <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg border transition-all duration-500 group-hover:rotate-3 group-hover:scale-110 ${
                        isDarkMode 
                          ? 'border-indigo-500/10 bg-indigo-500/10 text-indigo-400 group-hover:border-indigo-500/30 group-hover:bg-indigo-500/20' 
                          : 'border-indigo-100 bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100'
                      }`}>
                        <BsChatSquareDotsFill size={16} className="transition-transform group-hover:scale-110" />
                      </div>

                      <div className="grow overflow-hidden">
                        <h3 className={`truncate font-outfit text-[13px] font-bold tracking-tight transition-colors duration-300 ${
                          isDarkMode ? 'text-slate-200' : 'text-slate-900'
                        } group-hover:text-white`}>
                          {session.title || 'Untitled Session'}
                        </h3>
                        <div className="mt-1 flex items-center gap-3">
                          <span className={`flex items-center gap-1.5 text-[10px] font-semibold transition-colors duration-300 ${isDarkMode ? 'text-slate-500 group-hover:text-slate-400' : 'text-slate-400'}`}>
                            <FaRegClock size={9} className="opacity-60" />
                            {getTimeAgo(session.createdAt)}
                          </span>
                          {session.messageCount && (
                            <span className={`flex items-center gap-1.5 text-[10px] font-black transition-all duration-300 ${isDarkMode ? 'text-slate-600 group-hover:text-indigo-400/80' : 'text-slate-500'}`}>
                              <BsLightningChargeFill size={9} className="animate-pulse text-indigo-500" />
                              {session.messageCount} <span className="opacity-50">tokens</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 translate-x-2 items-center gap-0.5 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
                        {onSessionBookmark && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onSessionBookmark(session.id);
                            }}
                            className={`rounded-lg p-2 transition-all duration-200 ${
                              isDarkMode
                                ? 'text-slate-500 hover:bg-white/10 hover:text-indigo-400'
                                : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'
                            }`}
                            title="Bookmark session"
                            type="button">
                            <BsBookmark size={12} />
                          </button>
                        )}

                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onSessionDelete(session.id);
                          }}
                          className={`rounded-lg p-2 transition-all duration-200 ${
                            isDarkMode
                              ? 'text-slate-500 hover:bg-rose-500/15 hover:text-rose-400'
                              : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'
                          }`}
                          title="Delete session"
                          type="button">
                          <FaTrash size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
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

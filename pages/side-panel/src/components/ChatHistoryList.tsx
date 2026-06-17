import React, { useState, useMemo, useEffect } from 'react';
import { FaTrash, FaRegClock } from 'react-icons/fa';
import { BsBookmark, BsChatSquareDotsFill, BsLightningChargeFill } from 'react-icons/bs';
import { chatHistoryStore } from '@extension/storage';

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
  const [activeFilter, setActiveFilter] = useState<'all' | 'chats' | 'tasks'>('all');
  const [isManageMode, setIsManageMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [enrichedData, setEnrichedData] = useState<Record<string, {
    type: 'chat' | 'task';
    stepsCount: number;
    durationStr?: string;
    isFailed?: boolean;
    isCancelled?: boolean;
    isCompleted?: boolean;
  }>>({});

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

  // Load and enrich session details asynchronously
  useEffect(() => {
    let active = true;
    const loadEnriched = async () => {
      const data: typeof enrichedData = {};
      await Promise.all(
        sessions.map(async (session) => {
          try {
            const fullSession = await chatHistoryStore.getSession(session.id);
            if (!fullSession) return;
            const messages = fullSession.messages || [];

            const hasAgent = messages.some(
              m => m.actor === 'planner' || m.actor === 'navigator' || m.actor === 'validator'
            );

            const stepsCount = messages.filter(
              m => m.actor === 'planner' || m.actor === 'navigator' || m.actor === 'validator'
            ).length;

            const isFailed = messages.some(m => m.isFailed);
            const isCancelled = messages.some(m => m.isCancelled);

            let durationStr = undefined;
            if (messages.length > 1) {
              const start = messages[0].timestamp;
              const end = messages[messages.length - 1].timestamp;
              const diffSec = Math.round((end - start) / 1000);
              if (diffSec > 0) {
                const mins = Math.floor(diffSec / 60);
                const secs = diffSec % 60;
                durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
              }
            }

            data[session.id] = {
              type: hasAgent ? 'task' : 'chat',
              stepsCount,
              durationStr,
              isFailed,
              isCancelled,
              isCompleted: !isFailed && !isCancelled && messages.length > 0
            };
          } catch (e) {
            console.error('Failed to enrich session:', session.id, e);
          }
        })
      );
      if (active) {
        setEnrichedData(data);
      }
    };

    if (visible && sessions.length > 0) {
      loadEnriched();
    }
    return () => { active = false; };
  }, [sessions, visible]);

  // Compute stats for switcher tabs
  const counts = useMemo(() => {
    let chats = 0;
    let tasks = 0;
    sessions.forEach(session => {
      const enriched = enrichedData[session.id];
      if (enriched) {
        if (enriched.type === 'chat') chats++;
        else if (enriched.type === 'task') tasks++;
      } else {
        chats++; // Guess chat by default
      }
    });
    return {
      all: sessions.length,
      chats,
      tasks
    };
  }, [sessions, enrichedData]);

  const filteredSessions = useMemo(() =>
    sessions.filter(session => {
      const title = session.title || 'Untitled Session';
      const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (activeFilter === 'all') return true;
      const enriched = enrichedData[session.id];
      if (!enriched) return true; // Show by default until loaded

      if (activeFilter === 'chats') return enriched.type === 'chat';
      if (activeFilter === 'tasks') return enriched.type === 'task';
      return true;
    }), [sessions, searchQuery, activeFilter, enrichedData]
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

  const handleCardClick = (sessionId: string) => {
    if (isManageMode) {
      setSelectedSessionIds(prev =>
        prev.includes(sessionId)
          ? prev.filter(id => id !== sessionId)
          : [...prev, sessionId]
      );
    } else {
      onSessionSelect(sessionId);
    }
  };

  const handleBulkDelete = async () => {
    try {
      await Promise.all(selectedSessionIds.map(id => chatHistoryStore.deleteSession(id)));
      if (selectedSessionIds.length > 0) {
        // Trigger deletion sync in parent on the last session ID
        onSessionDelete(selectedSessionIds[selectedSessionIds.length - 1]);
      }
      setSelectedSessionIds([]);
      setIsManageMode(false);
    } catch (e) {
      console.error('Failed to perform bulk delete:', e);
    }
  };

  if (!visible) return null;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">

      {/* ── Sticky Header ── */}
      <div
        className="relative shrink-0 px-4 pb-4 pt-6"
        style={{
          background: isDarkMode
            ? 'linear-gradient(180deg, rgba(2,6,23,0.98) 0%, rgba(2,6,23,0.85) 100%)'
            : 'linear-gradient(180deg, rgba(248,250,252,0.98) 0%, rgba(248,250,252,0.85) 100%)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        {/* Title row */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2
              className="font-sans text-[22px] font-extrabold tracking-tight"
              style={{
                background: isDarkMode
                  ? 'linear-gradient(135deg, #f1f5f9 0%, #a5b4fc 60%, #818cf8 100%)'
                  : 'linear-gradient(135deg, #0f172a 0%, #4f46e5 60%, #7c3aed 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              History
            </h2>
            <p className={`mt-0.5 text-[9px] font-bold uppercase tracking-[0.15em] ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
              Workspace Sessions
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsManageMode(!isManageMode);
                setSelectedSessionIds([]);
              }}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all duration-200 cursor-pointer ${
                isManageMode
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                  : isDarkMode
                    ? 'border border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    : 'border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {isManageMode ? 'Cancel' : 'Manage'}
            </button>

            <div
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{
                background: isDarkMode
                  ? 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.10))'
                  : 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.06))',
                border: isDarkMode ? '1px solid rgba(99,102,241,0.2)' : '1px solid rgba(99,102,241,0.15)',
              }}
            >
              <BsChatSquareDotsFill size={9} className={isDarkMode ? 'text-indigo-400' : 'text-indigo-500'} />
              <span className={`text-[10px] font-bold tabular-nums ${isDarkMode ? 'text-indigo-300' : 'text-indigo-600'}`}>
                {sessions.length}
              </span>
            </div>
          </div>
        </div>

        {/* Search Bar — clean glassmorphic */}
        <div
          className={`relative flex items-center gap-2.5 rounded-xl px-3.5 py-2 transition-all duration-300 ${
            isDarkMode
              ? 'border border-white/[0.06] bg-white/[0.03] backdrop-blur-md focus-within:border-indigo-500/30 focus-within:bg-white/[0.06]'
              : 'border border-slate-200/60 bg-white/60 backdrop-blur-md focus-within:border-indigo-300 focus-within:bg-white'
          }`}
          style={{
            boxShadow: isDarkMode
              ? '0 2px 12px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.02)'
              : '0 2px 8px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.8)',
          }}
        >
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className={`size-3.5 shrink-0 transition-colors duration-300 ${isDarkMode ? 'text-indigo-400/60' : 'text-indigo-500/60'}`}
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <input
            type="text"
            className={`w-full border-0 bg-transparent text-[12.5px] font-semibold tracking-tight focus:outline-none focus:ring-0 ${
              isDarkMode ? 'text-slate-200 placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'
            }`}
            placeholder="Search sessions or commands…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className={`shrink-0 rounded-md p-0.5 transition-all ${isDarkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="size-3">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Filters Switcher Tabs */}
        <div className="mt-3 flex gap-1">
          {(['all', 'chats', 'tasks'] as const).map(filter => (
            <button
              key={filter}
              type="button"
              onClick={() => setActiveFilter(filter)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold tracking-tight transition-all duration-200 cursor-pointer ${
                activeFilter === filter
                  ? isDarkMode
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                  : isDarkMode
                    ? 'border border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
                    : 'border border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
              }`}
            >
              <span className="capitalize">{filter}</span>
              <span className={`text-[9.5px] px-1 rounded-md ${
                activeFilter === filter
                  ? isDarkMode ? 'bg-indigo-500/30' : 'bg-indigo-100'
                  : isDarkMode ? 'bg-white/[0.04]' : 'bg-slate-200/50'
              }`}>
                {counts[filter]}
              </span>
            </button>
          ))}
        </div>

        {/* Bottom separator gradient */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
          style={{
            background: isDarkMode
              ? 'linear-gradient(90deg, transparent 0%, rgba(99,102,241,0.15) 40%, rgba(139,92,246,0.15) 60%, transparent 100%)'
              : 'linear-gradient(90deg, transparent 0%, rgba(99,102,241,0.10) 40%, rgba(139,92,246,0.10) 60%, transparent 100%)',
          }}
        />
      </div>

      {/* ── Scrollable Session List ── */}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 pb-20 pt-4">
        {filteredSessions.length === 0 ? (
          <div className="mt-16 flex flex-col items-center justify-center text-center">
            <div
              className="mb-4 flex size-16 items-center justify-center rounded-2xl"
              style={{
                background: isDarkMode
                  ? 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(139,92,246,0.06))'
                  : 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.04))',
                border: isDarkMode ? '1px solid rgba(99,102,241,0.12)' : '1px solid rgba(99,102,241,0.10)',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className={`size-7 ${isDarkMode ? 'text-indigo-400/40' : 'text-indigo-500/40'}`}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className={`text-sm font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
              No sessions found
            </p>
            <p className={`mt-1.5 max-w-[180px] text-[11px] leading-relaxed opacity-40 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              {searchQuery ? 'No matches for your search.' : 'Your session history will appear here.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedSessions).map(([group, groupSessions]) => (
              <div key={group}>

                {/* Group Label */}
                <div className="mb-2.5 flex items-center gap-3 px-0.5">
                  <span className={`text-[9px] font-black uppercase tracking-[0.14em] ${
                    isDarkMode ? 'text-indigo-400/60' : 'text-indigo-600/55'
                  }`}>
                    {group}
                  </span>
                  <div
                    className="h-px flex-1"
                    style={{
                      background: isDarkMode
                        ? 'linear-gradient(90deg, rgba(99,102,241,0.15) 0%, transparent 100%)'
                        : 'linear-gradient(90deg, rgba(99,102,241,0.10) 0%, transparent 100%)',
                    }}
                  />
                </div>

                {/* Session Cards */}
                <div className="flex flex-col gap-1.5">
                  {groupSessions.map((session, index) => {
                    const enriched = enrichedData[session.id];
                    const isSelected = selectedSessionIds.includes(session.id);

                    return (
                      <button
                        key={session.id}
                        type="button"
                        style={{
                          animationDelay: `${index * 40}ms`,
                          backdropFilter: 'none',
                          WebkitBackdropFilter: 'none',
                          background: isDarkMode ? '#0f172a' : '#ffffff',
                          border: isDarkMode
                            ? isSelected
                              ? '1px solid rgba(99,102,241,0.5)'
                              : '1px solid rgba(255,255,255,0.12)'
                            : isSelected
                              ? '1px solid rgba(99,102,241,0.5)'
                              : '1px solid rgba(0,0,0,0.12)',
                          boxShadow: isDarkMode
                            ? '0 2px 12px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.03)'
                            : '0 2px 12px rgba(0,0,0,0.025), inset 0 1px 0 rgba(255,255,255,0.9)',
                        }}
                        className="group relative flex w-full cursor-pointer items-start gap-3 overflow-hidden rounded-xl p-3 text-left transition-all duration-300 hover:-translate-y-px"
                        onClick={() => handleCardClick(session.id)}
                        aria-label={`Open session ${session.title || 'Untitled Session'}`}
                        onMouseEnter={e => {
                          if (isManageMode) return;
                          const el = e.currentTarget;
                          el.style.background = isDarkMode ? '#1e293b' : '#f8fafc';
                          el.style.border = isDarkMode
                            ? '1px solid rgba(255,255,255,0.22)'
                            : '1px solid rgba(99,102,241,0.28)';
                          el.style.boxShadow = isDarkMode
                            ? '0 6px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(99,102,241,0.08)'
                            : '0 6px 20px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,1)';
                        }}
                        onMouseLeave={e => {
                          if (isManageMode) return;
                          const el = e.currentTarget;
                          el.style.background = isDarkMode ? '#0f172a' : '#ffffff';
                          el.style.border = isDarkMode
                            ? isSelected
                              ? '1px solid rgba(99,102,241,0.5)'
                              : '1px solid rgba(255,255,255,0.12)'
                            : isSelected
                              ? '1px solid rgba(99,102,241,0.5)'
                              : '1px solid rgba(0,0,0,0.12)';
                          el.style.boxShadow = isDarkMode
                            ? '0 2px 12px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.03)'
                            : '0 2px 12px rgba(0,0,0,0.025), inset 0 1px 0 rgba(255,255,255,0.9)';
                        }}
                      >
                        {/* Left accent line */}
                        {!isManageMode && (
                          <div
                            className="absolute left-0 top-1/2 h-8 w-[2.5px] -translate-y-1/2 rounded-r-full opacity-0 transition-all duration-300 group-hover:opacity-100"
                            style={{
                              background: 'linear-gradient(180deg, #8b5cf6, #6366f1, #06b6d4)',
                              boxShadow: '0 0 8px rgba(99,102,241,0.6)',
                            }}
                          />
                        )}

                        {/* Checkbox for Manage Mode */}
                        {isManageMode && (
                          <div className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-all ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : isDarkMode
                                ? 'border-white/20 hover:border-white/40'
                                : 'border-slate-300 hover:border-slate-400'
                          }`}>
                            {isSelected && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="size-2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                        )}

                        {/* Icon */}
                        <div
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg transition-all duration-300 group-hover:scale-105"
                          style={{
                            background: isDarkMode
                              ? 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08))'
                              : 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.06))',
                            border: isDarkMode
                              ? '1px solid rgba(99,102,241,0.15)'
                              : '1px solid rgba(99,102,241,0.12)',
                          }}
                        >
                          <BsChatSquareDotsFill
                            size={14}
                            className={`transition-all duration-300 group-hover:scale-110 ${
                              isDarkMode ? 'text-indigo-400' : 'text-indigo-500'
                            }`}
                          />
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <h3 className={`truncate font-sans text-[12.5px] font-semibold tracking-tight transition-colors duration-200 ${
                            isDarkMode ? 'text-slate-200 group-hover:text-white' : 'text-slate-800 group-hover:text-slate-900'
                          }`}>
                            {session.title || 'Untitled Session'}
                          </h3>

                          {/* Metadata row */}
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={`flex items-center gap-1 text-[10px] font-medium ${
                              isDarkMode ? 'text-slate-500' : 'text-slate-400'
                            }`}>
                              <FaRegClock size={8} className="opacity-70" />
                              {getTimeAgo(session.createdAt)}
                            </span>

                            {enriched && enriched.type === 'task' && (
                              <>
                                <span className={`text-[10px] ${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>•</span>
                                <span className={`flex items-center gap-1 text-[10px] font-semibold ${
                                  isDarkMode ? 'text-indigo-400/85' : 'text-indigo-600/85'
                                }`}>
                                  <BsLightningChargeFill size={8} className="opacity-80" />
                                  {enriched.stepsCount} step{enriched.stepsCount === 1 ? '' : 's'}
                                  {enriched.durationStr && ` (${enriched.durationStr})`}
                                </span>

                                <span className={`text-[10px] ${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>•</span>
                                <span className={`rounded px-1.5 py-0.5 text-[8.2px] font-bold uppercase tracking-wider ${
                                  enriched.isFailed
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/10'
                                    : enriched.isCancelled
                                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/10'
                                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10'
                                }`}>
                                  {enriched.isFailed ? 'Failed' : enriched.isCancelled ? 'Cancelled' : 'Completed'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Action buttons — slide in on hover (hidden in manage mode) */}
                        {!isManageMode && (
                          <div className="flex shrink-0 translate-x-3 items-center gap-0.5 opacity-0 transition-all duration-250 group-hover:translate-x-0 group-hover:opacity-100">
                            {onSessionBookmark && (
                              <button
                                onClick={e => { e.stopPropagation(); onSessionBookmark(session.id); }}
                                className={`rounded-lg p-1.5 transition-all duration-150 ${
                                  isDarkMode
                                    ? 'text-slate-500 hover:bg-indigo-500/15 hover:text-indigo-300'
                                    : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'
                                }`}
                                title="Bookmark"
                                type="button"
                              >
                                <BsBookmark size={11} />
                              </button>
                            )}
                            <button
                              onClick={e => { e.stopPropagation(); onSessionDelete(session.id); }}
                              className={`rounded-lg p-1.5 transition-all duration-150 ${
                                isDarkMode
                                  ? 'text-slate-600 hover:bg-rose-500/15 hover:text-rose-400'
                                  : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'
                              }`}
                              title="Delete"
                              type="button"
                            >
                              <FaTrash size={10} />
                            </button>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bulk Delete Bottom Drawer */}
      {isManageMode && (
        <div
          className="absolute bottom-0 left-0 right-0 z-[70] px-4 py-4 flex items-center justify-between border-t transition-all duration-300 animate-in slide-in-from-bottom"
          style={{
            background: isDarkMode ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderColor: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.1)'
          }}
        >
          <div className="flex flex-col">
            <span className={`text-[12px] font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
              {selectedSessionIds.length} session{selectedSessionIds.length === 1 ? '' : 's'} selected
            </span>
            <span className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              These will be permanently deleted.
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setIsManageMode(false);
                setSelectedSessionIds([]);
              }}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all duration-200 cursor-pointer ${
                isDarkMode
                  ? 'bg-white/5 hover:bg-white/10 text-slate-300'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedSessionIds.length === 0}
              onClick={handleBulkDelete}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                selectedSessionIds.length === 0
                  ? 'opacity-40 cursor-not-allowed bg-rose-500/10 text-rose-500/50'
                  : 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-600/20'
              }`}
            >
              <FaTrash size={9} />
              Delete Selected
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatHistoryList;

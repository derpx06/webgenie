import React from 'react';
import { OrbVisual } from './welcome/OrbVisual';
import { BackgroundGradientAnimation } from './ui/background-gradient-animation';
import type { ChatSessionMetadata } from '@extension/storage';

interface EmptyChatProps {
    onSelectPrompt: (text: string) => void;
    isDarkMode: boolean;
    recentSessions?: ChatSessionMetadata[];
    onSelectSession?: (sessionId: string) => void;
    children?: React.ReactNode;
}

interface TestToolDefinition {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    schema?: Record<string, unknown>;
}

/* ─── Pill data — two rows, opposite scroll directions ─── */
const ROW_A = [
    { icon: '🔍', label: 'Search Hacker News' },
    { icon: '▶️', label: 'Open YouTube' },
    { icon: '🐦', label: 'Browse Twitter' },
    { icon: '✈️', label: 'Find cheap flights' },
    { icon: '🛍️', label: 'Compare products' },
    { icon: '📰', label: 'Summarize article' },
];

const ROW_B = [
    { icon: '💼', label: 'Search LinkedIn jobs' },
    { icon: '📈', label: 'Check stock prices' },
    { icon: '🌐', label: 'Translate webpage' },
    { icon: '🎵', label: 'Play music on Spotify' },
    { icon: '🗓️', label: 'Open Google Calendar' },
    { icon: '📬', label: 'Read latest emails' },
];

/* Helper: relative time label */
const getTimeAgo = (timestamp: number): string => {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    return `${diffDays}d ago`;
};

/* ─── Single pill chip ─── */
const PillChip: React.FC<{ icon: string; label: string; isDarkMode: boolean; onClick: () => void }> = ({
    icon, label, isDarkMode, onClick,
}) => (
    <button
        type="button"
        onClick={onClick}
        className="group flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold tracking-tight transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] active:scale-95"
        style={{
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            background: isDarkMode
                ? 'rgba(255,255,255,0.04)'
                : 'rgba(255,255,255,0.72)',
            border: isDarkMode
                ? '1px solid rgba(255,255,255,0.08)'
                : '1px solid rgba(0,0,0,0.07)',
            boxShadow: isDarkMode
                ? '0 2px 10px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)'
                : '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.9)',
            color: isDarkMode ? 'rgba(226,232,240,0.85)' : 'rgba(30,41,59,0.85)',
            whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => {
            const el = e.currentTarget;
            el.style.background = isDarkMode ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)';
            el.style.border = isDarkMode ? '1px solid rgba(99,102,241,0.28)' : '1px solid rgba(99,102,241,0.22)';
        }}
        onMouseLeave={e => {
            const el = e.currentTarget;
            el.style.background = isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.72)';
            el.style.border = isDarkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.07)';
        }}
    >
        <span className="text-base leading-none">{icon}</span>
        <span>{label}</span>
    </button>
);

/* ─── Dual-direction marquee rows ─── */
const PillMarquee: React.FC<{ isDarkMode: boolean; onSelectPrompt: (text: string) => void }> = ({
    isDarkMode, onSelectPrompt,
}) => {
    const doubled = (arr: typeof ROW_A) => [...arr, ...arr];

    return (
        <div className="w-full overflow-hidden" style={{ WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 10%, black 90%, transparent 100%)', maskImage: 'linear-gradient(90deg, transparent 0%, black 10%, black 90%, transparent 100%)' }}>
            {/* Row A → scrolls right */}
            <div className="mb-2.5 flex gap-2.5" style={{ animation: 'marquee-right 28s linear infinite' }}>
                {doubled(ROW_A).map((p, i) => (
                    <PillChip key={i} icon={p.icon} label={p.label} isDarkMode={isDarkMode} onClick={() => onSelectPrompt(p.label)} />
                ))}
            </div>
            {/* Row B → scrolls left */}
            <div className="flex gap-2.5" style={{ animation: 'marquee-left 22s linear infinite' }}>
                {doubled(ROW_B).map((p, i) => (
                    <PillChip key={i} icon={p.icon} label={p.label} isDarkMode={isDarkMode} onClick={() => onSelectPrompt(p.label)} />
                ))}
            </div>
        </div>
    );
};

/* ─── iPhone-style session notification card ─── */
const SessionCard: React.FC<{ session: ChatSessionMetadata; isDarkMode: boolean; onClick: () => void }> = ({
    session, isDarkMode, onClick,
}) => {
    const colors = [
        ['#8b5cf6', '#6366f1'],
        ['#06b6d4', '#0891b2'],
        ['#d946ef', '#a21caf'],
        ['#f59e0b', '#d97706'],
        ['#10b981', '#059669'],
        ['#f43f5e', '#e11d48'],
    ];
    const idx = (session.title?.charCodeAt(0) ?? 65) % colors.length;
    const [c1, c2] = colors[idx];

    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex h-full w-full items-center gap-3 rounded-2xl px-3.5 text-left transition-all duration-200"
            style={{
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
                background: isDarkMode ? '#0f172a' : '#ffffff',
                border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.12)',
                boxShadow: isDarkMode
                    ? '0 4px 14px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)'
                    : '0 3px 12px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
            }}
            onMouseEnter={e => {
                const el = e.currentTarget;
                el.style.background = isDarkMode ? '#1e293b' : '#f8fafc';
                el.style.border = isDarkMode ? '1px solid rgba(255, 255, 255, 0.20)' : '1px solid rgba(99, 102, 241, 0.35)';
                el.style.boxShadow = isDarkMode
                    ? '0 6px 20px rgba(0, 0, 0, 0.45)'
                    : '0 4px 16px rgba(99, 102, 241, 0.12)';
            }}
            onMouseLeave={e => {
                const el = e.currentTarget;
                el.style.background = isDarkMode ? '#0f172a' : '#ffffff';
                el.style.border = isDarkMode ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.12)';
                el.style.boxShadow = isDarkMode
                    ? '0 4px 14px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)'
                    : '0 3px 12px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.9)';
            }}
        >
            {/* Color dot */}
            <div
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white text-[15px] font-bold shadow-sm transition-transform duration-200 group-hover:scale-105"
                style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
            >
                {(session.title?.[0] ?? 'W').toUpperCase()}
            </div>

            {/* Text */}
            <div className="min-w-0 flex-1 overflow-hidden">
                <p className={`truncate text-[12.5px] font-semibold tracking-tight transition-colors duration-200 ${
                    isDarkMode ? 'text-slate-200 group-hover:text-white' : 'text-slate-800 group-hover:text-slate-900'
                }`}>
                    {session.title || 'Untitled Session'}
                </p>
                <p className={`mt-0.5 text-[10px] font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    WebGenie · Browser Agent
                </p>
            </div>

            {/* Time badge */}
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold tracking-wide ${
                isDarkMode ? 'bg-white/[0.05] text-slate-500' : 'bg-slate-100 text-slate-400'
            }`}>
                {getTimeAgo(session.createdAt)}
            </span>
        </button>
    );
};

/* ─── Main EmptyChat ─── */
const EmptyChat: React.FC<EmptyChatProps> = ({ onSelectPrompt, isDarkMode, recentSessions = [], onSelectSession, children }) => {
    const [scrollTop, setScrollTop] = React.useState(0);
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    };

    // Use native non-passive listener to prevent scroll propagation
    React.useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleWheelEvent = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            container.scrollTop += e.deltaY;
        };

        container.addEventListener('wheel', handleWheelEvent, { passive: false });
        return () => {
            container.removeEventListener('wheel', handleWheelEvent);
        };
    }, [recentSessions.length]);

    // Stacking parameters
    const cardStep = 66; // 58px height + 8px gap
    const threshold = 264; // 4 * cardStep (keeps 5 visible)

    return (
        <BackgroundGradientAnimation
            containerClassName={`flex-1 w-full overflow-hidden transition-colors duration-500 ${isDarkMode ? 'bg-slate-950' : 'bg-slate-50'}`}
            className={`relative z-10 flex h-full flex-col justify-start overflow-hidden pb-4 pt-[35px] ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}
            gradientBackgroundStart={isDarkMode ? 'rgb(2, 6, 23)' : 'rgb(248, 250, 252)'}
            gradientBackgroundEnd={isDarkMode ? 'rgb(15, 23, 42)' : 'rgb(241, 245, 249)'}
            firstColor={isDarkMode ? '79, 70, 229' : '99, 102, 241'}
            secondColor={isDarkMode ? '56, 189, 248' : '129, 140, 248'}
            thirdColor={isDarkMode ? '30, 41, 59' : '226, 232, 240'}
            fourthColor={isDarkMode ? '12, 21, 37' : '248, 250, 252)'}
            fifthColor={isDarkMode ? '2, 6, 23' : '255, 255, 255'}
            pointerColor={isDarkMode ? '79, 70, 229' : '99, 102, 241'}
        >
            <div className="from-slate-950/48 via-slate-950/38 to-slate-950/62 pointer-events-none absolute inset-0 z-0 bg-gradient-to-b" />

            <div className="pointer-events-auto relative z-10 mx-auto w-full max-w-xl">

                {/* ── Logo + Title ── */}
                <div className="mb-5 flex flex-col items-center px-6 text-center">
                    <div className="relative mb-2 opacity-95 transition-all duration-700">
                        <OrbVisual isDarkMode={isDarkMode} />
                    </div>
                    <div className="space-y-1.5 px-4">
                        <h1 className={`text-4xl font-extrabold leading-none -tracking-wide transition-all duration-700 ${isDarkMode
                            ? 'bg-gradient-to-r from-white via-indigo-200 to-indigo-100 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(99,102,241,0.2)]'
                            : 'bg-gradient-to-r from-slate-900 via-indigo-900 to-indigo-950 bg-clip-text text-transparent'
                        }`}>
                            WebGenie
                        </h1>
                        <p className={`mx-auto max-w-[300px] font-sans text-[12px] font-medium leading-relaxed tracking-tight ${isDarkMode ? 'text-slate-300/70' : 'text-slate-500'}`}>
                            Autonomous browser operations and web search inside your browser.
                        </p>
                    </div>
                </div>

                {/* ── Chat input slot ── */}
                <div className="mb-5 w-full px-4">
                    {children}
                </div>

                {/* ── Dual-direction pill marquee ── */}
                <div className="mb-6">
                    <p className={`mb-3 px-6 text-[9px] font-black uppercase tracking-[0.14em] ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
                        Quick Actions
                    </p>
                    <PillMarquee isDarkMode={isDarkMode} onSelectPrompt={onSelectPrompt} />
                </div>

                {/* ── Session history — iPhone notification style ── */}
                {recentSessions.length > 0 && (
                    <div className="px-4">
                        {/* Section header */}
                        <div className="mb-3 flex items-center justify-between px-1">
                            <div className="flex items-center gap-3">
                                <p className={`text-[9px] font-black uppercase tracking-[0.14em] ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
                                    Recent Sessions
                                </p>
                                <div
                                    className="h-px w-20"
                                    style={{
                                        background: isDarkMode
                                            ? 'linear-gradient(90deg, rgba(99,102,241,0.15) 0%, transparent 100%)'
                                            : 'linear-gradient(90deg, rgba(99,102,241,0.10) 0%, transparent 100%)',
                                    }}
                                />
                            </div>
                            <span className={`text-[9.5px] font-bold ${isDarkMode ? 'text-indigo-400/60' : 'text-indigo-500/60'}`}>
                                {recentSessions.length} sessions
                            </span>
                        </div>

                        {/* Stacking scroll area */}
                        <div
                            ref={scrollContainerRef}
                            onScroll={handleScroll}
                            className="scrollbar-none relative overflow-y-auto px-1 py-1.5"
                            style={{
                                height: '390px',
                                overscrollBehavior: 'contain',
                                maskImage: 'linear-gradient(to bottom, transparent 0%, black 5%, black 85%, transparent 100%)',
                                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 5%, black 85%, transparent 100%)',
                            }}
                        >
                            <div style={{ height: `${recentSessions.length * cardStep + 60}px`, position: 'relative' }}>
                                {recentSessions.map((session, i) => {
                                    const y_i = i * cardStep;
                                    const relY = y_i - scrollTop;
                                    let translateY = 0;
                                    let scale = 1;
                                    let opacity = 1;
                                    const zIndex = 100 - i;

                                    if (relY > threshold) {
                                        const diff = relY - threshold;
                                        const overlap = Math.min(22, diff * 0.16);
                                        translateY = -diff + overlap;
                                        scale = Math.max(0.86, 1 - (diff * 0.0013));
                                        opacity = Math.max(0, 1 - (diff * 0.025));
                                    } else if (relY < 0) {
                                        const diffTop = -relY;
                                        const overlapTop = Math.min(16, diffTop * 0.12);
                                        translateY = diffTop - overlapTop;
                                        scale = Math.max(0.9, 1 - (diffTop * 0.0015));
                                        opacity = Math.max(0, 1 - (diffTop * 0.03));
                                    }

                                    return (
                                        <div
                                            key={session.id}
                                            style={{
                                                transform: `translate3d(0, ${translateY}px, 0) scale(${scale})`,
                                                opacity,
                                                zIndex,
                                                transformOrigin: 'top center',
                                                transition: 'transform 0.04s ease-out, opacity 0.04s ease-out',
                                                position: 'absolute',
                                                top: `${y_i}px`,
                                                left: 0,
                                                right: 0,
                                                height: '58px',
                                            }}
                                        >
                                            <SessionCard
                                                session={session}
                                                isDarkMode={isDarkMode}
                                                onClick={() => {
                                                    if (onSelectSession) {
                                                        onSelectSession(session.id);
                                                    } else {
                                                        onSelectPrompt(session.title);
                                                    }
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </BackgroundGradientAnimation>
    );
};

export default EmptyChat;

import React, { useState, useEffect, useRef } from 'react';
import { HiOutlineX, HiOutlineChevronUp } from 'react-icons/hi';

interface AgentSightProps {
    screenshot: string | null;
    isActive: boolean;
}

export const AgentSight: React.FC<AgentSightProps> = ({ screenshot, isActive }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [displayScreenshot, setDisplayScreenshot] = useState<string | null>(null);
    const [prevScreenshot, setPrevScreenshot] = useState<string | null>(null);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [hasEverHadScreenshot, setHasEverHadScreenshot] = useState(false);

    useEffect(() => {
        if (screenshot && screenshot !== displayScreenshot) {
            setPrevScreenshot(displayScreenshot);
            setDisplayScreenshot(screenshot);
            setHasEverHadScreenshot(true);
            setIsTransitioning(true);
            const timer = setTimeout(() => setIsTransitioning(false), 400);
            return () => clearTimeout(timer);
        }
        if (!isActive && !screenshot) {
            // Keep last screenshot visible even when done, clear after a delay
            const timer = setTimeout(() => {
                setDisplayScreenshot(null);
                setPrevScreenshot(null);
                setHasEverHadScreenshot(false);
                setIsExpanded(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [screenshot, isActive]);

    // Don't render anything if never had a screenshot and not active
    if (!isActive && !hasEverHadScreenshot) return null;

    const formatSrc = (src: string | null) => {
        if (!src) return '';
        return src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`;
    };

    return (
        <>
            {/* Backdrop when expanded */}
            {isExpanded && (
                <div
                    className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
                    style={{ animation: 'fadeIn 0.2s ease-out' }}
                    onClick={() => setIsExpanded(false)}
                />
            )}

            {/* The pill / expanded panel */}
            <div
                className={`
                    relative z-[100] overflow-hidden
                    transition-all duration-400 ease-in-out
                    ${isExpanded
                        ? 'fixed top-4 left-4 right-4 rounded-2xl shadow-2xl border border-white/15'
                        : 'mx-4 mt-3 mb-1 rounded-full border border-white/10 shadow-lg cursor-pointer hover:border-white/20'
                    }
                    bg-slate-900/90 backdrop-blur-xl
                `}
                style={{
                    height: isExpanded ? '240px' : '32px',
                    transition: 'height 0.35s cubic-bezier(0.4,0,0.2,1), border-radius 0.35s cubic-bezier(0.4,0,0.2,1), top 0.35s, left 0.35s, right 0.35s',
                }}
                onClick={!isExpanded ? () => setIsExpanded(true) : undefined}
            >
                {/* ── COLLAPSED PILL ── */}
                <div
                    className={`absolute inset-0 flex items-center px-3 gap-2 transition-opacity duration-200 ${isExpanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                >
                    {/* Live dot */}
                    <div className="relative flex-shrink-0">
                        <div className={`size-2 rounded-full ${isActive ? 'bg-cyan-400' : 'bg-slate-500'}`} />
                        {isActive && (
                            <div className="absolute inset-0 size-2 rounded-full bg-cyan-400 animate-ping opacity-75" />
                        )}
                    </div>
                    {/* Tiny thumbnail strip */}
                    {displayScreenshot && (
                        <div className="h-5 w-8 rounded overflow-hidden flex-shrink-0 opacity-80">
                            <img src={formatSrc(displayScreenshot)} alt="" className="size-full object-cover" />
                        </div>
                    )}
                    <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/60 truncate flex-1">
                        {isActive ? 'Agent Sight · Live' : 'Agent Sight'}
                    </span>
                    <HiOutlineChevronUp size={11} className="text-white/30 flex-shrink-0" />
                </div>

                {/* ── EXPANDED VIEW ── */}
                <div
                    className={`absolute inset-0 transition-opacity duration-250 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                >
                    {/* Screenshot cross-fade */}
                    <div className="relative size-full">
                        {prevScreenshot && isTransitioning && (
                            <img
                                src={formatSrc(prevScreenshot)}
                                alt=""
                                className="absolute inset-0 size-full object-cover opacity-100"
                            />
                        )}
                        {displayScreenshot ? (
                            <img
                                src={formatSrc(displayScreenshot)}
                                alt="Agent View"
                                className={`size-full object-cover transition-opacity duration-400 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-slate-500">
                                <div className="text-center space-y-2">
                                    <div className="size-6 mx-auto rounded-full bg-indigo-500/20 animate-pulse" />
                                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Initializing…</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Status badge */}
                    <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 backdrop-blur-md">
                        <div className={`size-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(34,211,238,0.8)]' : 'bg-slate-500'}`} />
                        <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/80">
                            {isActive ? 'Neural Feed · Active' : 'Feed Standby'}
                        </span>
                    </div>

                    {/* Close button */}
                    <button
                        onClick={e => { e.stopPropagation(); setIsExpanded(false); }}
                        className="absolute right-3 top-3 flex items-center justify-center size-6 rounded-full border border-white/10 bg-black/60 text-white/70 backdrop-blur-md transition-all hover:bg-white/15 hover:text-white"
                    >
                        <HiOutlineX size={12} />
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
            `}</style>
        </>
    );
};

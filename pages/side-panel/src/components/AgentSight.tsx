import React, { useEffect, useState } from 'react';
import { HiOutlineX } from 'react-icons/hi';

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
            const timer = setTimeout(() => {
                setDisplayScreenshot(null);
                setPrevScreenshot(null);
                setHasEverHadScreenshot(false);
                setIsExpanded(false);
            }, 3000);
            return () => clearTimeout(timer);
        }

        return undefined;
    }, [displayScreenshot, isActive, screenshot]);

    if (!isActive && !hasEverHadScreenshot) return null;

    const formatSrc = (src: string | null) => {
        if (!src) return '';
        return src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`;
    };

    return (
        <>
            {isExpanded && (
                <div
                    role="button"
                    tabIndex={0}
                    aria-label="Close agent sight overlay"
                    className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
                    style={{ animation: 'fadeIn 0.2s ease-out' }}
                    onClick={() => setIsExpanded(false)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsExpanded(false);
                        }
                    }}
                />
            )}

            <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                aria-label="Toggle agent sight panel"
                className={`z-[100] overflow-hidden transition-all duration-[400ms] ease-in-out ${
                    isExpanded
                        ? 'fixed inset-x-4 top-24 rounded-2xl border border-white/15 bg-slate-900/95 shadow-2xl backdrop-blur-2xl'
                        : 'fixed right-4 top-[92px] size-11 cursor-pointer rounded-full border border-white/15 bg-slate-900/90 shadow-lg backdrop-blur-xl hover:scale-105 hover:border-white/30 active:scale-95'
                }`}
                style={{
                    height: isExpanded ? '240px' : '44px',
                    width: isExpanded ? 'calc(100% - 32px)' : '44px',
                    transition:
                        'height 0.35s cubic-bezier(0.4,0,0.2,1), width 0.35s cubic-bezier(0.4,0,0.2,1), border-radius 0.35s cubic-bezier(0.4,0,0.2,1), top 0.35s, left 0.35s, right 0.35s, transform 0.2s',
                }}
                onClick={!isExpanded ? () => setIsExpanded(true) : undefined}
                onKeyDown={(e) => {
                    if (!isExpanded && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        setIsExpanded(true);
                    }
                }}
            >
                {/* Collapsed circular view content */}
                <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isExpanded ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
                    {displayScreenshot ? (
                        <div className="relative size-full overflow-hidden rounded-full">
                            <img src={formatSrc(displayScreenshot)} alt="Agent View" className="size-full object-cover" />
                            {/* Glowing corner indicator */}
                            <div className="absolute bottom-0.5 right-0.5 rounded-full bg-slate-950 p-0.5">
                                <div className={`size-1.5 rounded-full ${isActive ? 'bg-cyan-400' : 'bg-slate-500'}`} />
                                {isActive && <div className="absolute inset-0 size-1.5 animate-ping rounded-full bg-cyan-400 opacity-75" />}
                            </div>
                        </div>
                    ) : (
                        <div className="relative flex size-full items-center justify-center">
                            {/* Browser/Eye Icon */}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`size-4.5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`}>
                                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                            <div className="absolute bottom-0.5 right-0.5 rounded-full bg-slate-950 p-0.5">
                                <div className={`size-1.5 rounded-full ${isActive ? 'animate-pulse bg-cyan-400' : 'bg-slate-500'}`} />
                            </div>
                        </div>
                    )}
                </div>

                {/* Expanded full view content */}
                <div className={`absolute inset-0 transition-opacity duration-[250ms] ${isExpanded ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                    <div className="relative size-full">
                        {prevScreenshot && isTransitioning && (
                            <img src={formatSrc(prevScreenshot)} alt="" className="absolute inset-0 size-full object-cover opacity-100" />
                        )}

                        {displayScreenshot ? (
                            <img
                                src={formatSrc(displayScreenshot)}
                                alt="Agent View"
                                className={`size-full object-cover transition-opacity duration-[400ms] ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-slate-500">
                                <div className="space-y-2 text-center">
                                    <div className="mx-auto size-6 animate-pulse rounded-full bg-indigo-500/20" />
                                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Initializing…</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 backdrop-blur-md">
                        <div className={`size-1.5 flex-shrink-0 rounded-full ${isActive ? 'animate-pulse bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]' : 'bg-slate-500'}`} />
                        <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/80">
                            {isActive ? 'Neural Feed · Active' : 'Feed Standby'}
                        </span>
                    </div>

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(false);
                        }}
                        className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/70 backdrop-blur-md transition-all hover:bg-white/15 hover:text-white"
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

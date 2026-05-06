import React, { useState, useEffect } from 'react';
import { HiOutlineExternalLink, HiOutlineViewGrid } from 'react-icons/hi';

interface AgentSightProps {
    screenshot: string | null;
    isActive: boolean;
}

export const AgentSight: React.FC<AgentSightProps> = ({ screenshot, isActive }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [displayScreenshot, setDisplayScreenshot] = useState<string | null>(null);
    const [prevScreenshot, setPrevScreenshot] = useState<string | null>(null);
    const [isTransitioning, setIsTransitioning] = useState(false);

    useEffect(() => {
        if (screenshot) {
            if (screenshot !== displayScreenshot) {
                setPrevScreenshot(displayScreenshot);
                setDisplayScreenshot(screenshot);
                setIsTransitioning(true);
                const timer = setTimeout(() => setIsTransitioning(false), 500);
                return () => clearTimeout(timer);
            }
        } else if (!isActive) {
            setDisplayScreenshot(null);
            setPrevScreenshot(null);
        }
        return undefined;
    }, [screenshot, displayScreenshot, isActive]);

    if (!displayScreenshot && !isActive) return null;

    const formatSrc = (src: string | null) => {
        if (!src) return '';
        return src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`;
    };

    return (
        <div className={`group relative transition-all duration-500 ease-in-out shrink-0 ${
            isExpanded ? 'fixed inset-4 z-[100]' : 'mx-4 my-3'
        }`}>
            <div className={`
                relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 shadow-2xl backdrop-blur-xl
                ${isExpanded ? 'size-full' : 'h-40 w-full'}
                transition-all duration-500
            `}>
                {/* Background "Live" Pulse Glow */}
                {isActive && (
                    <div className="absolute inset-0 bg-indigo-500/5 animate-pulse-gentle pointer-events-none" />
                )}

                {/* Screenshot Display with Cross-fade */}
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
                            className={`size-full object-cover transition-opacity duration-500 ${
                                isTransitioning ? 'opacity-0' : 'opacity-100'
                            }`}
                        />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center space-y-3 text-slate-500">
                            <div className="relative">
                                <HiOutlineViewGrid size={28} className="animate-pulse" />
                                <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full" />
                            </div>
                            <span className="text-[11px] font-black uppercase tracking-[0.2em] opacity-60">Initializing Sight...</span>
                        </div>
                    )}
                </div>

                {/* Status Indicator */}
                <div className="absolute left-3 top-3 flex items-center space-x-2 rounded-full border border-white/5 bg-black/60 px-2.5 py-1 backdrop-blur-md">
                    <div className={`size-1.5 rounded-full ${isActive ? 'bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'bg-slate-600'}`} />
                    <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/90">
                        {isActive ? 'Neural Feed: Active' : 'Feed Standby'}
                    </span>
                </div>

                {/* Action Controls */}
                <div className="absolute right-3 top-3 flex space-x-2 opacity-0 transition-all duration-300 group-hover:opacity-100">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-white backdrop-blur-md transition-all hover:bg-white/10 hover:scale-105"
                        title={isExpanded ? "Collapse View" : "Expand Neural Feed"}
                    >
                        <HiOutlineExternalLink size={14} />
                    </button>
                </div>

                {/* Scanning Line Effect (Neural Feel) */}
                {isActive && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-b from-cyan-500/20 to-transparent animate-scan pointer-events-none" />
                )}
            </div>

            {/* Expanded Backdrop */}
            {isExpanded && (
                <div
                    className="fixed inset-0 z-[90] bg-[#020617]/90 backdrop-blur-sm animate-fade-in"
                    onClick={() => setIsExpanded(false)}
                />
            )}
        </div>
    );
};


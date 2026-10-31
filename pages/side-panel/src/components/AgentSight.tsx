import React, { useEffect, useRef, useState } from 'react';

interface AgentSightProps {
    screenshot: string | null;
    isActive: boolean;
}

const formatSrc = (src: string | null) => {
    if (!src) return '';
    return src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`;
};

/**
 * What the agent last saw. It sits as a small thumbnail in the corner of the trail and
 * opens into a dialog on demand — the page view is context, not the main event, so it
 * never takes space away from what the agent is doing.
 */
export const AgentSight: React.FC<AgentSightProps> = ({ screenshot, isActive }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [shot, setShot] = useState<string | null>(null);
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (screenshot) setShot(screenshot);
    }, [screenshot]);

    // The view clears a few seconds after the run ends, so a finished task does not keep
    // a stale page picture on screen.
    useEffect(() => {
        if (isActive || !shot) return undefined;
        const timer = setTimeout(() => {
            setShot(null);
            setIsExpanded(false);
        }, 3000);
        return () => clearTimeout(timer);
    }, [isActive, shot]);

    useEffect(() => {
        if (!isExpanded) return undefined;
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsExpanded(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isExpanded]);

    if (!shot) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label="Show what the agent sees"
                className="absolute right-3 top-3 z-20 size-10 overflow-hidden rounded-[var(--wg-r-md)] border"
                style={{ borderColor: 'var(--wg-border-strong)', boxShadow: 'var(--wg-sh-2)' }}>
                <img src={formatSrc(shot)} alt="" className="size-full object-cover" />
            </button>

            {isExpanded && (
                <div
                    className="absolute inset-0 z-40 flex items-center justify-center p-4"
                    style={{ background: 'var(--wg-scrim)' }}
                    onClick={() => setIsExpanded(false)}
                    role="presentation">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="What the agent sees"
                        className="wg-card relative w-full overflow-hidden"
                        style={{ boxShadow: 'var(--wg-sh-3)' }}
                        onClick={e => e.stopPropagation()}>
                        <img src={formatSrc(shot)} alt="The page the agent is working on" className="block w-full" />
                        <button
                            ref={closeRef}
                            type="button"
                            className="wg-icon-btn absolute right-2 top-2"
                            style={{ background: 'var(--wg-surface)' }}
                            onClick={() => setIsExpanded(false)}
                            aria-label="Close">
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="size-4" aria-hidden="true">
                                <path d="M4 4l8 8M12 4l-8 8" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

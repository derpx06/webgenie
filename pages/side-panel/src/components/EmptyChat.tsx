import React from 'react';
import type { ChatSessionMetadata } from '@extension/storage';

interface EmptyChatProps {
    onSelectPrompt: (text: string) => void;
    isDarkMode: boolean;
    recentSessions?: ChatSessionMetadata[];
    onSelectSession?: (sessionId: string) => void;
    onDebugExtractDom?: () => void;
    isDebugExtractingDom?: boolean;
    children?: React.ReactNode;
}

/** Starting points, phrased as the tasks a person would actually type. */
const SUGGESTIONS = [
    'Summarise the page I have open',
    'Find the cheapest direct flight to Lisbon next month',
    'Collect the top Hacker News posts and their links',
    'Read this article and give me the three key points',
];

/** One drawn icon per starting point, in the order of SUGGESTIONS; the chip colour comes from its position. */
const SUGGESTION_ICONS = [
    <path key="page" d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
    <path key="plane" d="M3 13l18-8-7 15-2.5-6z" />,
    <path key="list" d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    <path key="book" d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13" />,
];

const getTimeAgo = (timestamp: number): string => {
    const mins = Math.floor((Date.now() - timestamp) / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
};

/**
 * The first thing a person sees. It says what the panel is for, gives the composer the
 * most room, and offers a few concrete starting points — nothing that competes with the
 * one thing to do here, which is type a task.
 */
const EmptyChat: React.FC<EmptyChatProps> = ({
    onSelectPrompt,
    recentSessions = [],
    onSelectSession,
    onDebugExtractDom,
    isDebugExtractingDom = false,
    children,
}) => (
    <>
        <div className="wg-scroll">
            <div className="flex flex-col gap-6 px-4 pb-4 pt-8">
                <div className="flex items-center gap-4">
                    <div className="wg-orb" aria-hidden="true">
                        <span className="wg-orb-glow" />
                        <span className="wg-orb-ring" />
                        <span className="wg-orb-ring wg-orb-ring-2" />
                        <span className="wg-orb-core">
                            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 3.5l0 15 4.2-3.6 3 6.4 2.7-1.3-3-6.2H19z" fill="#fff" /></svg>
                        </span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <h1 style={{ fontSize: 'var(--wg-fs-xl)', lineHeight: 'var(--wg-lh-xl)', fontWeight: 'var(--wg-w-semibold)', letterSpacing: '-0.015em' }}>
                            What should I do?
                        </h1>
                        <p className="wg-callout-note">
                            Describe a task in plain words. WebGenie plans it, works through the pages in your browser and
                            shows every step it takes.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    <p className="wg-label">Try one of these</p>
                    <ul className="flex flex-col gap-1.5">
                        {SUGGESTIONS.map((text, i) => (
                            <li key={text}>
                                <button
                                    type="button"
                                    onClick={() => onSelectPrompt(text)}
                                    className="wg-card flex w-full items-center gap-3 py-2 pl-2 pr-3 text-left"
                                    style={{ fontSize: 'var(--wg-fs-base)', lineHeight: 'var(--wg-lh-base)', color: 'var(--wg-text)' }}>
                                    <span className={`wg-chip wg-chip-${i % 4}`} aria-hidden="true">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                            {SUGGESTION_ICONS[i % SUGGESTION_ICONS.length]}
                                        </svg>
                                    </span>
                                    <span className="min-w-0 flex-1">{text}</span>
                                    <svg className="wg-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M9 6l6 6-6 6" />
                                    </svg>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                {recentSessions.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="wg-label">Recent</p>
                        <ul className="flex flex-col gap-1.5">
                            {recentSessions.slice(0, 5).map(session => (
                                <li key={session.id}>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onSelectSession ? onSelectSession(session.id) : onSelectPrompt(session.title)
                                        }
                                        className="wg-card flex w-full items-center gap-2 px-3 py-2 text-left">
                                        <span
                                            className="min-w-0 flex-1 truncate"
                                            style={{ fontSize: 'var(--wg-fs-base)', color: 'var(--wg-text-2)' }}>
                                            {session.title}
                                        </span>
                                        <span className="wg-meta wg-num shrink-0">{getTimeAgo(session.updatedAt)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {onDebugExtractDom && (
                    <button
                        type="button"
                        onClick={onDebugExtractDom}
                        disabled={isDebugExtractingDom}
                        className="wg-meta self-start underline underline-offset-2 disabled:cursor-wait"
                        title="Extract the current active page DOM through the background browser-state pipeline and log it to this side-panel console.">
                        {isDebugExtractingDom ? 'Extracting DOM…' : 'Log current page DOM'}
                    </button>
                )}
            </div>
        </div>

        {children}
    </>
);

export default EmptyChat;

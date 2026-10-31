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
    'Fill in this form with my saved details',
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
                <div className="flex flex-col gap-2">
                    <h1 style={{ fontSize: 'var(--wg-fs-xl)', lineHeight: 'var(--wg-lh-xl)', fontWeight: 'var(--wg-w-semibold)', letterSpacing: '-0.01em' }}>
                        What should I do?
                    </h1>
                    <p className="wg-callout-note">
                        Describe a task in plain words. WebGenie plans it, works through the pages in your browser and
                        shows every step it takes.
                    </p>
                </div>

                <div className="flex flex-col gap-2">
                    <p className="wg-label">Try one of these</p>
                    <ul className="flex flex-col gap-1.5">
                        {SUGGESTIONS.map(text => (
                            <li key={text}>
                                <button
                                    type="button"
                                    onClick={() => onSelectPrompt(text)}
                                    className="wg-card w-full px-3 py-2 text-left"
                                    style={{ fontSize: 'var(--wg-fs-base)', lineHeight: 'var(--wg-lh-base)', color: 'var(--wg-text-2)' }}>
                                    {text}
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

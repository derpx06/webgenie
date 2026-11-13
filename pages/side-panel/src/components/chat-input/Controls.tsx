import React from 'react';
import { t } from '@extension/i18n';

interface ChatActionButtonsProps {
    showStopButton: boolean;
    onStopTask: () => void;
    isPaused: boolean;
    onPauseTask: () => void;
    onResumeTask: () => void;
    isSendButtonDisabled: boolean;
    isDarkMode?: boolean;
}

const glyph = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'size-3.5',
    'aria-hidden': true,
};

/**
 * The composer's right-hand controls. While a task runs they become the controls for
 * that run, so there is exactly one place to stop or hold it.
 */
export const ChatActionButtons: React.FC<ChatActionButtonsProps> = ({
    showStopButton,
    onStopTask,
    isPaused,
    onPauseTask,
    onResumeTask,
    isSendButtonDisabled,
}) => {
    if (showStopButton) {
        return (
            <>
                <button
                    type="submit"
                    className="wg-btn wg-btn-primary"
                    disabled={isSendButtonDisabled}
                    aria-label={t('chat_buttons_steer')}
                    title={t('chat_buttons_steer')}>
                    <svg {...glyph}><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>
                </button>
                <button type="button" className="wg-btn wg-btn-quiet" onClick={isPaused ? onResumeTask : onPauseTask}>
                    <svg {...glyph} fill="currentColor" stroke="none">
                        {isPaused ? <path d="M5 3.5v9l7-4.5-7-4.5Z" /> : <path d="M5.5 3.5h2v9h-2zM8.5 3.5h2v9h-2z" />}
                    </svg>
                    {isPaused ? t('chat_buttons_resume') : t('chat_buttons_pause')}
                </button>
                <button type="button" className="wg-btn wg-btn-tone wg-tone-err" onClick={onStopTask}>
                    <svg {...glyph} fill="currentColor" stroke="none">
                        <rect x="4" y="4" width="8" height="8" rx="1.5" />
                    </svg>
                    {t('chat_buttons_stop')}
                </button>
            </>
        );
    }

    return (
        <button type="submit" className="wg-btn wg-btn-primary" disabled={isSendButtonDisabled}>
            {t('chat_buttons_runTask')}
            <svg {...glyph}><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg>
        </button>
    );
};

interface ShortcutHintProps {
    isDarkMode?: boolean;
    disabled: boolean;
}

export const ShortcutHint: React.FC<ShortcutHintProps> = ({ disabled }) => {
    if (disabled) return null;

    return (
        <p className="wg-composer-hint">
            <span className="wg-kbd">⌘</span> <span className="wg-kbd">↵</span> {t('chat_buttons_send')}
        </p>
    );
};

import React from 'react';
import { t } from '@extension/i18n';

interface AttachedFile {
    name: string;
    content: string;
    type: string;
}

interface AttachmentBarProps {
    attachedFiles: AttachedFile[];
    onRemoveFile: (index: number) => void;
    isDarkMode?: boolean;
}

export const AttachmentBar: React.FC<AttachmentBarProps> = ({ attachedFiles, onRemoveFile }) => {
    if (attachedFiles.length === 0) return null;

    return (
        <ul className="flex flex-wrap gap-1.5 px-3 pt-3">
            {attachedFiles.map((file, index) => (
                <li key={index} className="wg-chip wg-tone-accent">
                    <span className="max-w-[140px] truncate">{file.name}</span>
                    <button
                        type="button"
                        onClick={() => onRemoveFile(index)}
                        aria-label={`Remove ${file.name}`}
                        className="-mr-1 flex size-4 items-center justify-center rounded-full">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-2.5" aria-hidden="true">
                            <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                    </button>
                </li>
            ))}
        </ul>
    );
};

interface RecordingOverlayProps {
    isRecording: boolean;
}

/**
 * Bar heights are fixed rather than random, so the meter reads as a steady level
 * instead of reshuffling itself on every unrelated re-render.
 */
const BAR_HEIGHTS = [40, 72, 96, 60, 84, 52, 92, 68, 44, 76];

export const RecordingOverlay: React.FC<RecordingOverlayProps> = ({ isRecording }) => {
    if (!isRecording) return null;

    return (
        <div
            role="status"
            className="wg-tone-err pointer-events-none absolute inset-x-0 -top-9 z-20 flex h-7 items-center justify-center gap-1">
            {BAR_HEIGHTS.map((h, i) => (
                <span
                    key={i}
                    className="w-0.5 rounded-full"
                    style={{
                        height: `${h}%`,
                        background: 'var(--wg-tone)',
                        animation: `wg-breathe 1.1s var(--wg-ease) ${i * 0.08}s infinite`,
                    }}
                />
            ))}
            <span className="wg-label ml-2" style={{ color: 'var(--wg-tone)' }}>
                {t('chat_stt_recording_stop')}
            </span>
        </div>
    );
};

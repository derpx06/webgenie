import React from 'react';
import { FaPaperclip } from 'react-icons/fa';

interface AttachedFile {
    name: string;
    content: string;
    type: string;
}

interface AttachmentBarProps {
    attachedFiles: AttachedFile[];
    onRemoveFile: (index: number) => void;
    isDarkMode: boolean;
}

export const AttachmentBar: React.FC<AttachmentBarProps> = ({ attachedFiles, onRemoveFile, isDarkMode }) => {
    if (attachedFiles.length === 0) return null;

    return (
        <div className={`flex flex-wrap gap-2 px-5 pb-2 pt-5 ${isDarkMode ? 'bg-black/10' : 'bg-slate-50/50'}`}>
            {attachedFiles.map((file, index) => (
                <div key={index} className={`group/file flex items-center gap-2 rounded-xl px-3 py-1.5 text-[11px] font-black tracking-tight transition-all hover:scale-105 ${isDarkMode ? 'bg-indigo-500/10 text-indigo-300 ring-1 ring-white/5 hover:bg-indigo-500/20' : 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100/50 hover:bg-indigo-100'}`}>
                    <FaPaperclip className="opacity-50 transition-transform group-hover/file:rotate-12" size={10} />
                    <span className="max-w-[140px] truncate font-outfit uppercase">{file.name}</span>
                    <button
                        type="button"
                        onClick={() => onRemoveFile(index)}
                        className="ml-1 flex size-4 items-center justify-center rounded-full p-0.5 transition-colors hover:bg-black/10 hover:text-red-500"
                    >
                        <span className="text-[10px]">✕</span>
                    </button>
                </div>
            ))}
        </div>
    );
};

interface RecordingOverlayProps {
    isRecording: boolean;
}

export const RecordingOverlay: React.FC<RecordingOverlayProps> = ({ isRecording }) => {
    if (!isRecording) return null;

    return (
        <div className="pointer-events-none absolute -inset-x-2 -top-12 z-50 flex h-10 items-center justify-center gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                <div
                    key={i}
                    className="w-1 animate-[bounce_1s_ease-in-out_infinite] rounded-full bg-red-500"
                    style={{
                        height: `${Math.random() * 100 + 20}%`,
                        animationDelay: `${i * 0.1}s`,
                        boxShadow: '0 0 10px rgba(239, 68, 68, 0.5)'
                    }}
                />
            ))}
            <span className="ml-3 animate-pulse text-[10px] font-black uppercase tracking-widest text-red-500">Recording...</span>
        </div>
    );
};

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FaMicrophone, FaPaperclip } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { AttachmentBar, RecordingOverlay } from './chat-input/Visuals';
import { ChatActionButtons, ShortcutHint } from './chat-input/Controls';
import { TabMentionsDropdown } from './chat-input/TabMentionsDropdown';
import type { Tab } from './chat-input/TabMentionsDropdown';

interface Mention {
  id: number;
  title: string;
  url: string;
}

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string) => void;
  onStopTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
  historicalSessionId?: string | null;
  onReplay?: (sessionId: string) => void;
}

interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

import { useChatInput } from './chat-input/useChatInput';

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string) => void;
  onStopTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
  historicalSessionId?: string | null;
  onReplay?: (sessionId: string) => void;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onMicClick,
  isRecording = false,
  isProcessingSpeech = false,
  disabled,
  showStopButton,
  setContent,
  isDarkMode = false,
  historicalSessionId,
  onReplay,
}: ChatInputProps) {
  const {
    text,
    attachedFiles,
    showMentions,
    setShowMentions,
    mentionQuery,
    textareaRef,
    fileInputRef,
    isSendButtonDisabled,
    handleTextChange,
    handleMentionSelect,
    handleSubmit,
    handleKeyDown,
    handleFileChange,
    handleRemoveFile,
  } = useChatInput(onSendMessage, setContent, disabled);

  const handleReplay = useCallback(() => {
    if (historicalSessionId && onReplay) onReplay(historicalSessionId);
  }, [historicalSessionId, onReplay]);

  const handleFileSelect = () => fileInputRef.current?.click();

  return (
    <div className="relative px-2 pb-2 pt-0 transition-all duration-500">
      <form onSubmit={handleSubmit} className="group/form relative">
        <RecordingOverlay isRecording={isRecording} />

        {showMentions && (
          <TabMentionsDropdown
            searchQuery={mentionQuery}
            onSelect={handleMentionSelect}
            onClose={() => setShowMentions(false)}
            isDarkMode={isDarkMode}
          />
        )}

        <div className={`relative flex flex-col overflow-hidden rounded-[24px] border transition-all duration-500 ${
          isDarkMode
            ? 'border-white/5 bg-slate-900/40 backdrop-blur-3xl shadow-[0_4px_24px_rgba(0,0,0,0.3)] focus-within:border-indigo-500/30 focus-within:bg-slate-900/60 focus-within:shadow-[0_0_30px_rgba(79,70,229,0.15)]'
            : 'border-slate-200/60 bg-white/70 backdrop-blur-3xl shadow-[0_10px_30px_rgba(79,70,229,0.06)] focus-within:border-indigo-300 focus-within:bg-white focus-within:shadow-[0_15px_40px_rgba(79,70,229,0.1)]'
          } ${disabled ? 'opacity-50 grayscale' : ''}`}>

          <AttachmentBar attachedFiles={attachedFiles} onRemoveFile={handleRemoveFile} isDarkMode={isDarkMode} />

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
            className={`theme-scrollbar font-outfit w-full resize-none border-0 bg-transparent px-6 py-5 text-[15px] font-semibold leading-relaxed tracking-wide transition-all duration-300 focus:border-0 focus:outline-none focus:ring-0 ${
              isDarkMode 
                ? 'text-white placeholder:text-slate-500' 
                : 'text-slate-800 placeholder:text-slate-400'
            }`}
            placeholder={attachedFiles.length > 0 ? 'Add context...' : "Describe a task, workflow, or research objective..."}
          />

          {/* Subtle separator */}
          <div className={`h-[1px] w-full opacity-30 ${isDarkMode ? 'bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent' : 'bg-gradient-to-r from-transparent via-slate-200 to-transparent'}`} />

          <div className={`flex items-center justify-between px-4 py-3 ${isDarkMode ? 'bg-white/[0.01]' : 'bg-slate-50/20'}`}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFileSelect}
                disabled={disabled}
                className={`group rounded-xl p-2.5 transition-all duration-300 ${
                  isDarkMode 
                    ? 'text-slate-400 hover:bg-white/5 hover:text-indigo-300 active:scale-95' 
                    : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 active:scale-95'
                }`}
                title="Attach context">
                <FaPaperclip size={14} className="transition-transform group-hover:rotate-12" />
              </button>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />

              {onMicClick && (
                <div className="group/mic relative">
                  {isRecording && (
                    <div className="absolute inset-0 animate-ping rounded-xl bg-indigo-500/20"></div>
                  )}
                  <button
                    type="button"
                    onClick={onMicClick}
                    disabled={disabled || isProcessingSpeech}
                    className={`group relative z-10 rounded-xl p-2.5 transition-all duration-500 ${
                      isRecording
                        ? 'scale-105 bg-indigo-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.4)]'
                        : isDarkMode 
                          ? 'text-slate-400 hover:bg-white/5 hover:text-indigo-300 active:scale-95' 
                          : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 active:scale-95'
                    }`}>
                    {isProcessingSpeech ?
                      <AiOutlineLoading3Quarters size={14} className="animate-spin" /> :
                      <FaMicrophone size={14} className={isRecording ? 'drop-shadow-md' : 'transition-transform group-hover:scale-110'} />
                    }
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <ChatActionButtons
                showStopButton={showStopButton}
                onStopTask={onStopTask}
                historicalSessionId={historicalSessionId}
                handleReplay={handleReplay}
                isSendButtonDisabled={isSendButtonDisabled}
                isDarkMode={isDarkMode}
              />
            </div>
          </div>
        </div>

        <ShortcutHint isDarkMode={isDarkMode} disabled={disabled} />
      </form >
    </div >
  );
}

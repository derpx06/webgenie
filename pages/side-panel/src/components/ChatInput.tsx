import { useCallback } from 'react';
import { FaMicrophone, FaPaperclip } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { AttachmentBar, RecordingOverlay } from './chat-input/Visuals';
import { ChatActionButtons, ShortcutHint } from './chat-input/Controls';
import { TabMentionsDropdown } from './chat-input/TabMentionsDropdown';
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
    <div className="relative px-3 pb-3 pt-0">
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

        <div className={`relative flex flex-col overflow-hidden rounded-[12px] border transition-all duration-300 ${
          isDarkMode
            ? 'border-white/[0.08] bg-[#0f172a] focus-within:border-[#818cf8]/50'
            : 'border-slate-200 bg-[#F1F5F9] focus-within:border-[#8B5CF6]/50'
          } ${disabled && !showStopButton ? 'pointer-events-none opacity-40' : ''}`}>

          <AttachmentBar attachedFiles={attachedFiles} onRemoveFile={handleRemoveFile} isDarkMode={isDarkMode} />

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
            className={`w-full resize-none border-0 bg-transparent px-4 pb-2 pt-3 font-sans text-[12.5px] font-normal leading-relaxed tracking-normal transition-all focus:border-0 focus:outline-none focus:ring-0 ${
              isDarkMode
                ? 'text-slate-100 placeholder:text-slate-500'
                : 'text-slate-900 placeholder:text-slate-400'
            }`}
            placeholder={attachedFiles.length > 0 ? 'Add context or instructions...' : 'Describe your task or research goal…'}
          />

          {/* Separator */}
          <div className={`mx-4 h-[0.5px] ${isDarkMode ? 'bg-white/[0.06]' : 'bg-slate-200'}`} />

          {/* Action bar — no background, fully unified */}
          <div className="flex items-center justify-between px-3 py-1.5">
            {/* Left tools */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handleFileSelect}
                disabled={disabled}
                className={`flex size-7 items-center justify-center rounded-[5px] transition-all duration-200 ${
                  isDarkMode
                    ? 'text-slate-500 hover:bg-white/[0.05] hover:text-slate-300 active:scale-95'
                    : 'text-slate-400 hover:bg-slate-200/50 hover:text-slate-700 active:scale-95'
                }`}
                title="Attach file">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />

              {onMicClick && (
                <div className="group/mic relative">
                  {isRecording && (
                    <div className="absolute inset-0 animate-ping rounded-[5px] bg-[#8B5CF6]/20" />
                  )}
                  <button
                    type="button"
                    onClick={onMicClick}
                    disabled={disabled || isProcessingSpeech}
                    className={`relative z-10 flex size-7 items-center justify-center rounded-[5px] transition-all duration-300 ${
                      isRecording
                        ? 'bg-[#8B5CF6] text-white shadow-sm shadow-[#8B5CF6]/30'
                        : isDarkMode
                          ? 'text-slate-500 hover:bg-white/[0.05] hover:text-slate-300 active:scale-95'
                          : 'text-slate-400 hover:bg-slate-200/50 hover:text-slate-700 active:scale-95'
                    }`}>
                    {isProcessingSpeech ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3 animate-spin">
                        <line x1="12" y1="2" x2="12" y2="6" />
                        <line x1="12" y1="18" x2="12" y2="22" />
                        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                        <line x1="2" y1="12" x2="6" y2="12" />
                        <line x1="18" y1="12" x2="22" y2="12" />
                        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Right: send/stop/replay */}
            <div className="flex items-center gap-2">
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
      </form>
    </div>
  );
}

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
    <div className="relative px-4 pb-4 pt-0">
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

        <div className={`relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-300 ${
          isDarkMode
            ? 'border-white/[0.07] bg-slate-900/60 focus-within:border-indigo-500/30'
            : 'border-slate-200/80 bg-white/95 focus-within:border-indigo-300'
          } ${disabled ? 'pointer-events-none opacity-40' : ''}`}>

          <AttachmentBar attachedFiles={attachedFiles} onRemoveFile={handleRemoveFile} isDarkMode={isDarkMode} />

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={2}
            style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
            className={`w-full resize-none border-0 bg-transparent px-5 pb-2 pt-4 font-outfit text-[14px] font-medium leading-relaxed tracking-tight transition-all focus:border-0 focus:outline-none focus:ring-0 ${
              isDarkMode
                ? 'text-slate-100 placeholder:text-slate-600/80'
                : 'text-slate-900 placeholder:text-slate-400'
            }`}
            placeholder={attachedFiles.length > 0 ? 'Add context or instructions...' : 'Describe your task or research goal…'}
          />

          {/* Separator */}
          <div className={`mx-4 h-px ${isDarkMode ? 'bg-white/[0.05]' : 'bg-slate-100'}`} />

          {/* Action bar — no background, fully unified */}
          <div className="flex items-center justify-between px-3 py-2">
            {/* Left tools */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handleFileSelect}
                disabled={disabled}
                className={`flex size-8 items-center justify-center rounded-lg transition-all duration-200 ${
                  isDarkMode
                    ? 'text-slate-600 hover:bg-white/5 hover:text-slate-400 active:scale-90'
                    : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:scale-90'
                }`}
                title="Attach file">
                <FaPaperclip size={12} />
              </button>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />

              {onMicClick && (
                <div className="group/mic relative">
                  {isRecording && (
                    <div className="absolute inset-0 animate-ping rounded-lg bg-indigo-500/20" />
                  )}
                  <button
                    type="button"
                    onClick={onMicClick}
                    disabled={disabled || isProcessingSpeech}
                    className={`relative z-10 flex size-8 items-center justify-center rounded-lg transition-all duration-300 ${
                      isRecording
                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                        : isDarkMode
                          ? 'text-slate-600 hover:bg-white/5 hover:text-slate-400 active:scale-90'
                          : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:scale-90'
                    }`}>
                    {isProcessingSpeech
                      ? <AiOutlineLoading3Quarters size={12} className="animate-spin" />
                      : <FaMicrophone size={12} />
                    }
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

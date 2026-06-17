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

        {/* Wrap only the input container and its glow underlay to make glow equal in all directions */}
        <div className="relative">
          {/* ── Rotating colorful radiant glow underlay ── */}
          <div className="premium-glow-underlay" />

          {/* ── Rotating conic-gradient border wrapper ── */}
          <div className={`premium-rotate-wrapper ${disabled && !showStopButton ? 'pointer-events-none opacity-40' : ''}`}>
            <div
              className="premium-inner-input relative flex flex-col overflow-hidden"
            >

              <AttachmentBar attachedFiles={attachedFiles} onRemoveFile={handleRemoveFile} isDarkMode={isDarkMode} />

              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                rows={2}
                style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
                className={`w-full resize-none border-0 bg-transparent px-5 pb-2 pt-4 font-sans text-[14px] font-medium leading-relaxed tracking-tight transition-all focus:border-0 focus:outline-none focus:ring-0 ${
                  isDarkMode
                    ? 'text-slate-100 placeholder:text-slate-500/70'
                    : 'text-slate-900 placeholder:text-slate-400'
                }`}
                placeholder={attachedFiles.length > 0 ? 'Add context or instructions...' : 'Ask WebGenie to research, browse, automate, or analyze…'}
              />

              {/* Separator */}
              <div className={`mx-4 h-px ${isDarkMode ? 'bg-white/[0.06]' : 'bg-slate-900/[0.05]'}`} />

              {/* Action bar */}
              <div className="flex items-center justify-between px-3 py-2">
                {/* Left tools */}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={handleFileSelect}
                    disabled={disabled}
                    className={`flex size-8 items-center justify-center rounded-lg transition-all duration-200 ${
                      isDarkMode
                        ? 'hover:bg-white/8 text-slate-500 hover:text-slate-300 active:scale-90'
                        : 'text-slate-400 hover:bg-slate-900/5 hover:text-slate-700 active:scale-90'
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
                              ? 'hover:bg-white/8 text-slate-500 hover:text-slate-300 active:scale-90'
                              : 'text-slate-400 hover:bg-slate-900/5 hover:text-slate-700 active:scale-90'
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
                    isSendButtonDisabled={isSendButtonDisabled}
                    isDarkMode={isDarkMode}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <ShortcutHint isDarkMode={isDarkMode} disabled={disabled} />
      </form>
    </div>
  );
}

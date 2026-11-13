import { t } from '@extension/i18n';
import { AttachmentBar, RecordingOverlay } from './chat-input/Visuals';
import { ChatActionButtons, ShortcutHint } from './chat-input/Controls';
import { TabMentionsDropdown } from './chat-input/TabMentionsDropdown';
import { useChatInput, type UploadFile } from './chat-input/useChatInput';

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string, secrets?: string[], files?: UploadFile[]) => void;
  onStopTask: () => void;
  onPauseTask: () => void;
  onResumeTask: () => void;
  isPaused: boolean;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
}

const glyph = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'size-4',
  'aria-hidden': true,
};

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onPauseTask,
  onResumeTask,
  isPaused,
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

  return (
    <form onSubmit={handleSubmit} className="relative">
      <RecordingOverlay isRecording={isRecording} />

      {showMentions && (
        <TabMentionsDropdown
          searchQuery={mentionQuery}
          onSelect={handleMentionSelect}
          onClose={() => setShowMentions(false)}
          isDarkMode={isDarkMode}
        />
      )}

      <div className="wg-composer-box" data-disabled={disabled && !showStopButton}>
        <AttachmentBar attachedFiles={attachedFiles} onRemoveFile={handleRemoveFile} />

        <label htmlFor="wg-composer-text" className="sr-only">
          {t('chat_input_editor')}
        </label>
        <textarea
          id="wg-composer-text"
          ref={textareaRef}
          className="wg-composer-text"
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={2}
          placeholder={showStopButton ? t('chat_input_steer_placeholder') : t('chat_input_placeholder')}
        />

        <div className="wg-composer-bar">
          <button
            type="button"
            className="wg-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            aria-label={t('chat_input_form')}
            title={t('chat_input_form')}>
            <svg {...glyph}>
              <path d="M13 7.5 8.2 12.3a2.8 2.8 0 0 1-4-4l5-5a1.9 1.9 0 0 1 2.7 2.7l-5 5a1 1 0 0 1-1.4-1.4l4.5-4.5" />
            </svg>
          </button>
          <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />

          {onMicClick && (
            <button
              type="button"
              className={`wg-icon-btn ${isRecording ? 'wg-icon-btn-active' : ''}`}
              onClick={onMicClick}
              disabled={disabled || isProcessingSpeech}
              aria-pressed={isRecording}
              aria-label={isRecording ? t('chat_stt_recording_stop') : t('chat_stt_input_start')}
              title={isRecording ? t('chat_stt_recording_stop') : t('chat_stt_input_start')}>
              {isProcessingSpeech ? (
                <svg {...glyph} className="size-4 animate-spin">
                  <path d="M8 2a6 6 0 1 1-4.2 1.7" />
                </svg>
              ) : (
                <svg {...glyph}>
                  <rect x="6" y="2" width="4" height="7" rx="2" />
                  <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" />
                </svg>
              )}
            </button>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <ChatActionButtons
              showStopButton={showStopButton}
              onStopTask={onStopTask}
              isPaused={isPaused}
              onPauseTask={onPauseTask}
              onResumeTask={onResumeTask}
              isSendButtonDisabled={isSendButtonDisabled}
            />
          </div>
        </div>
      </div>

      <ShortcutHint disabled={disabled} />
    </form>
  );
}

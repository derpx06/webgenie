import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@extension/i18n';
import { Actors, generalSettingsStore } from '@extension/storage';
import ChatHistoryList from './components/ChatHistoryList';
import ChatInput from './components/ChatInput';
import DataDisclosure from './components/DataDisclosure';
import EmptyChat from './components/EmptyChat';
import MessageList from './components/MessageList';
import { ResumableNotice } from './components/message-list/SystemNotice';
import SidePanelHeader from './components/SidePanelHeader';
import { AgentSight } from './components/AgentSight';
import { TaskStatus } from './components/TaskStatus';
import WelcomeScreen from './components/WelcomeScreen';
import { useSidePanelController } from './hooks/useSidePanelController';
import { useStickyScroll } from './hooks/useStickyScroll';
import { extractCurrentPageDomForTesting } from './devtools/domDebug';

declare global {
  interface Window {
    extractCurrentPageDomForTesting?: typeof extractCurrentPageDomForTesting;
  }
}

const SidePanel = () => {
  const {
    messages,
    inputEnabled,
    showStopButton,
    isPaused,
    pausedReason,
    resumableTask,
    showHistory,
    chatSessions,
    isDarkMode,
    hasConfiguredModels,
    isRecording,
    isProcessingSpeech,
    lastScreenshot,
    taskProgress,
    setInputTextRef,
    handleSendMessage,
    handleStopTask,
    handlePauseTask,
    handleResumeTask,
    handleResumeSavedTask,
    handleDiscardSavedTask,
    handleMicClick,
    handleNewChat,
    handleLoadHistory,
    handleBackToChat,
    handleSessionSelect,
    handleSessionDelete,
    handleSessionBookmark,
  } = useSidePanelController();

  const pendingOmniboxPrompt = useRef<string | null>(null);
  const [isDebugExtractingDom, setIsDebugExtractingDom] = useState(false);
  const { scrollRef, endRef, isPinned, jumpToLatest } = useStickyScroll(messages);

  // What the panel is working on: the newest thing the person asked for.
  const goal = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].actor === Actors.USER) return messages[i].content;
    }
    return null;
  }, [messages]);

  const handleDebugExtractDom = useCallback(async () => {
    setIsDebugExtractingDom(true);
    try {
      await extractCurrentPageDomForTesting();
    } finally {
      setIsDebugExtractingDom(false);
    }
  }, []);

  useEffect(() => {
    window.extractCurrentPageDomForTesting = extractCurrentPageDomForTesting;
    return () => {
      delete window.extractCurrentPageDomForTesting;
    };
  }, []);

  useEffect(() => {
    const PENDING_KEY = 'pendingOmniboxPrompt';

    const storePrompt = (prompt: string) => {
      if (!prompt.trim()) return;
      chrome.storage.session.remove(PENDING_KEY);
      pendingOmniboxPrompt.current = prompt.trim();
    };

    chrome.storage.session.get(PENDING_KEY, result => {
      const pending = result?.[PENDING_KEY];
      if (typeof pending === 'string') storePrompt(pending);
    });

    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session') return;
      const newValue = changes[PENDING_KEY]?.newValue;
      if (typeof newValue === 'string') {
        storePrompt(newValue);
        if (hasConfiguredModels === true) {
          const prompt = pendingOmniboxPrompt.current;
          pendingOmniboxPrompt.current = null;
          if (prompt) handleSendMessage(prompt);
        }
      }
    };

    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [hasConfiguredModels, handleSendMessage]);

  useEffect(() => {
    if (hasConfiguredModels === true && pendingOmniboxPrompt.current) {
      const prompt = pendingOmniboxPrompt.current;
      pendingOmniboxPrompt.current = null;
      handleSendMessage(prompt);
    }
  }, [hasConfiguredModels, handleSendMessage]);

  // Whether the notice shown before the first task has been read. Null until the store answers, so the panel never
  // flashes the notice at someone who already accepted it.
  const [disclosureAccepted, setDisclosureAccepted] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => generalSettingsStore.getSettings().then(settings => setDisclosureAccepted(settings.dataDisclosureAcceptedAt !== null));
    void read();
    return generalSettingsStore.subscribe(() => void read());
  }, []);

  const composer = (
    <ChatInput
      onSendMessage={handleSendMessage}
      onStopTask={handleStopTask}
      onPauseTask={handlePauseTask}
      onResumeTask={handleResumeTask}
      isPaused={isPaused}
      onMicClick={handleMicClick}
      isRecording={isRecording}
      isProcessingSpeech={isProcessingSpeech}
      disabled={!inputEnabled}
      showStopButton={showStopButton}
      setContent={setter => {
        setInputTextRef.current = setter;
      }}
      isDarkMode={isDarkMode}
    />
  );

  return (
    <div className={`wg-root wg-shell ${isDarkMode ? 'theme-dark' : 'theme-light'}`}>
      {(hasConfiguredModels === true || showHistory) && (
        <SidePanelHeader
          isDarkMode={isDarkMode}
          showHistory={showHistory}
          onBackToChat={() => handleBackToChat(false)}
          onNewChat={handleNewChat}
          onLoadHistory={handleLoadHistory}
        />
      )}

      {showHistory ? (
        <div className="wg-scroll">
          <ChatHistoryList
            sessions={chatSessions}
            onSessionSelect={handleSessionSelect}
            onSessionDelete={handleSessionDelete}
            onSessionBookmark={handleSessionBookmark}
            visible={true}
            isDarkMode={isDarkMode}
          />
        </div>
      ) : hasConfiguredModels === null ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="wg-meta">{t('status_checkingConfig')}</p>
        </div>
      ) : hasConfiguredModels === false ? (
        <WelcomeScreen isDarkMode={isDarkMode} onOpenSettings={() => chrome.runtime.openOptionsPage()} />
      ) : disclosureAccepted === false ? (
        <DataDisclosure
          isDarkMode={isDarkMode}
          onAccept={() => void generalSettingsStore.updateSettings({ dataDisclosureAcceptedAt: Date.now() })}
        />
      ) : messages.length === 0 ? (
        <EmptyChat
          isDarkMode={isDarkMode}
          recentSessions={chatSessions}
          isDebugExtractingDom={isDebugExtractingDom}
          onDebugExtractDom={handleDebugExtractDom}
          onSelectPrompt={text => setInputTextRef.current?.(text)}
          onSelectSession={handleSessionSelect}>
          <div className="wg-composer">
            {resumableTask && (
              <div className="mb-3">
                <ResumableNotice
                  task={resumableTask}
                  isDarkMode={isDarkMode}
                  onResume={handleResumeSavedTask}
                  onDiscard={handleDiscardSavedTask}
                />
              </div>
            )}
            {composer}
          </div>
        </EmptyChat>
      ) : (
        <>
          <TaskStatus
            progress={taskProgress}
            goal={goal}
            isPaused={isPaused}
            pausedReason={pausedReason}
          />

          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="wg-scroll" ref={scrollRef}>
              <MessageList
                messages={messages}
                isDarkMode={isDarkMode}
                onOptionSelect={handleSendMessage}
                isTaskRunning={showStopButton}
                runPhase={taskProgress.phase}
                pausedReason={pausedReason}
                resumableTask={resumableTask}
                onResumeSavedTask={handleResumeSavedTask}
                onDiscardSavedTask={handleDiscardSavedTask}
              />
              <div ref={endRef} />
            </div>

            {!isPinned && (
              <button type="button" className="wg-btn wg-btn-quiet wg-jump" onClick={jumpToLatest}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
                  <path d="M8 3v10M4 9l4 4 4-4" />
                </svg>
                {t('trail_jumpToLatest')}
              </button>
            )}

            <AgentSight screenshot={lastScreenshot} isActive={showStopButton} />
          </div>

          <div className="wg-composer">{composer}</div>
        </>
      )}
    </div>
  );
};

export default SidePanel;

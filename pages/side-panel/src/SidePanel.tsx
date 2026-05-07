import { useEffect, useRef } from 'react';
import { t } from '@extension/i18n';
import ChatHistoryList from './components/ChatHistoryList';
import ChatInput from './components/ChatInput';
import EmptyChat from './components/EmptyChat';
import MessageList from './components/MessageList';
import SidePanelHeader from './components/SidePanelHeader';
import { AgentSight } from './components/AgentSight';
import WelcomeScreen from './components/WelcomeScreen';
import { useSidePanelController } from './hooks/useSidePanelController';
import { NeuralBackground } from './components/shared/NeuralBackground';

const SidePanel = () => {
  const {
    messages,
    inputEnabled,
    showStopButton,
    currentSessionId,
    showHistory,
    chatSessions,
    isHistoricalSession,
    isDarkMode,
    hasConfiguredModels,
    isRecording,
    isProcessingSpeech,
    lastScreenshot,
    replayEnabled,
    messagesEndRef,
    setInputTextRef,
    handleSendMessage,
    handleStopTask,
    handleMicClick,
    handleReplay,
    handleNewChat,
    handleLoadHistory,
    handleBackToChat,
    handleSessionSelect,
    handleSessionDelete,
    handleSessionBookmark,
  } = useSidePanelController();

  // Declare chrome API types
  const pendingOmniboxPrompt = useRef<string | null>(null);

  useEffect(() => {
    const PENDING_KEY = 'pendingOmniboxPrompt';

    const storePrompt = (prompt: string) => {
      if (!prompt.trim()) return;
      chrome.storage.session.remove(PENDING_KEY);
      pendingOmniboxPrompt.current = prompt.trim();
    };

    chrome.storage.session.get(PENDING_KEY, (result) => {
      const pending = result?.[PENDING_KEY];
      if (typeof pending === 'string') storePrompt(pending);
    });

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
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

  return (
    <div className="ws-app-container">
      <div className={`relative flex h-screen flex-col overflow-hidden ${isDarkMode ? 'theme-dark bg-slate-950' : 'theme-light bg-slate-50'}`}>
        <NeuralBackground isDarkMode={isDarkMode} />
        <SidePanelHeader
          isDarkMode={isDarkMode}
          showHistory={showHistory}
          onBackToChat={() => handleBackToChat(false)}
          onNewChat={handleNewChat}
          onLoadHistory={handleLoadHistory}
        />

        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              onSessionBookmark={handleSessionBookmark}
              visible={true}
              isDarkMode={isDarkMode}
            />
          </div>
        ) : (
          <>
            {hasConfiguredModels === null && (
              <div className={`flex flex-1 items-center justify-center p-8 ${isDarkMode ? 'text-sky-300' : 'text-sky-600'}`}>
                <div className="text-center">
                  <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"></div>
                  <p>{t('status_checkingConfig')}</p>
                </div>
              </div>
            )}

            {hasConfiguredModels === false && (
              <WelcomeScreen isDarkMode={isDarkMode} onOpenSettings={() => chrome.runtime.openOptionsPage()} />
            )}

            {hasConfiguredModels === true && (
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {messages.length === 0 ? (
                  <EmptyChat
                    isDarkMode={isDarkMode}
                    onSelectPrompt={text => {
                      if (setInputTextRef.current) {
                        setInputTextRef.current(text);
                      }
                    }}>
                    <ChatInput
                      onSendMessage={handleSendMessage}
                      onStopTask={handleStopTask}
                      onMicClick={handleMicClick}
                      isRecording={isRecording}
                      isProcessingSpeech={isProcessingSpeech}
                      disabled={!inputEnabled}
                      showStopButton={showStopButton}
                      setContent={setter => {
                        setInputTextRef.current = setter;
                      }}
                      isDarkMode={isDarkMode}
                      historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                      onReplay={handleReplay}
                    />
                  </EmptyChat>
                ) : (
                  <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                    {/* AgentSight: floating circle, only in active chat */}
                    <AgentSight screenshot={lastScreenshot} isActive={showStopButton} />

                    <div className="ws-body relative z-10 min-h-0 flex-1 overflow-y-auto">
                      <MessageList messages={messages} isDarkMode={isDarkMode} onOptionSelect={handleSendMessage} />
                      <div ref={messagesEndRef} />
                    </div>

                    <div
                      className={`relative z-20 shrink-0 border-t px-2 pb-2 pt-4 transition-all duration-300 ${isDarkMode
                        ? 'border-white/5 bg-slate-950/80 backdrop-blur-xl'
                        : 'border-slate-200 bg-white/80 backdrop-blur-xl'
                        }`}>
                      <ChatInput
                        onSendMessage={handleSendMessage}
                        onStopTask={handleStopTask}
                        onMicClick={handleMicClick}
                        isRecording={isRecording}
                        isProcessingSpeech={isProcessingSpeech}
                        disabled={!inputEnabled}
                        showStopButton={showStopButton}
                        setContent={setter => {
                          setInputTextRef.current = setter;
                        }}
                        isDarkMode={isDarkMode}
                        historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                        onReplay={handleReplay}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SidePanel;

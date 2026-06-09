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
import { TabOrchestrator } from './components/TabOrchestrator';

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
    <div className={`relative flex h-screen w-screen flex-col overflow-hidden p-1.5 ${isDarkMode ? 'theme-dark bg-[#040813]' : 'theme-light bg-[#F1F5F9]'}`}>
      <div className={`flex flex-1 flex-col overflow-hidden rounded-[14px] border border-solid shadow-2xl transition-all duration-300 ${isDarkMode ? 'border-white/[0.08] bg-[#020617]' : 'border-slate-200/80 bg-white'}`}>
        <NeuralBackground isDarkMode={isDarkMode} />
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
                    recentSessions={chatSessions.slice(0, 3)}
                    onSelectPrompt={text => {
                      if (setInputTextRef.current) {
                        setInputTextRef.current(text);
                      }
                    }}>
                    <div className="relative z-20 shrink-0 px-2 pb-2 pt-4">
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
                  </EmptyChat>
                ) : (
                  <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                    {/* AgentSight: floating circle, only in active chat */}
                    <AgentSight screenshot={lastScreenshot} isActive={showStopButton} />

                    {/* TabOrchestrator: live workflow panel — only renders when tasks are active */}
                    <TabOrchestrator isDarkMode={isDarkMode} />

                    <div className="ws-body relative z-10 min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                      <MessageList messages={messages} isDarkMode={isDarkMode} onOptionSelect={handleSendMessage} isTaskRunning={showStopButton} />
                      <div ref={messagesEndRef} />
                    </div>

                    <div className={`relative z-20 shrink-0 border-t px-2 pb-2 pt-3 transition-all duration-300 ${isDarkMode
                      ? 'border-white/5 bg-slate-950/80 backdrop-blur-xl'
                      : 'border-slate-100 bg-white/85 backdrop-blur-xl'
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

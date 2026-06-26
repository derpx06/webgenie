/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useRef, useEffect } from 'react';
import { chatHistoryStore } from '@extension/storage';

import { useTheme } from './useTheme';
import { useConfig } from './useConfig';
import { useChatSession } from './useChatSession';
import { useAgentConnection } from './useAgentConnection';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useFavoritePrompts } from './useFavoritePrompts';
import { useTaskExecution } from './useTaskExecution';

/**
 * useSidePanelController is the main orchestrator for the Side Panel UI.
 * It serves as a centralized hub that aggregates multiple specialized hooks (theme, config, session, connection, etc.)
 * and exposes a unified API to the view components.
 * 
 * Responsibilities include:
 * - Managing shared UI states (loading, replaying, history visibility).
 * - Coordinating task execution and communication.
 * - Handling session persistence and history navigation.
 */
export const useSidePanelController = () => {
  // UI State that didn't fit elsewhere
  const [inputEnabled, setInputEnabled] = useState(true);
  const [showStopButton, setShowStopButton] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [isWaitingForHuman, setIsWaitingForHuman] = useState(false);
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);

  // Refs for specific UI components
  const setInputTextRef = useRef<((text: string) => void) | null>(null);

  // Use specialized hooks
  const { isDarkMode } = useTheme();
  const { hasConfiguredModels } = useConfig();
  const {
    favoritePrompts,
    handleBookmarkUpdateTitle,
    handleBookmarkDelete,
    handleBookmarkReorder,
    addFavoritePrompt
  } = useFavoritePrompts();

  const {
    messages,
    currentSessionId,
    sessionIdRef,
    chatSessions,
    isFollowUpMode,
    setIsFollowUpMode,
    isHistoricalSession,
    setIsHistoricalSession,
    messagesEndRef,
    appendMessage,
    loadChatSessions,
    handleSessionSelect: loadSessionFromHistory,
    handleSessionDelete,
    createNewSession,
    resetSession,
  } = useChatSession();

  const {
    portRef,
    isReplayingRef,
    setupConnection,
    stopConnection,
    sendMessage
  } = useAgentConnection({
    appendMessage,
    setIsFollowUpMode,
    setInputEnabled,
    setShowStopButton,
    setIsReplaying,
    setIsHistoricalSession,
    setIsProcessingSpeech,
    setIsWaitingForHuman,
    setLastScreenshot,
    setInputTextRef,
  });

  const { isRecording, handleMicClick } = useSpeechRecognition({
    appendMessage,
    setIsProcessingSpeech,
    setInputTextRef,
  });

  // Keep replaying ref in sync
  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying, isReplayingRef]);

  const {
    handleSendMessage,
    handleStopTask,
  } = useTaskExecution({
    portRef,
    sessionIdRef,
    isHistoricalSession,
    isFollowUpMode,
    appendMessage,
    createNewSession,
    setupConnection,
    sendMessage,
    setInputEnabled,
    setShowStopButton,
    setIsFollowUpMode,
    setIsHistoricalSession,
    setIsReplaying,
    isWaitingForHuman,
    setIsWaitingForHuman,
  });

  /**
   * Resets the current view and background connection to start a fresh interaction.
   */
  const handleNewChat = useCallback(() => {
    resetSession();
    setInputEnabled(true);
    setShowStopButton(false);
    stopConnection();
  }, [resetSession, stopConnection]);

  // Auto-load sessions on mount so welcome page can show recent history
  useEffect(() => {
    loadChatSessions();
  }, [loadChatSessions]);

  const handleLoadHistory = useCallback(async () => {
    await loadChatSessions();
    setShowHistory(true);
  }, [loadChatSessions]);

  const handleBackToChat = useCallback((reset = false) => {
    setShowHistory(false);
    if (reset) resetSession();
  }, [resetSession]);

  const handleSessionSelect = useCallback(async (sessionId: string) => {
    const success = await loadSessionFromHistory(sessionId);
    if (success) setShowHistory(false);
  }, [loadSessionFromHistory]);

  const handleSessionBookmark = useCallback(
    async (sessionId: string) => {
      try {
        const fullSession = await chatHistoryStore.getSession(sessionId);
        if (fullSession && fullSession.messages.length > 0) {
          const sessionTitle = fullSession.title;
          const title = sessionTitle.split(' ').slice(0, 8).join(' ');
          const taskContent = fullSession.messages[0]?.content || '';
          await addFavoritePrompt(title, taskContent);
          handleBackToChat(true);
        }
      } catch (error) {
        console.error('Failed to pin session to favorites:', error);
      }
    },
    [addFavoritePrompt, handleBackToChat],
  );

  const handleBookmarkSelect = useCallback((content: string) => {
    if (setInputTextRef.current) setInputTextRef.current(content);
  }, []);

  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, [stopConnection]);

  return {
    messages,
    inputEnabled,
    showStopButton,
    currentSessionId,
    showHistory,
    chatSessions,
    isHistoricalSession,
    isDarkMode,
    favoritePrompts,
    hasConfiguredModels,
    isRecording,
    isProcessingSpeech,
    lastScreenshot,
    messagesEndRef,
    setInputTextRef,
    handleSendMessage,
    handleStopTask,
    handleMicClick,
    handleNewChat,
    handleLoadHistory,
    handleBackToChat,
    handleSessionSelect,
    handleSessionDelete,
    handleSessionBookmark,
    handleBookmarkSelect,
    handleBookmarkUpdateTitle,
    handleBookmarkDelete,
    handleBookmarkReorder,
  };
};

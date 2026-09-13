/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useRef, useEffect } from 'react';
import { chatHistoryStore, type ChatSessionMetadata } from '@extension/storage';

import { useTheme } from './useTheme';
import { useConfig } from './useConfig';
import { useChatSession } from './useChatSession';
import { useAgentConnection } from './useAgentConnection';
import type { ResumableTask } from './useAgentConnection';
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
  // Why the running task is paused, or null while it is not paused.
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [resumableTask, setResumableTask] = useState<ResumableTask | null>(null);
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
    sendMessage,
    requestReattach,
  } = useAgentConnection({
    appendMessage,
    setIsFollowUpMode,
    setInputEnabled,
    setShowStopButton,
    setIsReplaying,
    setIsHistoricalSession,
    setIsProcessingSpeech,
    setIsWaitingForHuman,
    setPausedReason,
    setResumableTask,
    setLastScreenshot,
    setInputTextRef,
    sessionIdRef,
    isTaskActive: showStopButton || isWaitingForHuman,
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
    handlePauseTask,
    handleResumeTask,
    handleResumeSavedTask: resumeSavedTask,
    handleDiscardSavedTask,
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
    setPausedReason,
    resumableTask,
    setResumableTask,
  });

  // Connect as soon as the panel opens. No chat is open yet, so ask about the most recently used session: a task
  // interrupted while the panel was closed belongs to it, and its Resume notice then shows without any typing.
  useEffect(() => {
    setupConnection();
    chatHistoryStore
      .getSessionsMetadata()
      .then(sessions => {
        const latest = sessions.reduce<ChatSessionMetadata | null>(
          (newest, session) => (!newest || session.updatedAt > newest.updatedAt ? session : newest),
          null,
        );
        if (latest && !sessionIdRef.current) requestReattach(latest.id);
      })
      .catch(error => console.error('Failed to look up the latest session:', error));
  }, [setupConnection, requestReattach, sessionIdRef]);

  /** Resumes the offered saved task inside its own session, loading that session if another view is showing. */
  const handleResumeSavedTask = useCallback(async () => {
    if (resumableTask && sessionIdRef.current !== resumableTask.taskId) {
      await loadSessionFromHistory(resumableTask.taskId);
    }
    await resumeSavedTask();
  }, [loadSessionFromHistory, resumableTask, resumeSavedTask, sessionIdRef]);

  /**
   * Resets the current view and background connection to start a fresh interaction.
   */
  const handleNewChat = useCallback(() => {
    // A running or waiting task is cancelled first rather than left running out of sight.
    if (showStopButton || isWaitingForHuman) void handleStopTask();
    resetSession();
    setInputEnabled(true);
    setShowStopButton(false);
    setPausedReason(null);
    setResumableTask(null);
    stopConnection();
  }, [handleStopTask, isWaitingForHuman, resetSession, showStopButton, stopConnection]);

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
    if (success) {
      setShowHistory(false);
      // The opened session may have a saved task to continue.
      requestReattach(sessionId);
    }
  }, [loadSessionFromHistory, requestReattach]);

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
    isPaused: pausedReason !== null,
    pausedReason,
    resumableTask,
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
    handleBookmarkSelect,
    handleBookmarkUpdateTitle,
    handleBookmarkDelete,
    handleBookmarkReorder,
  };
};

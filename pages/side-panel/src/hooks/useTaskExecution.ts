import { useCallback } from 'react';
import { Actors, type Message } from '@extension/storage';
import { t } from '@extension/i18n';
import type { ResumableTask } from './useAgentConnection';

type OutgoingMessage = Record<string, unknown>;
type UiMessage = Pick<Message, 'actor' | 'content' | 'timestamp'>;

interface UseTaskExecutionProps {
    portRef: React.MutableRefObject<chrome.runtime.Port | null>;
    sessionIdRef: React.MutableRefObject<string | null>;
    isHistoricalSession: boolean;
    isFollowUpMode: boolean;
    appendMessage: (message: UiMessage, sessionId?: string) => void;
    createNewSession: (title: string) => Promise<string>;
    setupConnection: () => void;
    sendMessage: (message: OutgoingMessage) => void;
    setInputEnabled: (enabled: boolean) => void;
    setShowStopButton: (show: boolean) => void;
    setIsFollowUpMode: (mode: boolean) => void;
    setIsHistoricalSession: (historical: boolean) => void;
    setIsReplaying: (replaying: boolean) => void;
    isWaitingForHuman: boolean;
    setIsWaitingForHuman: (waiting: boolean) => void;
    setPausedReason: (reason: string | null) => void;
    resumableTask: ResumableTask | null;
    setResumableTask: (task: ResumableTask | null) => void;
}

const getActiveTabId = async (): Promise<number> => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error('No active tab found');
    return tabId;
};

/**
 * Hook that encapsulates all logic for executing tasks, handling commands, and replaying sessions.
 * It manages the communication between the Side Panel UI and the Background Engine.
 *
 * @param props Configuration and state setters from the controller.
 * @returns Object containing handles for sending messages, stopping tasks, and replaying history.
 */
export const useTaskExecution = ({
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
}: UseTaskExecutionProps) => {

    const reportError = useCallback(
        (err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            appendMessage({ actor: Actors.SYSTEM, content: errorMessage, timestamp: Date.now() });
        },
        [appendMessage],
    );

    /** Sends a control message to the background; returns false (and says why in the chat) if it could not. */
    const postControl = useCallback(
        (message: OutgoingMessage): boolean => {
            try {
                if (!portRef.current) setupConnection();
                sendMessage(message);
                return true;
            } catch (err) {
                reportError(err);
                return false;
            }
        },
        [portRef, reportError, sendMessage, setupConnection],
    );

    /**
     * Processes slash commands (e.g., /state) typed into the chat input.
     *
     * @param command The raw command string.
     * @returns True if the command was recognized and handled, false otherwise.
     */
    const handleCommand = useCallback(
        async (command: string): Promise<boolean> => {
            // ... implementation
            try {
                if (!portRef.current) setupConnection();

                if (command === '/state') {
                    sendMessage({ type: 'state' });
                    return true;
                }

                if (command === '/nohighlight') {
                    sendMessage({ type: 'nohighlight' });
                    return true;
                }

                appendMessage({
                    actor: Actors.SYSTEM,
                    content: t('errors_cmd_unknown', command),
                    timestamp: Date.now(),
                });
                return true;
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                appendMessage({ actor: Actors.SYSTEM, content: errorMessage, timestamp: Date.now() });
                return true;
            }
        },
        [appendMessage, portRef, setupConnection, sendMessage],
    );

    /**
     * Dispatches a new user message or follow-up task to the background agent.
     *
     * @param text The message text.
     * @param displayText Optional text to display in the UI (if different from execution text).
     */
    const handleSendMessage = useCallback(
        async (text: string, displayText?: string, secrets?: string[]) => {
            // ... implementation
            const trimmedText = text.trim();
            if (!trimmedText) return;

            if (trimmedText.startsWith('/')) {
                const wasHandled = await handleCommand(trimmedText);
                if (wasHandled) return;
            }

            if (isHistoricalSession) {
                setIsHistoricalSession(false);
                setIsFollowUpMode(true);
            }

            try {
                const tabId = await getActiveTabId();

                setInputEnabled(false);
                setShowStopButton(true);
                // Sending something else moves on from a saved-task offer.
                setResumableTask(null);

                if (isWaitingForHuman) {
                    const userMessage = {
                        actor: Actors.USER,
                        content: displayText || text,
                        timestamp: Date.now(),
                    };
                    appendMessage(userMessage, sessionIdRef.current ?? undefined);

                    if (!portRef.current) setupConnection();

                    await sendMessage({
                        type: 'human_response',
                        response: text,
                        secrets: secrets ?? [],
                    });
                    setIsWaitingForHuman(false);
                    return;
                }

                if (!isFollowUpMode) {
                    const titleText = displayText || text;
                    await createNewSession(titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''));
                }

                const userMessage = {
                    actor: Actors.USER,
                    content: displayText || text,
                    timestamp: Date.now(),
                };

                appendMessage(userMessage, sessionIdRef.current ?? undefined);

                if (!portRef.current) setupConnection();

                const taskType = isFollowUpMode ? 'follow_up_task' : 'new_task';
                await sendMessage({
                    type: taskType,
                    task: text,
                    taskId: sessionIdRef.current ?? undefined,
                    tabId,
                });
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                appendMessage({ actor: Actors.SYSTEM, content: errorMessage, timestamp: Date.now() });
                setInputEnabled(true);
                setShowStopButton(false);
            }
        },
        [appendMessage, handleCommand, isFollowUpMode, isHistoricalSession, isWaitingForHuman, sendMessage, setupConnection, createNewSession, sessionIdRef, portRef, setInputEnabled, setShowStopButton, setIsFollowUpMode, setIsHistoricalSession, setIsWaitingForHuman, setResumableTask],
    );

    /**
     * Sends a cancellation command to the background agent to stop the current task.
     */
    const handleStopTask = useCallback(async () => {
        // Immediately reflect cancellation intent in UI instead of waiting for roundtrip events.
        setShowStopButton(false);
        setInputEnabled(true);
        setIsWaitingForHuman(false);
        setIsReplaying(false);
        setIsFollowUpMode(false);
        setPausedReason(null);

        try {
            if (!portRef.current) setupConnection();
            sendMessage({ type: 'cancel_task' });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            appendMessage({ actor: Actors.SYSTEM, content: errorMessage, timestamp: Date.now() });
        }
    }, [
        appendMessage,
        portRef,
        sendMessage,
        setInputEnabled,
        setIsFollowUpMode,
        setPausedReason,
        setIsReplaying,
        setIsWaitingForHuman,
        setShowStopButton,
        setupConnection,
    ]);

    /** Pauses the running task. Shown as paused right away; the task.pause event then gives the reason. */
    const handlePauseTask = useCallback(() => {
        if (postControl({ type: 'pause_task' })) setPausedReason(t('exec_task_pause'));
    }, [postControl, setPausedReason]);

    const handleResumeTask = useCallback(() => {
        if (postControl({ type: 'resume_task' })) setPausedReason(null);
    }, [postControl, setPausedReason]);

    /** Continues the saved task offered by `task_resumable` in the active tab. */
    const handleResumeSavedTask = useCallback(async () => {
        if (!resumableTask) return;
        let tabId: number;
        try {
            tabId = await getActiveTabId();
        } catch (err) {
            reportError(err);
            return;
        }
        if (!postControl({ type: 'resume_saved_task', taskId: resumableTask.taskId, tabId })) return;

        setResumableTask(null);
        setPausedReason(null);
        setIsHistoricalSession(false);
        // A task that was waiting for an answer takes the next message as that answer, as after act.ask_human.
        const waitingForAnswer = resumableTask.status === 'waiting_human';
        setIsWaitingForHuman(waitingForAnswer);
        setInputEnabled(waitingForAnswer);
        setShowStopButton(!waitingForAnswer);
    }, [
        postControl,
        reportError,
        resumableTask,
        setInputEnabled,
        setIsHistoricalSession,
        setPausedReason,
        setIsWaitingForHuman,
        setResumableTask,
        setShowStopButton,
    ]);

    const handleDiscardSavedTask = useCallback(() => {
        if (!resumableTask) return;
        if (postControl({ type: 'discard_saved_task', taskId: resumableTask.taskId })) setResumableTask(null);
    }, [postControl, resumableTask, setResumableTask]);

    return {
        handleSendMessage,
        handleStopTask,
        handleCommand,
        handlePauseTask,
        handleResumeTask,
        handleResumeSavedTask,
        handleDiscardSavedTask,
    };
};

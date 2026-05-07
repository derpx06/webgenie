import { useCallback } from 'react';
import { Actors, chatHistoryStore, type Message } from '@extension/storage';
import { t } from '@extension/i18n';

type OutgoingMessage = Record<string, unknown>;
type UiMessage = Pick<Message, 'actor' | 'content' | 'timestamp'>;

interface UseTaskExecutionProps {
    portRef: React.MutableRefObject<chrome.runtime.Port | null>;
    sessionIdRef: React.MutableRefObject<string | null>;
    replayEnabled: boolean;
    isHistoricalSession: boolean;
    isFollowUpMode: boolean;
    appendMessage: (message: UiMessage, sessionId?: string) => void;
    setMessages: (messages: Message[]) => void;
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
}

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
    replayEnabled,
    isHistoricalSession,
    isFollowUpMode,
    appendMessage,
    setMessages,
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
}: UseTaskExecutionProps) => {

    /**
     * Handles the replay of a historical session.
     * Loads the history from storage and sends a replay command to the background agent.
     * 
     * @param historySessionId The ID of the session to replay.
     */
    const handleReplay = useCallback(
        async (historySessionId: string): Promise<void> => {
            // ... implementation
            try {
                if (!replayEnabled) {
                    appendMessage({ actor: Actors.SYSTEM, content: t('chat_replay_disabled'), timestamp: Date.now() });
                    return;
                }

                const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
                if (!historyData) {
                    appendMessage({
                        actor: Actors.SYSTEM,
                        content: t('chat_replay_noHistory', historySessionId.substring(0, 20)),
                        timestamp: Date.now(),
                    });
                    return;
                }

                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const tabId = tabs[0]?.id;
                if (!tabId) throw new Error('No active tab found');

                if (isHistoricalSession) setMessages([]);

                const newTaskId = await createNewSession(`Replay of ${historySessionId.substring(0, 20)}...`);

                setInputEnabled(false);
                setShowStopButton(true);
                setIsFollowUpMode(false);
                setIsHistoricalSession(false);

                const userMessage = {
                    actor: Actors.USER,
                    content: `/replay ${historySessionId}`,
                    timestamp: Date.now(),
                };
                appendMessage(userMessage, sessionIdRef.current ?? undefined);

                if (!portRef.current) setupConnection();

                sendMessage({
                    type: 'replay',
                    taskId: newTaskId,
                    tabId,
                    historySessionId,
                    task: historyData.task,
                });

                appendMessage({
                    actor: Actors.SYSTEM,
                    content: t('chat_replay_starting', historyData.task),
                    timestamp: Date.now(),
                });
                setIsReplaying(true);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                appendMessage({
                    actor: Actors.SYSTEM,
                    content: t('chat_replay_failed', errorMessage),
                    timestamp: Date.now(),
                });
            }
        },
        [appendMessage, isHistoricalSession, replayEnabled, setupConnection, createNewSession, sessionIdRef, portRef, sendMessage, setMessages, setIsFollowUpMode, setIsHistoricalSession, setIsReplaying, setInputEnabled, setShowStopButton],
    );

    /**
     * Processes slash commands (e.g., /replay, /state) typed into the chat input.
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

                if (command.startsWith('/replay ')) {
                    const parts = command.split(' ').filter(part => part.trim() !== '');
                    if (parts.length !== 2) {
                        appendMessage({ actor: Actors.SYSTEM, content: t('chat_replay_invalidArgs'), timestamp: Date.now() });
                        return true;
                    }
                    await handleReplay(parts[1]);
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
        [appendMessage, handleReplay, setupConnection, sendMessage],
    );

    /**
     * Dispatches a new user message or follow-up task to the background agent.
     * 
     * @param text The message text.
     * @param displayText Optional text to display in the UI (if different from execution text).
     */
    const handleSendMessage = useCallback(
        async (text: string, displayText?: string) => {
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
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const tabId = tabs[0]?.id;
                if (!tabId) throw new Error('No active tab found');

                setInputEnabled(false);
                setShowStopButton(true);

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
        [appendMessage, handleCommand, isFollowUpMode, isHistoricalSession, isWaitingForHuman, sendMessage, setupConnection, createNewSession, sessionIdRef, portRef, setInputEnabled, setShowStopButton, setIsWaitingForHuman],
    );

    /**
     * Sends a cancellation command to the background agent to stop the current task.
     */
    const handleStopTask = useCallback(async () => {
        try {
            sendMessage({ type: 'cancel_task' });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            appendMessage({ actor: Actors.SYSTEM, content: errorMessage, timestamp: Date.now() });
        }
        setInputEnabled(true);
    }, [appendMessage, sendMessage, setInputEnabled]);

    return { handleSendMessage, handleStopTask, handleReplay, handleCommand };
};

import { useCallback, useEffect, useRef } from 'react';
import { Actors, type Message } from '@extension/storage';
import { EventType } from '../types/event';
import type { AgentEvent } from '../types/event';
import { t } from '@extension/i18n';
import { useAgentEventHandler } from './useAgentEventHandler';

/** A saved task of this chat session that the background can continue (`task_resumable`). */
export interface ResumableTask {
    taskId: string;
    task: string;
    status: 'paused' | 'waiting_human' | 'running';
    question?: string;
}

interface UseAgentConnectionProps {
    appendMessage: (message: Message) => void;
    setIsFollowUpMode: (mode: boolean) => void;
    setInputEnabled: (enabled: boolean) => void;
    setShowStopButton: (show: boolean) => void;
    setIsReplaying: (replaying: boolean) => void;
    setIsHistoricalSession: (historical: boolean) => void;
    setIsProcessingSpeech: (processing: boolean) => void;
    setIsWaitingForHuman: (waiting: boolean) => void;
    /** Why the task is paused (shown as a notice), or null when it is not paused. */
    setPausedReason: (reason: string | null) => void;
    setResumableTask: (task: ResumableTask | null) => void;
    setLastScreenshot: (screenshot: string | null) => void;
    setInputTextRef: React.MutableRefObject<((text: string) => void) | null>;
    sessionIdRef: React.MutableRefObject<string | null>;
    /** A task is running or waiting for the user: a dropped port is retried instead of resetting the UI. */
    isTaskActive: boolean;
}

type RuntimeMessage = {
    type?: string;
    error?: string;
    text?: string;
    taskId?: string;
};

// Waits between reconnect attempts after the port drops mid-task; the panel gives up after the last one.
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

// Commands that start, steer or end the task. An error answering one of them means no task is running; an error
// for anything else (a slash command, reattach) leaves a running task's UI alone.
const TASK_COMMANDS = new Set(['new_task', 'follow_up_task', 'human_response', 'pause_task', 'resume_task', 'cancel_task', 'resume_saved_task']);
// Replies that settle the task command awaiting a result (task commands without a `success` reply emit events).
const COMMAND_REPLIES = new Set<string>(['success', 'error', EventType.EXECUTION, 'task_resumable', 'reattach_none']);

/**
 * useAgentConnection manages a robust, long-lived communication channel (Chrome Port)
 * between the Side Panel and the Background Service Worker.
 *
 * It handles:
 * - Establishing and tearing down connections.
 * - Heartbeat/keep-alive logic to prevent Service Worker hibernation.
 * - Reconnecting with backoff when the port drops during a task, then asking the background to reattach.
 * - Routing specific message types (execution events, errors, speech-to-text, saved tasks) to their handlers.
 */
export const useAgentConnection = ({
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
    isTaskActive,
}: UseAgentConnectionProps) => {
    const portRef = useRef<chrome.runtime.Port | null>(null);
    const heartbeatIntervalRef = useRef<number | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const reconnectAttemptRef = useRef(0);
    const pendingTaskCommandRef = useRef(false);
    const isTaskActiveRef = useRef(isTaskActive);
    const isReplayingRef = useRef<boolean>(false);

    useEffect(() => {
        isTaskActiveRef.current = isTaskActive;
    }, [isTaskActive]);

    const { handleTaskState } = useAgentEventHandler({
        appendMessage,
        setIsFollowUpMode,
        setInputEnabled,
        setShowStopButton,
        setIsReplaying,
        setIsHistoricalSession,
        setIsWaitingForHuman,
        setPausedReason,
        setLastScreenshot,
        isReplayingRef
    });

    const resetToIdle = useCallback(() => {
        setInputEnabled(true);
        setShowStopButton(false);
        setIsWaitingForHuman(false);
        setPausedReason(null);
    }, [setInputEnabled, setShowStopButton, setIsWaitingForHuman, setPausedReason]);

    const stopConnection = useCallback(() => {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
        }
        if (portRef.current) {
            portRef.current.disconnect();
            portRef.current = null;
        }
    }, []);

    /** Opens the port. `reattach` asks the background to pick this session's task back up after a drop. */
    const setupConnection = useCallback((reattach = false) => {
        if (portRef.current) return;

        // The port is gone: retry while a task is active, otherwise (or once retries run out) go idle.
        const retryOrReset = () => {
            const delay = RECONNECT_DELAYS_MS[reconnectAttemptRef.current];
            if (isTaskActiveRef.current && delay !== undefined) {
                reconnectAttemptRef.current += 1;
                reconnectTimerRef.current = window.setTimeout(() => {
                    reconnectTimerRef.current = null;
                    setupConnection(true);
                }, delay);
                return;
            }
            if (isTaskActiveRef.current) {
                appendMessage({ actor: Actors.SYSTEM, content: t('errors_conn_lost'), timestamp: Date.now() });
            }
            reconnectAttemptRef.current = 0;
            resetToIdle();
        };

        try {
            const port = chrome.runtime.connect({ name: 'side-panel-connection' });
            portRef.current = port;
            port.onMessage.addListener((message: unknown) => {
                // Any message proves the background is back, so a later drop gets a fresh set of retries.
                reconnectAttemptRef.current = 0;
                const runtimeMessage = (message ?? {}) as RuntimeMessage;
                const awaitedTaskCommand = pendingTaskCommandRef.current;
                if (COMMAND_REPLIES.has(runtimeMessage.type ?? '')) pendingTaskCommandRef.current = false;

                if (runtimeMessage.type === EventType.EXECUTION) handleTaskState(message as AgentEvent);
                else if (runtimeMessage.type === 'error') {
                    appendMessage({ actor: Actors.SYSTEM, content: runtimeMessage.error || t('errors_unknown'), timestamp: Date.now() });
                    if (awaitedTaskCommand || !isTaskActiveRef.current) resetToIdle();
                } else if (runtimeMessage.type === 'task_resumable') {
                    const saved = message as Partial<ResumableTask>;
                    // An offer for another chat session does not belong in this one.
                    if (typeof saved.taskId !== 'string') return;
                    if (sessionIdRef.current && saved.taskId !== sessionIdRef.current) return;
                    setResumableTask({
                        taskId: saved.taskId,
                        task: saved.task ?? '',
                        status: saved.status ?? 'paused',
                        question: saved.question,
                    });
                    // Nothing runs in the background until the user resumes the saved task.
                    resetToIdle();
                } else if (runtimeMessage.type === 'reattach_none') {
                    // Nothing to resume or run for this session: stop showing it as running or waiting.
                    if (runtimeMessage.taskId === sessionIdRef.current && isTaskActiveRef.current) resetToIdle();
                } else if (runtimeMessage.type === 'speech_to_text_result') {
                    if (runtimeMessage.text && setInputTextRef.current) setInputTextRef.current(runtimeMessage.text);
                    setIsProcessingSpeech(false);
                } else if (runtimeMessage.type === 'speech_to_text_error') {
                    appendMessage({ actor: Actors.SYSTEM, content: runtimeMessage.error || t('chat_stt_recognitionFailed'), timestamp: Date.now() });
                    setIsProcessingSpeech(false);
                }
            });

            // Fires when the background end goes away (worker restart, extension update), never for our own disconnect().
            port.onDisconnect.addListener(() => {
                portRef.current = null;
                stopConnection();
                retryOrReset();
            });

            // Keep-Alive Loop: Service Workers in MV3 are ephemeral.
            // Injects a periodic 'heartbeat' message to ensure the worker stays active during long tasks.
            if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = window.setInterval(() => {
                if (portRef.current?.name === 'side-panel-connection') {
                    try { portRef.current.postMessage({ type: 'heartbeat' }); }
                    catch (e) { stopConnection(); }
                } else stopConnection();
            }, 25000); // 25s window (Chrome hibernation threshold is ~30s)

            if (reattach && sessionIdRef.current) port.postMessage({ type: 'reattach', taskId: sessionIdRef.current });
        } catch (error) {
            portRef.current = null;
            if (reattach) retryOrReset();
            else appendMessage({ actor: Actors.SYSTEM, content: t('errors_conn_serviceWorker'), timestamp: Date.now() });
        }
    }, [handleTaskState, appendMessage, stopConnection, resetToIdle, setResumableTask, setIsProcessingSpeech, setInputTextRef, sessionIdRef]);

    const sendMessage = useCallback((message: Record<string, unknown>) => {
        if (portRef.current?.name !== 'side-panel-connection') throw new Error('No valid connection available');
        portRef.current.postMessage(message);
        if (TASK_COMMANDS.has(String(message.type))) pendingTaskCommandRef.current = true;
    }, []);

    /** Asks the background whether `taskId` has a task to show: it answers with events, `task_resumable` or `reattach_none`. */
    const requestReattach = useCallback((taskId: string) => {
        setupConnection();
        try {
            sendMessage({ type: 'reattach', taskId });
        } catch (err) {
            // No port: setupConnection has already reported the failure.
        }
    }, [setupConnection, sendMessage]);

    return { portRef, isReplayingRef, setupConnection, stopConnection, sendMessage, requestReattach };
};

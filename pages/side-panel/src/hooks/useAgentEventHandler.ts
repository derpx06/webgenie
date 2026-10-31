import { useCallback } from 'react';
import { Actors, type Message } from '@extension/storage';
import { t } from '@extension/i18n';
import { ExecutionState, IDLE_PROGRESS, type AgentEvent, type TaskPhase, type TaskProgress } from '../types/event';

/**
 * The phase an event puts the agent in, or undefined when the event says nothing about it.
 * Every branch here mirrors one the message switch below already handles, so the status bar
 * and the chat can never disagree about what is going on.
 */
const phaseOf = (actor: Actors, state: ExecutionState): TaskPhase | undefined => {
    if (actor === Actors.SYSTEM) {
        if (state === ExecutionState.TASK_START) return 'starting';
        if (state === ExecutionState.TASK_OK) return 'done';
        if (state === ExecutionState.TASK_FAIL) return 'failed';
        if (state === ExecutionState.TASK_CANCEL) return 'cancelled';
        if (state === ExecutionState.TASK_PAUSE) return 'paused';
        if (state === ExecutionState.TASK_RESUME) return 'acting';
        return undefined;
    }
    if (state === ExecutionState.ACT_ASK_HUMAN) return 'waiting_human';
    if (actor === Actors.PLANNER && state === ExecutionState.STEP_START) return 'planning';
    if (actor === Actors.NAVIGATOR) {
        if (state === ExecutionState.STEP_START || state === ExecutionState.ACT_START) return 'acting';
        // The action landed; the executor is now reading the page for the next step.
        if (state === ExecutionState.ACT_OK || state === ExecutionState.STEP_OK) return 'observing';
        if (state === ExecutionState.ACT_FAIL || state === ExecutionState.STEP_FAIL) return 'acting';
    }
    return undefined;
};

interface UseAgentEventHandlerProps {
    appendMessage: (message: Message) => void;
    setTaskProgress: (progress: TaskProgress | ((prev: TaskProgress) => TaskProgress)) => void;
    setIsFollowUpMode: (mode: boolean) => void;
    setInputEnabled: (enabled: boolean) => void;
    setShowStopButton: (show: boolean) => void;
    setIsReplaying: (replaying: boolean) => void;
    setIsHistoricalSession: (historical: boolean) => void;
    setIsWaitingForHuman: (waiting: boolean) => void;
    setPausedReason: (reason: string | null) => void;
    setLastScreenshot: (screenshot: string | null) => void;
    isReplayingRef: React.MutableRefObject<boolean>;
}

/**
 * Hook responsible for translating raw agent execution events into UI state changes.
 * This acts as a reducer-like layer that decides which events to display as messages,
 * when to enable/disable input, and how to update the task lifecycle state.
 *
 * @param props Configuration and state setters from the connection hook.
 * @returns Object containing the handleTaskState event processor.
 */
export const useAgentEventHandler = ({
    appendMessage,
    setTaskProgress,
    setIsFollowUpMode,
    setInputEnabled,
    setShowStopButton,
    setIsReplaying,
    setIsHistoricalSession,
    setIsWaitingForHuman,
    setPausedReason,
    setLastScreenshot,
    isReplayingRef,
}: UseAgentEventHandlerProps) => {

    /**
     * Processes an incoming AgentEvent and updates the relevant UI states.
     * It maps execution states (START, OK, FAIL, CANCEL) to visual feedback and interaction rules.
     *
     * @param event The agent execution event received from the background engine.
     */
    const handleTaskState = useCallback((event: AgentEvent) => {
        const { actor, state, timestamp, data, screenshot } = event;
        let content = data?.details;
        const progressMessage = 'Showing progress...';
        let skip = true;
        let displayProgress = false;

        if (screenshot) {
            setLastScreenshot(screenshot);
            if (state === ExecutionState.SIGHT_UPDATE) return; // Special handling for sight-only updates
        }

        // Keep the status bar current before anything decides whether this event is worth a message.
        // The step numbers only ever move forward within a task, so a late event cannot rewind them.
        const phase = phaseOf(actor, state);
        setTaskProgress(prev => {
            if (state === ExecutionState.TASK_START) return { ...IDLE_PROGRESS, phase: 'starting' };
            const step = data?.step ?? 0;
            const maxSteps = data?.maxSteps ?? 0;
            return {
                phase: phase ?? prev.phase,
                step: step > 0 ? Math.max(step, prev.step) : prev.step,
                maxSteps: maxSteps > 0 ? maxSteps : prev.maxSteps,
                detail: content || prev.detail,
            };
        });

        // Enhance rate limit message clarity
        if (content && (content.includes('429') || content.toLowerCase().includes('rate limit') || content.toLowerCase().includes('quota'))) {
            content = `API limit exceeded: ${content}`;
        }

        switch (actor) {
            case Actors.SYSTEM:
                if (state === ExecutionState.TASK_START) {
                    setIsHistoricalSession(false);
                    setPausedReason(null);
                } else if (state === ExecutionState.TASK_OK || state === ExecutionState.TASK_FAIL) {
                    setIsFollowUpMode(true);
                    setInputEnabled(true);
                    setShowStopButton(false);
                    setIsReplaying(false);
                    setIsWaitingForHuman(false);
                    setPausedReason(null);
                    // Don't clear screenshot here so user can see final result
                    skip = false;
                } else if (state === ExecutionState.TASK_CANCEL) {
                    setIsFollowUpMode(false);
                    setInputEnabled(true);
                    setShowStopButton(false);
                    setIsReplaying(false);
                    setIsWaitingForHuman(false);
                    setPausedReason(null);
                    skip = false;
                } else if (state === ExecutionState.TASK_PAUSE) {
                    // Paused by the user or by an interruption (tab closed, debugger detached, answer deadline):
                    // show why as a notice, not an answer, and keep Stop and Resume available.
                    setPausedReason(content || t('exec_task_pause'));
                    setShowStopButton(true);
                } else if (state === ExecutionState.TASK_RESUME) {
                    // The task carries on; nothing to show in the chat.
                    setIsWaitingForHuman(false);
                    setPausedReason(null);
                }
                break;
            case Actors.PLANNER:
                if (state === ExecutionState.STEP_START) displayProgress = true;
                else if (state === ExecutionState.STEP_OK || state === ExecutionState.STEP_FAIL) skip = false;
                break;
            case Actors.NAVIGATOR:
                if (state === ExecutionState.STEP_START) displayProgress = true;
                else if (state === ExecutionState.STEP_OK) displayProgress = false;
                else if (state === ExecutionState.STEP_FAIL) { skip = false; displayProgress = false; }
                else if (state === ExecutionState.ACT_ASK_HUMAN) {
                    setIsFollowUpMode(true);
                    setInputEnabled(true);
                    setShowStopButton(false);
                    setIsWaitingForHuman(true);
                    appendMessage({ actor: Actors.HITL, content: content || '', timestamp });
                    return;
                }
                else if (state === ExecutionState.ACT_START) skip = false;
                else if (state === ExecutionState.ACT_OK) skip = !isReplayingRef.current;
                else if (state === ExecutionState.ACT_FAIL) skip = false;
                break;
            case Actors.VALIDATOR:
                if (state === ExecutionState.STEP_START) displayProgress = true;
                else if (state === ExecutionState.STEP_OK || state === ExecutionState.STEP_FAIL) skip = false;
                break;
        }

        if (!skip) {
            appendMessage({
                actor,
                content: content || '',
                timestamp,
                isFailed: actor === Actors.SYSTEM && state === ExecutionState.TASK_FAIL,
                isCancelled: actor === Actors.SYSTEM && state === ExecutionState.TASK_CANCEL,
            });
        }
        if (displayProgress) appendMessage({ actor, content: progressMessage, timestamp });
    }, [appendMessage, setTaskProgress, setIsFollowUpMode, setInputEnabled, setShowStopButton, setIsReplaying, setIsHistoricalSession, setIsWaitingForHuman, setPausedReason, setLastScreenshot, isReplayingRef]);

    return { handleTaskState };
};

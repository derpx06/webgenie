import { useCallback } from 'react';
import { Actors, type Message } from '@extension/storage';
import { ExecutionState, type AgentEvent } from '../types/event';

interface UseAgentEventHandlerProps {
    appendMessage: (message: Message) => void;
    setIsFollowUpMode: (mode: boolean) => void;
    setInputEnabled: (enabled: boolean) => void;
    setShowStopButton: (show: boolean) => void;
    setIsReplaying: (replaying: boolean) => void;
    setIsHistoricalSession: (historical: boolean) => void;
    setIsWaitingForHuman: (waiting: boolean) => void;
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
    setIsFollowUpMode,
    setInputEnabled,
    setShowStopButton,
    setIsReplaying,
    setIsHistoricalSession,
    setIsWaitingForHuman,
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

        // Enhance rate limit message clarity
        if (content && (content.includes('429') || content.toLowerCase().includes('rate limit') || content.toLowerCase().includes('quota'))) {
            content = `⚠️ API Limit Exceeded: ${content}`;
        }

        switch (actor) {
            case Actors.SYSTEM:
                if (state === ExecutionState.TASK_START) setIsHistoricalSession(false);
                else if (state === ExecutionState.TASK_OK || state === ExecutionState.TASK_FAIL) {
                    setIsFollowUpMode(true);
                    setInputEnabled(true);
                    setShowStopButton(false);
                    setIsReplaying(false);
                    setIsWaitingForHuman(false);
                    // Don't clear screenshot here so user can see final result
                    skip = false;
                } else if (state === ExecutionState.TASK_CANCEL) {
                    setIsFollowUpMode(false);
                    setInputEnabled(true);
                    setShowStopButton(false);
                    setIsReplaying(false);
                    setIsWaitingForHuman(false);
                    skip = false;
                } else if (state === ExecutionState.TASK_RESUME) {
                    setIsWaitingForHuman(false);
                    skip = false;
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
                else if (state === ExecutionState.ACT_START && content !== 'cache_content') skip = false;
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
    }, [appendMessage, setIsFollowUpMode, setInputEnabled, setShowStopButton, setIsReplaying, setIsHistoricalSession, setIsWaitingForHuman, setLastScreenshot, isReplayingRef]);

    return { handleTaskState };
};

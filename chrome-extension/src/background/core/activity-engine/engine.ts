/**
 * Activity Engine
 *
 * Subscribes to the existing AgentEvent stream and translates execution
 * lifecycle events into semantic tab state / workflow stage transitions.
 *
 * This is the intelligence hub that keeps TabRegistry synchronized with
 * what the AI agent is actually doing at every moment.
 *
 * Key responsibilities:
 * - Map ExecutionState → WorkflowStage → visual glow color
 * - Update TabRegistry with the active tab's current stage
 * - Broadcast enriched AGENT_STATUS messages to content scripts
 * - Handle task completion cleanup (mark tabs complete, close ephemeral ones)
 */

import { createLogger } from '../../log';
import type { TabRegistry } from '../tab-registry/registry';
import type { TaskGroupManager } from '../task-groups/manager';
import {
  ExecutionState,
  Actors,
} from '../../agent/event/types';
import type { AgentEvent } from '../../agent/event/types';
import {
  TabState,
  WorkflowStage,
  tabOrchestrationStore,
} from '@extension/storage';
import type { GeneralSettingsConfig } from '@extension/storage';

const logger = createLogger('ActivityEngine');

// ---------------------------------------------------------------------------
// ExecutionState → WorkflowStage mapping
// ---------------------------------------------------------------------------

function deriveWorkflowStage(event: AgentEvent): WorkflowStage {
  const { actor, state, data } = event;
  const details = (data?.details ?? '').toLowerCase();

  switch (state) {
    case ExecutionState.TASK_START:
    case ExecutionState.STEP_START:
      if (actor === Actors.PLANNER) return WorkflowStage.PLANNING;
      return WorkflowStage.RESEARCHING;

    case ExecutionState.ACT_START: {
      // Infer from action details string (navigator action names)
      if (details.includes('type') || details.includes('input') || details.includes('fill'))
        return WorkflowStage.TYPING;
      if (details.includes('click') || details.includes('scroll') || details.includes('select'))
        return WorkflowStage.CLICKING;
      if (details.includes('navigate') || details.includes('goto') || details.includes('open'))
        return WorkflowStage.RESEARCHING;
      if (details.includes('extract') || details.includes('compare') || details.includes('read'))
        return WorkflowStage.COMPARING;
      return WorkflowStage.RESEARCHING;
    }

    case ExecutionState.ACT_ASK_HUMAN:
      return WorkflowStage.WAITING;

    case ExecutionState.TASK_PAUSE:
      return WorkflowStage.WAITING;

    case ExecutionState.TASK_OK:
    case ExecutionState.STEP_OK:
    case ExecutionState.ACT_OK:
      return WorkflowStage.COMPLETED;

    case ExecutionState.TASK_FAIL:
    case ExecutionState.STEP_FAIL:
    case ExecutionState.ACT_FAIL:
      return WorkflowStage.ERROR;

    case ExecutionState.TASK_CANCEL:
      return WorkflowStage.IDLE;

    default:
      return WorkflowStage.RESEARCHING;
  }
}

function isTerminalState(state: ExecutionState): boolean {
  return (
    state === ExecutionState.TASK_OK ||
    state === ExecutionState.TASK_FAIL ||
    state === ExecutionState.TASK_CANCEL
  );
}

// ---------------------------------------------------------------------------
// Activity Engine class
// ---------------------------------------------------------------------------

export class ActivityEngine {
  private readonly _registry: TabRegistry;
  private readonly _groupManager: TaskGroupManager;
  private _currentTaskId: string | null = null;
  private _taskName: string | null = null;
  private _settings: GeneralSettingsConfig | null = null;

  constructor(registry: TabRegistry, groupManager: TaskGroupManager) {
    this._registry = registry;
    this._groupManager = groupManager;
  }

  /** Called by TabOrchestrator when a new task begins. */
  setCurrentTask(taskId: string, taskName: string, settings: GeneralSettingsConfig): void {
    this._currentTaskId = taskId;
    this._taskName = taskName;
    this._settings = settings;
  }

  /**
   * Process an AgentEvent from the executor event stream.
   * This is wired into subscribeExecutionEvents() in background/index.ts.
   */
  async processEvent(event: AgentEvent): Promise<void> {
    const { state, data } = event;
    const taskId = data?.taskId ?? this._currentTaskId;

    const workflowStage = deriveWorkflowStage(event);
    const isActive = !isTerminalState(state);

    // Determine the current active tab from the registry
    const primaryTabs = this._registry.getByState(TabState.PRIMARY_ACTIVE);
    const activeTabId = primaryTabs[0]?.tabId ?? null;

    // Update the active tab's workflow stage in the registry
    if (activeTabId !== null && this._registry.has(activeTabId)) {
      this._registry.update(activeTabId, {
        workflowStage,
        state: isActive ? TabState.PRIMARY_ACTIVE : TabState.COMPLETE,
        lastAction: data?.details ?? '',
      });
    }

    // Broadcast enriched AGENT_STATUS to all tabs
    await this._broadcastAgentStatus(event, activeTabId, workflowStage, isActive);

    // Handle task completion
    if (isTerminalState(state) && taskId) {
      await this._onTaskComplete(taskId, state);
    }

    // Push updated state to storage for side panel
    await this._syncActiveState(activeTabId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _broadcastAgentStatus(
    event: AgentEvent,
    activeTabId: number | null,
    workflowStage: WorkflowStage,
    isActive: boolean,
  ): Promise<void> {
    const showBorder = this._settings?.showAmbientBorder ?? true;
    const showCapsule = this._settings?.showStatusCapsule ?? true;
    const statusText = event.data?.details || 'WebGenie is active...';

    let allTabs: chrome.tabs.Tab[];
    try {
      allTabs = await chrome.tabs.query({});
    } catch {
      return;
    }

    for (const tab of allTabs) {
      if (!tab.id) continue;

      const isTargetTab = !activeTabId || tab.id === activeTabId;

      if (isActive && isTargetTab) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'AGENT_STATUS',
          active: true,
          status: statusText,
          showBorder,
          showCapsule,
          workflowStage,
          taskName: this._taskName ?? undefined,
        }).catch(() => { /* tab may not have content script */ });
      } else {
        chrome.tabs.sendMessage(tab.id, {
          type: 'AGENT_STATUS',
          active: false,
        }).catch(() => { });
      }
    }
  }

  private async _onTaskComplete(taskId: string, state: ExecutionState): Promise<void> {
    logger.info(`ActivityEngine: task ${taskId} completed with state ${state}`);

    const taskTabs = this._registry.getByTaskId(taskId);

    // Mark all tabs for this task as complete (or error)
    const finalTabState = state === ExecutionState.TASK_FAIL ? TabState.ERROR : TabState.COMPLETE;
    for (const tab of taskTabs) {
      this._registry.update(tab.tabId, {
        state: finalTabState,
        workflowStage: state === ExecutionState.TASK_FAIL ? WorkflowStage.ERROR : WorkflowStage.COMPLETED,
      });
    }

    // Auto-close ephemeral tabs if setting is enabled
    if (this._settings?.autoCloseEphemeralTabs) {
      const ephemeral = this._registry.getEphemeral(taskId);
      for (const tab of ephemeral) {
        try {
          await chrome.tabs.remove(tab.tabId);
          logger.info(`ActivityEngine: auto-closed ephemeral tab ${tab.tabId}`);
        } catch {
          // Tab may already be closed
        }
      }
    }

    // Dissolve the chrome tab group for this task.
    // The group UUID is always tg-${taskId} — we cannot use taskTabs[0]?.groupId
    // because that field stores the *chrome native numeric ID*, not the UUID.
    const groupUuid = `tg-${taskId}`;
    try {
      // First mark it grey/collapsed so there's brief visual feedback before it disappears
      await this._groupManager.markGroupComplete(groupUuid);
      // Then fully ungroup the tabs and remove the group record
      await this._groupManager.dissolveGroup(groupUuid);
      logger.info(`ActivityEngine: dissolved tab group ${groupUuid}`);
    } catch (err) {
      logger.warning(`ActivityEngine: failed to dissolve group ${groupUuid}:`, err);
    }

    // Flush registry changes immediately
    await this._registry.flushNow();
  }

  private async _syncActiveState(activeTabId: number | null): Promise<void> {
    try {
      // Find the active group from the active tab
      const activeTab = activeTabId ? this._registry.get(activeTabId) : null;
      const activeGroupId = activeTab?.groupId !== null && activeTab?.groupId !== undefined
        ? String(activeTab.groupId)
        : null;

      await tabOrchestrationStore.setActive(activeTabId, activeGroupId);
    } catch (err) {
      logger.error('ActivityEngine: failed to sync active state:', err);
    }
  }
}

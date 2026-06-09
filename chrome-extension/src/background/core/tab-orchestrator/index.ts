/**
 * Tab Orchestrator — Main Singleton
 *
 * The central coordination point for all tab intelligence in WebGenie.
 * Composes all core modules:
 *   - TabEventBridge   (raw Chrome event normalization)
 *   - TabRegistry      (in-memory + persistent tab state)
 *   - ActivityEngine   (AgentEvent → WorkflowStage translation)
 *   - TaskGroupManager (chrome.tabGroups CRUD)
 *   - TabReuseEngine   (duplicate/reuse detection)
 *
 * Lifecycle:
 *   TabOrchestrator.getInstance().init()  ← call once in background/index.ts
 *   orchestrator.beginTask(taskId, description, settings)  ← on new_task
 *   orchestrator.onAgentEvent(event)  ← wired into subscribeExecutionEvents
 *   orchestrator.dispose()  ← on extension unload (optional, SW auto-cleans)
 *
 * Thread-safety: service workers are single-threaded; no mutex needed.
 */

import { createLogger } from '../../log';
import { TabEventBridge } from '../event-bridge/bridge';
import type { TabUpdatedEvent, TabRemovedEvent } from '../event-bridge/bridge';
import { TabRegistry } from '../tab-registry/registry';
import { ActivityEngine } from '../activity-engine/engine';
import { TaskGroupManager } from '../task-groups/manager';
import { TabReuseEngine } from '../tab-reuse/engine';
import type { AgentEvent } from '../../agent/event/types';
import {
  TabState,
  WorkflowStage,
  tabOrchestrationStore,
  agentModelStore,
  AgentNameEnum,
  llmProviderStore,
  generalSettingsStore,
} from '@extension/storage';
import type { GeneralSettingsConfig } from '@extension/storage';
import { createChatModel } from '../../agent/helper';
import { HumanMessage } from '@langchain/core/messages';

const logger = createLogger('TabOrchestrator');

// ---------------------------------------------------------------------------
// TabOrchestrator
// ---------------------------------------------------------------------------

export class TabOrchestrator {
  private static _instance: TabOrchestrator | null = null;

  private readonly _bridge: TabEventBridge;
  private readonly _registry: TabRegistry;
  private readonly _activityEngine: ActivityEngine;
  private readonly _groupManager: TaskGroupManager;
  private readonly _reuseEngine: TabReuseEngine;

  // Unsubscribe functions for event bridge listeners
  private readonly _unsubscribeFns: Array<() => void> = [];

  // Current task context
  private _currentTaskId: string | null = null;
  private _currentGroupId: string | null = null;
  private _initialized = false;

  private constructor() {
    this._bridge = TabEventBridge.getInstance();
    this._registry = new TabRegistry();
    this._groupManager = new TaskGroupManager();
    this._reuseEngine = new TabReuseEngine(this._registry);
    this._activityEngine = new ActivityEngine(this._registry, this._groupManager);
  }

  static getInstance(): TabOrchestrator {
    if (!TabOrchestrator._instance) {
      TabOrchestrator._instance = new TabOrchestrator();
    }
    return TabOrchestrator._instance;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the orchestrator. Call once when the background service worker starts.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    // Rehydrate tab registry from storage (handles SW restarts)
    await this._registry.restore();

    // Wire up Chrome tab event handlers through the bridge
    this._unsubscribeFns.push(
      this._bridge.subscribe<TabUpdatedEvent>('tab_updated', (evt) => {
        this._onTabUpdated(evt);
      }),
      this._bridge.subscribe<TabRemovedEvent>('tab_removed', (evt) => {
        this._onTabRemoved(evt);
      }),
    );

    logger.info('TabOrchestrator: initialized');
  }

  // ---------------------------------------------------------------------------
  // Task lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Called when a new task begins (new_task or follow_up_task message).
   * Creates a task group, registers the active tab, and wires the activity engine.
   *
   * @param taskId - Session ID (matches chatHistoryStore)
   * @param description - The task description string (used for group title + color)
   * @param settings - Current GeneralSettingsConfig snapshot
   * @param activeTabId - The browser tab where the task starts
   */
  async beginTask(
    taskId: string,
    description: string,
    settings: GeneralSettingsConfig,
    activeTabId?: number,
  ): Promise<void> {
    this._currentTaskId = taskId;
    this._activityEngine.setCurrentTask(taskId, description, settings);

    // Register the initial tab if provided
    if (activeTabId !== undefined) {
      const existing = this._registry.get(activeTabId);
      if (!existing) {
        let tabUrl = '';
        let tabTitle = '';
        try {
          const tab = await chrome.tabs.get(activeTabId);
          tabUrl = tab.url ?? '';
          tabTitle = tab.title ?? '';
        } catch { /* tab may not be accessible */ }

        this._registry.register(activeTabId, taskId, description.substring(0, 60));
        this._registry.update(activeTabId, {
          state: TabState.PRIMARY_ACTIVE,
          workflowStage: WorkflowStage.PLANNING,
          url: tabUrl,
          pageTitle: tabTitle,
        });
        logger.info(`TabOrchestrator: registered tab ${activeTabId} for task ${taskId}`);
      } else {
        // Update existing tab to new task
        this._registry.update(activeTabId, {
          taskId,
          state: TabState.PRIMARY_ACTIVE,
          workflowStage: WorkflowStage.PLANNING,
        });
      }

      // Create chrome.tabGroups group for this task (if grouping enabled)
      if (settings.enableTabGrouping) {
        try {
          // Create the group with standard fallback first to avoid blocking the task execution start
          const group = await this._groupManager.createGroup(taskId, description, [activeTabId]);
          this._currentGroupId = group.groupId;

          // Update tab record with groupId
          this._registry.update(activeTabId, {
            groupId: group.chromeGroupId,
          });

          // Collapse other active groups
          await this._groupManager.collapseInactiveGroups(group.groupId);

          // Asynchronously generate group title to avoid blocking task start on LLM latency/network issues
          this._generateGroupTitle(description).then(async (llmGroupTitle) => {
            if (llmGroupTitle && group.chromeGroupId !== null) {
              try {
                // Update native chrome group title
                await chrome.tabGroups.update(group.chromeGroupId, {
                  title: llmGroupTitle
                });
                // Update in-memory / storage group metadata
                const state = await tabOrchestrationStore.getState();
                const currentGroup = state.groups[group.groupId];
                if (currentGroup) {
                  await tabOrchestrationStore.upsertGroup({
                    ...currentGroup,
                    title: llmGroupTitle
                  });
                }
                logger.info(`TabOrchestrator: updated tab group title to "${llmGroupTitle}"`);
              } catch (err) {
                logger.warning('TabOrchestrator: failed to update group title natively or in store:', err);
              }
            }
          }).catch(err => {
            logger.warning('TabOrchestrator: failed to generate LLM group title asynchronously:', err);
          });
        } catch (err) {
          logger.warning('TabOrchestrator: failed to create tab group:', err);
        }
      }

      await tabOrchestrationStore.setActive(activeTabId, this._currentGroupId);
    }
  }

  private async _generateGroupTitle(taskDescription: string): Promise<string | undefined> {
    try {
      const providers = await llmProviderStore.getAllProviders();
      if (Object.keys(providers).length === 0) return undefined;

      const agentModels = await agentModelStore.getAllAgentModels();
      const plannerModel = agentModels[AgentNameEnum.Planner] ?? agentModels[AgentNameEnum.Navigator];
      if (!plannerModel) return undefined;

      const providerConfig = providers[plannerModel.provider];
      if (!providerConfig) return undefined;

      const generalSettings = await generalSettingsStore.getSettings();
      const chatModel = createChatModel(providerConfig, plannerModel, generalSettings);
      const prompt = [
        new HumanMessage(
          `Create a very short browser tab group title for this task.
Rules:
- 2 to 5 words
- no punctuation except hyphen if needed
- title case
- concise and specific
- output title only

Task:
${taskDescription}`,
        ),
      ];

      const response = await chatModel.invoke(prompt);
      const content = response.content;
      const raw =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : ''))
                .join(' ')
            : '';

      const sanitized = raw
        .replace(/[`"']/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .split('\n')[0]
        .slice(0, 40)
        .trim();

      return sanitized || undefined;
    } catch (error) {
      logger.warning('TabOrchestrator: failed to generate LLM group title, falling back to task text:', error);
      return undefined;
    }
  }

  /**
   * Process an AgentEvent from the executor. Wire this into subscribeExecutionEvents.
   *
   * This replaces the old broadcast logic in background/index.ts — the ActivityEngine
   * handles all AGENT_STATUS broadcasting with richer stage-aware data.
   */
  async onAgentEvent(event: AgentEvent): Promise<void> {
    // Keep the active tab synchronized with browserContext
    // The executor.getCurrentTabId() call is done in background/index.ts and
    // the tabId is updated via updateActiveTab() below.
    await this._activityEngine.processEvent(event);
  }

  /**
   * Update which tab is currently the primary active tab.
   * Called from background/index.ts whenever executor.getCurrentTabId() changes.
   */
  async updateActiveTab(tabId: number | null): Promise<void> {
    if (tabId === null || !this._currentTaskId) return;

    const existing = this._registry.get(tabId);
    if (!existing) {
      // This tab was opened by the agent but not yet registered — register it now
      let tabUrl = '';
      let tabTitle = '';
      try {
        const tab = await chrome.tabs.get(tabId);
        tabUrl = tab.url ?? '';
        tabTitle = tab.title ?? '';
      } catch { /* ignore */ }

      this._registry.register(tabId, this._currentTaskId, 'Navigating...');
      this._registry.update(tabId, {
        state: TabState.PRIMARY_ACTIVE,
        workflowStage: WorkflowStage.RESEARCHING,
        url: tabUrl,
        pageTitle: tabTitle,
      });

      // Add to current group
      if (this._currentGroupId) {
        await this._groupManager.addTabToGroup(this._currentGroupId, tabId);
        this._registry.update(tabId, { groupId: null }); // chromeGroupId resolved inside manager
      }
    } else if (existing.state !== TabState.PRIMARY_ACTIVE) {
      this._registry.update(tabId, { state: TabState.PRIMARY_ACTIVE });
    }

    await tabOrchestrationStore.setActive(tabId, this._currentGroupId);
  }

  /**
   * Expose the tab reuse engine so background/index.ts can check before openTab.
   */
  get reuseEngine(): TabReuseEngine {
    return this._reuseEngine;
  }

  /**
   * Expose registry for read queries (e.g., for side panel state message).
   */
  get registry(): TabRegistry {
    return this._registry;
  }

  // ---------------------------------------------------------------------------
  // Chrome tab event handlers
  // ---------------------------------------------------------------------------

  private _onTabUpdated(evt: TabUpdatedEvent): void {
    const record = this._registry.get(evt.tabId);
    if (!record) return; // Not an AI-managed tab

    const patch: Partial<typeof record> = {};
    if (evt.tab.url) patch.url = evt.tab.url;
    if (evt.tab.title) patch.pageTitle = evt.tab.title;
    this._registry.update(evt.tabId, patch);
  }

  private _onTabRemoved(evt: TabRemovedEvent): void {
    const record = this._registry.get(evt.tabId);
    if (!record) return;

    logger.info(`TabOrchestrator: tab ${evt.tabId} removed (${record.purpose})`);
    this._registry.remove(evt.tabId);

    // If the active tab was closed, clear it from storage
    if (evt.tabId === this._registry.getByState(TabState.PRIMARY_ACTIVE)[0]?.tabId) {
      tabOrchestrationStore.setActive(null, this._currentGroupId).catch(() => { });
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async dispose(): Promise<void> {
    for (const unsub of this._unsubscribeFns) unsub();
    this._unsubscribeFns.length = 0;

    await this._registry.flushNow();
    this._registry.dispose();
    this._groupManager.dispose();
    this._bridge.dispose();

    TabOrchestrator._instance = null;
    logger.info('TabOrchestrator: disposed');
  }
}

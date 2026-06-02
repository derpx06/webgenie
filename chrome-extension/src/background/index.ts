import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  advancedSettingsStore,
  llmProviderStore,
  analyticsSettingsStore,
} from '@extension/storage';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { analytics } from './services/analytics';
import { TabOrchestrator } from './core/tab-orchestrator/index';
import * as allSchemas from './agent/actions/schemas';
import type { ActionSchema } from './agent/actions/schemas';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');
const PENDING_OMNIBOX_KEY = 'pendingOmniboxPrompt';

// Initialize the Tab Orchestrator (single instance, event-driven, no polling)
const tabOrchestrator = TabOrchestrator.getInstance();
tabOrchestrator.init().catch(err => logger.error('TabOrchestrator init failed:', err));

// Track the last focused window to avoid async queries during user-gesture events.
let lastFocusedWindowId: number | undefined;

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    lastFocusedWindowId = windowId;
  }
});

chrome.windows.getLastFocused({ populate: false }, window => {
  lastFocusedWindowId = window.id;
});

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId === 0) {
    const tabId = details.tabId;
    const url = details.url;
    logger.info(`History state updated for tab ${tabId}: ${url}`);

    // Update URL of the attached page if it exists
    const page = browserContext.getPageForTab(tabId);
    if (page) {
      page.updateUrl(url);
    }

    // Clear failure registry if this tab is the active executor's tab
    if (currentExecutor) {
      if (currentExecutor.getCurrentTabId() === tabId) {
        currentExecutor.getContext().clearFailuresForUrl(url);
      }
    }
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      currentExecutor?.cancel();
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
});

logger.info('background loaded');

// Initialize analytics
analytics.init().catch(error => {
  logger.error('Failed to initialize analytics:', error);
});

// Listen for analytics settings changes
analyticsSettingsStore.subscribe(() => {
  analytics.updateSettings().catch(error => {
    logger.error('Failed to update analytics settings:', error);
  });
});

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // TEST LOGGING HANDLERS - START
  if (message.type === 'TEST_GET_LLM_PAGE_STATE') {
    (async () => {
      try {
        let state = await browserContext.getState(false);

        // If the current tab has a blank or system URL (non-http), try to fall back
        // to the first valid http/https tab in the active window
        if (!state.url || (!state.url.startsWith('http') && !state.url.startsWith('https'))) {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const firstValidTab = tabs.find(t => t.id && t.url && (t.url.startsWith('http') || t.url.startsWith('https')));
          if (firstValidTab && firstValidTab.id) {
            logger.info(`TEST_GET_LLM_PAGE_STATE: Fallback from invalid/empty tab to valid tabId=${firstValidTab.id} (${firstValidTab.url})`);
            browserContext.updateCurrentTabId(firstValidTab.id);
            state = await browserContext.getState(false);
          } else {
            // No valid tab found in the current window
            const currentTab = `{id: ${state.tabId}, url: "${state.url || ''}", title: "${state.title || ''}"}`;
            const otherTabs = state.tabs
              .filter(tab => tab.id !== state.tabId)
              .map(tab => `- {id: ${tab.id}, url: "${tab.url || ''}", title: "${tab.title || ''}"}`);
            const stateDescription = `
[Current state starts here]
Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}

[Notice: The active tab and all other open tabs are internal or blank. Playwright cannot inspect DOM elements of non-HTTP pages.]
            `.trim();
            const rawStateSummary = {
              tabId: state.tabId,
              url: state.url,
              title: state.title,
              scrollY: state.scrollY,
              scrollHeight: state.scrollHeight,
              visualViewportHeight: state.visualViewportHeight,
              clickableElementsCount: 0
            };
            sendResponse({ success: true, stateDescription, rawState: rawStateSummary });
            return;
          }
        }

        const rawElementsText = state.elementTree
          ? state.elementTree.clickableElementsToString(DEFAULT_AGENT_OPTIONS.includeAttributes)
          : '(No interactive elements found / page error)';
        const scrollInfo = `[Scroll info of current page] window.scrollY: ${state.scrollY}, document.body.scrollHeight: ${state.scrollHeight}, window.visualViewport.height: ${state.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${Math.round((state.visualViewportHeight / (state.scrollHeight - state.visualViewportHeight)) * 100)}%\n`;
        const currentTab = `{id: ${state.tabId}, url: ${state.url}, title: ${state.title}}`;
        const otherTabs = state.tabs
          .filter(tab => tab.id !== state.tabId)
          .map(tab => `- {id: ${tab.id}, url: ${tab.url}, title: ${tab.title}}`);
        const stateDescription = `
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}
Interactive elements from top layer of the current page inside the viewport:
${scrollInfo}[Start of page]
${rawElementsText}
[End of page]
        `.trim();
        const rawStateSummary = {
          tabId: state.tabId,
          url: state.url,
          title: state.title,
          scrollY: state.scrollY,
          scrollHeight: state.scrollHeight,
          visualViewportHeight: state.visualViewportHeight,
          clickableElementsCount: state.selectorMap ? state.selectorMap.size : 0
        };
        sendResponse({ success: true, stateDescription, rawState: rawStateSummary });
      } catch (err) {
        sendResponse({ success: false, error: String(err) });
      }
    })();
    return true; // asynchronous response
  }

  if (message.type === 'TEST_GET_ALL_TOOLS') {
    try {
      const tools = Object.values(allSchemas)
        .filter((val): val is ActionSchema =>
          Boolean(val && typeof val === 'object' && 'name' in val && 'description' in val)
        )
        .map((val) => ({
          name: val.name,
          description: val.description,
          schema: val.schema
        }));
      sendResponse({ success: true, tools });
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
    return true;
  }

  if (message.type === 'TEST_GET_FAILURE_REGISTRY') {
    try {
      interface FailureRecordSummary {
        key: string;
        selector: string;
        url: string;
        actionType: string;
        failCount: number;
      }
      const records: FailureRecordSummary[] = [];
      if (currentExecutor) {
        const ctx = currentExecutor.getContext();
        for (const [key, record] of ctx.failureRegistry.entries()) {
          records.push({
            key,
            selector: record.selector,
            url: record.url,
            actionType: record.actionType,
            failCount: record.failCount
          });
        }
      }
      sendResponse({ success: true, records });
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
    return true;
  }

  if (message.type === 'TEST_GET_SESSION_STATS') {
    try {
      if (currentExecutor) {
        const ctx = currentExecutor.getContext();
        const stats = {
          taskId: ctx.taskId,
          nSteps: ctx.nSteps,
          consecutiveFailures: ctx.consecutiveFailures,
          lastEvaluation: ctx.lastEvaluation || '(none)',
          lastMemory: ctx.lastMemory || '(none)',
          messageCount: ctx.messageManager.length(),
          paused: ctx.paused,
          stopped: ctx.stopped
        };
        sendResponse({ success: true, stats });
      } else {
        sendResponse({ success: true, stats: null, message: "No active executor task running." });
      }
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
    return true;
  }

  if (message.type === 'TEST_CLEAR_FAILURE_REGISTRY') {
    try {
      if (currentExecutor) {
        const ctx = currentExecutor.getContext();
        ctx.failureRegistry.clear();
        logger.info("TEST_CLEAR_FAILURE_REGISTRY: Failure registry cleared manually.");
        sendResponse({ success: true, message: "Failure registry cleared." });
      } else {
        sendResponse({ success: true, message: "No active task executor found to clear registry." });
      }
    } catch (err) {
      sendResponse({ success: false, error: String(err) });
    }
    return true;
  }
  // TEST LOGGING HANDLERS - END

  return false;
});

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'side-panel-connection') {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;

    if (!senderUrl || senderId !== chrome.runtime.id || senderUrl !== SIDE_PANEL_URL) {
      logger.warning('Blocked unauthorized side-panel-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }

    currentPort = port;

    port.onMessage.addListener(async message => {
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_newTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('new_task', message.tabId, message.task);
            currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
            subscribeToExecutorEvents(currentExecutor);

            // Begin task in orchestrator (creates tab group, registers tab)
            const taskSettings = await generalSettingsStore.getSettings();
            await tabOrchestrator.beginTask(
              message.taskId,
              message.task,
              taskSettings,
              message.tabId,
            );

            const result = await currentExecutor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }

          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('follow_up_task', message.tabId, message.task);

            // If executor exists, add follow-up task
            if (currentExecutor) {
              currentExecutor.addFollowUpTask(message.task);
              // Re-subscribe to events in case the previous subscription was cleaned up
              subscribeToExecutorEvents(currentExecutor);

              // Notify orchestrator of new task context
              const followUpSettings = await generalSettingsStore.getSettings();
              await tabOrchestrator.beginTask(
                message.taskId ?? (await currentExecutor.getCurrentTaskId()),
                message.task,
                followUpSettings,
                message.tabId,
              );

              const result = await currentExecutor.execute();
              logger.info('follow_up_task execution result', message.tabId, result);
            } else {
              // executor was cleaned up, can not add follow-up task
              logger.info('follow_up_task: executor was cleaned up, can not add follow-up task');
              return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_cleaned') });
            }
            break;
          }

          case 'cancel_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.cancel();
            break;
          }

          case 'resume_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_cmd_resumeTask_noTask') });
            await currentExecutor.resume();
            return port.postMessage({ type: 'success' });
          }

          case 'pause_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.pause();
            return port.postMessage({ type: 'success' });
          }

          case 'human_response': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.submitHumanResponse(message.response);
            return port.postMessage({ type: 'success' });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = browserState.elementTree.clickableElementsToString(
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.info('state', browserState);
              logger.info('interactive elements', elementsText);
              return port.postMessage({ type: 'success', msg: t('bg_cmd_state_printed') });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: t('bg_cmd_state_failed') });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
          }

          case 'speech_to_text': {
            try {
              if (!message.audio) {
                return port.postMessage({
                  type: 'speech_to_text_error',
                  error: t('bg_cmd_stt_noAudioData'),
                });
              }

              logger.info('Processing speech-to-text request...');

              // Get all providers for speech-to-text service
              const providers = await llmProviderStore.getAllProviders();

              // Create speech-to-text service with all providers
              const speechToTextService = await SpeechToTextService.create(providers);

              // Extract base64 audio data (remove data URL prefix if present)
              let base64Audio = message.audio;
              if (base64Audio.startsWith('data:')) {
                base64Audio = base64Audio.split(',')[1];
              }

              // Transcribe audio
              const transcribedText = await speechToTextService.transcribeAudio(base64Audio);

              logger.info('Speech-to-text completed successfully');
              return port.postMessage({
                type: 'speech_to_text_result',
                text: transcribedText,
              });
            } catch (error) {
              logger.error('Speech-to-text failed:', error);
              return port.postMessage({
                type: 'speech_to_text_error',
                error: error instanceof Error ? error.message : t('bg_cmd_stt_failed'),
              });
            }
          }

          case 'replay': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.taskId) return port.postMessage({ type: 'error', error: t('bg_errors_noTaskId') });
            if (!message.historySessionId)
              return port.postMessage({ type: 'error', error: t('bg_cmd_replay_noHistory') });
            logger.info('replay', message.tabId, message.taskId, message.historySessionId);

            try {
              // Switch to the specified tab
              await browserContext.switchTab(message.tabId);
              // Setup executor with the new taskId and a dummy task description
              currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
              subscribeToExecutorEvents(currentExecutor);

              // Run replayHistory with the history session ID
              const result = await currentExecutor.replayHistory(message.historySessionId);
              logger.debug('replay execution result', message.tabId, result);
            } catch (error) {
              logger.error('Replay failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : t('bg_cmd_replay_failed'),
              });
            }
            break;
          }

          default:
            return port.postMessage({ type: 'error', error: t('errors_cmd_unknown', [message.type]) });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      console.log('Side panel disconnected');
      currentPort = null;
      currentExecutor?.cancel();
    });
  }
});

// Omnibox integration: typing `genie` + space sends prompt to side panel.
chrome.omnibox.setDefaultSuggestion({
  description: 'WebGenie — run: %s',
});

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  if (!text.trim()) return;
  suggest([
    {
      content: text,
      description: `Ask WebGenie to: ${text.trim()}`,
    },
  ]);
});

chrome.omnibox.onInputEntered.addListener(text => {
  const prompt = text.trim();
  if (!prompt) return;

  if (lastFocusedWindowId !== undefined) {
    chrome.sidePanel.open({ windowId: lastFocusedWindowId }).catch(err => {
      logger.error('Omnibox: failed to open side panel (windowId):', err);
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]?.windowId) {
          chrome.sidePanel.open({ windowId: tabs[0].windowId });
        }
      });
    });
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.windowId) {
        chrome.sidePanel.open({ windowId: tabs[0].windowId });
      }
    });
  }

  chrome.storage.session
    .set({ [PENDING_OMNIBOX_KEY]: prompt })
    .then(() => {
      logger.info('Omnibox: saved pending prompt to session storage:', prompt);
    })
    .catch(err => {
      logger.error('Omnibox: failed to save prompt:', err);
    });
});

async function setupExecutor(taskId: string, task: string, browserContext: BrowserContext) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error(t('bg_setup_noApiKeys'));
  }

  // Clean up any legacy validator settings for backward compatibility
  await agentModelStore.cleanupLegacyValidatorSettings();

  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
    }
  }

  const generalSettings = await generalSettingsStore.getSettings();
  const advancedSettings = await advancedSettingsStore.getSettings();

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error(t('bg_setup_noNavigatorModel'));
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel, generalSettings);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel, generalSettings);
  }


  // Apply firewall settings to browser context
  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
  }

  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000.0,
    displayHighlights: generalSettings.displayHighlights,
  });


  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
      logDOMSnapshot: advancedSettings.enableDeveloperOptions && advancedSettings.logDOMSnapshot,
    },
    generalSettings: generalSettings,
  });

  return executor;
}

// Update subscribeToExecutorEvents to use port
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      if (currentPort) {
        currentPort.postMessage(event);
      }

      // Sync the current active tab with the orchestrator
      const agentTabId = executor.getCurrentTabId();
      if (agentTabId !== null) {
        await tabOrchestrator.updateActiveTab(agentTabId);
      }

      // Delegate all AGENT_STATUS broadcasting to the ActivityEngine
      // (replaces the old direct chrome.tabs.query + sendMessage loop)
      await tabOrchestrator.onAgentEvent(event);
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      await currentExecutor?.cleanup();
      currentExecutor = null;
    }
  });
}

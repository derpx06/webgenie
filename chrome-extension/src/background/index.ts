import 'webextension-polyfill';

if (typeof globalThis.process === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).process = {
    env: {}
  };
}

// Libraries that store fetch on an object and call it as `client._fetch(...)` (e.g. @langchain/google-common,
// used by the Vertex AI provider) throw "Illegal invocation" here: in a service worker fetch needs `this === self`.
globalThis.fetch = globalThis.fetch.bind(globalThis);
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  advancedSettingsStore,
  llmProviderStore,
  analyticsSettingsStore, getLlmCapabilities } from '@extension/storage';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import { ChromeBrowserAdapter } from './adapters/ChromeBrowserAdapter';
import { IndexedDBStorageProvider } from './adapters/IndexedDBStorageProvider';
import { Executor } from './agent/executor';
import { TaskCheckpointStore, isCheckpointResumable, type TaskCheckpoint } from './agent/contracts';
import { keepAliveManager } from './services/keepAliveManager';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { transcribeAudio } from './services/speechToText';
import { analytics } from './services/analytics';
import { TabOrchestrator } from './core/tab-orchestrator/index';
import * as allSchemas from './agent/actions/schemas';
import type { ActionSchema } from './agent/actions/schemas';
import { clearHighlightOverlays } from './browser/dom/service';

const logger = createLogger('background');

// Enterprise Scaling: IndexedDB Migration
const browserAdapter = new ChromeBrowserAdapter();
const storageProvider = new IndexedDBStorageProvider();
const browserContext = new BrowserContext({}, browserAdapter, storageProvider);
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
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener((source, reason) => {
  logger.info(`Debugger detached from tab ${source.tabId}: ${reason}`);
  // A child session (an iframe) detaching leaves the tab's own session intact.
  if (!source.tabId || (source as { sessionId?: string }).sessionId) return;
  browserContext.getPageForTab(source.tabId)?.markDetached();
  if (reason === 'canceled_by_user') {
    void currentExecutor?.interrupt(t('bg_interrupt_debuggerDetached'));
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  // The agent clears its current tab before closing one itself, so this is someone closing the tab the agent works in.
  if (currentExecutor && runningTask && browserContext.getCurrentTabId() === tabId) {
    void currentExecutor.interrupt(t('bg_interrupt_tabClosed'));
  }
  browserContext.removeAttachedPage(tabId);
});

// Downloads during a task show in the agents' state (the name and whether Chrome saved or held it).
// ponytail: every download while a task runs counts, including one the user starts in another tab.
chrome.downloads.onCreated.addListener(item => {
  if (currentExecutor && runningTask) currentExecutor.noteDownload(item);
});
chrome.downloads.onChanged.addListener(delta => {
  if (!currentExecutor || !runningTask) return;
  void chrome.downloads.search({ id: delta.id }).then(([item]) => {
    if (item) currentExecutor?.noteDownload(item);
  });
});

/** The last task started in this browser session, so a restarted worker or a late answer can find its checkpoint. */
const ACTIVE_TASK_KEY = 'webgenie_active_task';
const checkpointStore = new TaskCheckpointStore();
/** The run of `currentExecutor`, awaited before another task starts. */
let runningTask: Promise<void> | null = null;

/** The saved task for this id (without one, the last task that ran), or null when it cannot be resumed. */
async function loadSavedTask(taskId?: string): Promise<TaskCheckpoint | null> {
  const id = taskId ?? (await chrome.storage.session.get(ACTIVE_TASK_KEY))[ACTIVE_TASK_KEY]?.taskId;
  if (!id) return null;
  const checkpoint = await checkpointStore.load(id);
  return isCheckpointResumable(checkpoint) ? checkpoint : null;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Files attached in the side panel go to the executor's memory for upload_file; nothing else keeps them. */
function attachFiles(executor: Executor, files: unknown): void {
  if (!Array.isArray(files)) return;
  for (const file of files as Array<{ name?: unknown; type?: unknown; data?: unknown } | null>) {
    if (typeof file?.name !== 'string' || typeof file.data !== 'string' || (file.data.length * 3) / 4 > MAX_UPLOAD_BYTES) continue;
    executor.getContext().files.set(file.name, { type: typeof file.type === 'string' ? file.type : '', data: file.data });
  }
}

/** Cancels the running task, if any, and waits until it has ended: one task drives the browser at a time. */
async function stopRunningTask(): Promise<void> {
  const running = runningTask;
  if (!running) return;
  await currentExecutor?.cancel();
  await running.catch(() => {});
}

/** Runs an executor to its end with keep-alive on; afterwards only this executor is cleaned up, never a newer one. */
async function runExecutor(executor: Executor, tabId: number | null | undefined, start: () => Promise<void>): Promise<void> {
  await chrome.storage.session.set({ [ACTIVE_TASK_KEY]: { taskId: await executor.getCurrentTaskId(), tabId: tabId ?? null } });
  await keepAliveManager.startKeepAlive();
  const run = start();
  runningTask = run;
  try {
    await run;
  } finally {
    if (runningTask === run) runningTask = null;
    await keepAliveManager.stopKeepAlive().catch(() => {});
    if (currentExecutor === executor) {
      await executor.cleanup();
      currentExecutor = null;
    }
    // An interrupted task keeps the pointer: a reopened panel or a late answer resumes it.
    if (!executor.getContext().interruption) await chrome.storage.session.remove(ACTIVE_TASK_KEY).catch(() => {});
  }
}

/** Rebuilds an executor from a checkpoint (its transcript is in session storage) and continues the task. */
async function resumeSavedTask(
  checkpoint: TaskCheckpoint,
  fallbackTabId?: number,
  answer?: { response: string; secrets: string[]; files?: unknown },
): Promise<void> {
  const savedTab = checkpoint.tabId ? await chrome.tabs.get(checkpoint.tabId).catch(() => null) : null;
  const tabId = savedTab?.id ?? fallbackTabId;
  if (!tabId) throw new Error(t('bg_errors_noTabId'));
  browserContext.updateCurrentTabId(tabId);
  const executor = await setupExecutor(checkpoint.taskId, checkpoint.task, browserContext);
  currentExecutor = executor;
  subscribeToExecutorEvents(executor);
  if (answer) {
    attachFiles(executor, answer.files);
    executor.setPendingAnswer(answer.response, answer.secrets);
  }
  await runExecutor(executor, tabId, () => executor.execute());
}

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
  // Text of a tab the user @-mentioned in the side panel. A script injection is enough; no debugger attach.
  if (message?.type === 'get_tab_content' && typeof message.tabId === 'number') {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    chrome.scripting
      .executeScript({
        target: { tabId: message.tabId },
        func: () => (document.querySelector('main') ?? document.body)?.innerText ?? '',
      })
      .then(([injection]) => sendResponse({ content: String(injection?.result ?? '').slice(0, 12_000) }))
      .catch(error => sendResponse({ content: '', error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

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

  if (message.type === 'TEST_GET_SESSION_STATS') {
    try {
      if (currentExecutor) {
        const ctx = currentExecutor.getContext();
        const stats = {
          taskId: ctx.taskId,
          nSteps: ctx.nSteps,
          consecutiveFailures: ctx.consecutiveFailures,
          workingMemory: ctx.messageManager.getWorkingMemory() || '(none)',
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
            await stopRunningTask();
            browserContext.updateCurrentTabId(message.tabId);
            const executor = await setupExecutor(message.taskId, message.task, browserContext);
            attachFiles(executor, message.files);
            currentExecutor = executor;
            subscribeToExecutorEvents(executor);

            // Begin task in orchestrator (creates tab group, registers tab)
            const taskSettings = await generalSettingsStore.getSettings();
            await tabOrchestrator.beginTask(message.taskId, message.task, taskSettings, message.tabId);

            await runExecutor(executor, message.tabId, () => executor.execute());
            break;
          }

          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('follow_up_task', message.tabId, message.task);
            await stopRunningTask();
            browserContext.updateCurrentTabId(message.tabId);
            // A finished task's executor is gone; the new one reads the conversation from session storage.
            const executor = currentExecutor ?? (await setupExecutor(message.taskId, message.task, browserContext));
            if (executor === currentExecutor) executor.addFollowUpTask(message.task);
            attachFiles(executor, message.files);
            currentExecutor = executor;
            subscribeToExecutorEvents(executor);

            const followUpSettings = await generalSettingsStore.getSettings();
            await tabOrchestrator.beginTask(message.taskId ?? (await executor.getCurrentTaskId()), message.task, followUpSettings, message.tabId);

            await runExecutor(executor, message.tabId, () => executor.execute());
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
            const secrets = Array.isArray(message.secrets) ? message.secrets : [];
            if (currentExecutor && runningTask && !currentExecutor.getContext().stopped) {
              attachFiles(currentExecutor, message.files);
              await currentExecutor.submitHumanResponse(message.response, secrets);
              return port.postMessage({ type: 'success' });
            }
            // The task stopped waiting (the deadline passed, it was interrupted, the worker restarted). A run that is
            // still ending would swallow the answer: let it end, then resume the saved task with it.
            await runningTask?.catch(() => {});
            const saved = await loadSavedTask(message.taskId);
            if (!saved) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await resumeSavedTask(saved, message.tabId, { response: message.response, secrets, files: message.files });
            break;
          }

          case 'reattach': {
            if (currentExecutor && runningTask && (await currentExecutor.getCurrentTaskId()) === message.taskId) {
              currentExecutor.reemitQuestion();
              break;
            }
            const saved = await loadSavedTask(message.taskId);
            if (saved?.status === 'running') {
              // Still marked running: the worker stopped mid-task. Carry on from the checkpoint.
              await resumeSavedTask(saved, message.tabId);
            } else if (saved) {
              port.postMessage({ type: 'task_resumable', taskId: saved.taskId, task: saved.task, status: saved.status, question: saved.pendingQuestion?.question });
            } else {
              port.postMessage({ type: 'reattach_none', taskId: message.taskId });
            }
            break;
          }

          case 'resume_saved_task': {
            const saved = await loadSavedTask(message.taskId);
            if (!saved) return port.postMessage({ type: 'reattach_none', taskId: message.taskId });
            await stopRunningTask();
            await resumeSavedTask(saved, message.tabId);
            break;
          }

          case 'discard_saved_task': {
            if (message.taskId) await checkpointStore.clear(message.taskId);
            await chrome.storage.session.remove(ACTIVE_TASK_KEY);
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

              const providers = await llmProviderStore.getAllProviders();
              // A data URL carries the recording's MIME type; raw base64 is assumed to be webm.
              const dataUrl = /^data:([^;,]+)[^,]*,([\s\S]*)$/.exec(message.audio);
              const transcribedText = await transcribeAudio(
                providers,
                dataUrl ? dataUrl[2] : message.audio,
                dataUrl?.[1] ?? 'audio/webm',
              );

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
              await stopRunningTask();
              await browserContext.switchTab(message.tabId);
              const executor = await setupExecutor(message.taskId, message.task, browserContext);
              currentExecutor = executor;
              subscribeToExecutorEvents(executor);
              await runExecutor(executor, message.tabId, async () => {
                await executor.replayHistory(message.historySessionId);
              });
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
      console.log('Side panel disconnected');
      // Only the latest connection is the panel's; an older one closing says nothing about the panel.
      if (currentPort !== port) return;
      currentPort = null;
      // Closing the side panel stops the task, but saved: reopening the panel offers to resume it.
      if (currentExecutor) {
        const tabId = currentExecutor.getCurrentTabId();
        if (tabId) {
          clearHighlightOverlays(tabId, browserAdapter).catch(err => logger.error('Failed to clear overlays on disconnect', err));
        }
        void currentExecutor.interrupt(t('bg_interrupt_panelClosed'));
      }
    });
  } else if (port.name === 'enterprise-keep-alive') {
    logger.info('Enterprise Keep-Alive Port connected.');
    port.onMessage.addListener((message) => {
      if (message.ping) {
        // Keep-alive tick received
      }
    });
    port.onDisconnect.addListener(() => {
      logger.info('Enterprise Keep-Alive Port disconnected.');
    });
  }
});

// Context Menu integration
chrome.runtime.onInstalled.addListener(() => {
  logger.info('onInstalled fired, creating context menus...');
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'webgenie-summarize',
      title: 'Ask WebGenie to summarize this page',
      contexts: ['page', 'all']
    }, () => {
      if (chrome.runtime.lastError) logger.error('ContextMenu summarize error:', chrome.runtime.lastError);
      else logger.info('ContextMenu summarize created');
    });
    
    chrome.contextMenus.create({
      id: 'webgenie-explain',
      title: 'Ask WebGenie to explain "%s"',
      contexts: ['selection']
    }, () => {
      if (chrome.runtime.lastError) logger.error('ContextMenu explain error:', chrome.runtime.lastError);
      else logger.info('ContextMenu explain created');
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.windowId) return;

  let prompt = '';
  if (info.menuItemId === 'webgenie-summarize') {
    prompt = 'Summarize this page.';
  } else if (info.menuItemId === 'webgenie-explain' && info.selectionText) {
    prompt = `Explain this text: "${info.selectionText}"`;
  }

  if (!prompt) return;

  // Open side panel and save prompt
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(err => {
    logger.error('ContextMenus: failed to open side panel:', err);
  });

  chrome.storage.session
    .set({ [PENDING_OMNIBOX_KEY]: prompt })
    .then(() => {
      logger.info('ContextMenus: saved pending prompt to session storage:', prompt);
    })
    .catch(err => {
      logger.error('ContextMenus: failed to save prompt:', err);
    });
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
    actionSettleTimeoutMs: generalSettings.actionSettleTimeoutMs ?? 2000,
    waitBetweenActions: (generalSettings.actionDelayMs ?? 150) / 1000.0,
    displayHighlights: generalSettings.displayHighlights,
    logDOMSnapshot: advancedSettings.enableDeveloperOptions && advancedSettings.logDOMSnapshot,
  });


  const toolModeOf = (model: typeof navigatorModel) =>
    getLlmCapabilities(providers[model.provider].type ?? model.provider, model.modelName);
  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    navigatorToolMode: toolModeOf(navigatorModel),
    plannerToolMode: toolModeOf(plannerModel ?? navigatorModel),
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
      enableBrowserDataTools: generalSettings.enableBrowserDataTools,
      acceptEvidencedDone: generalSettings.acceptEvidencedDone,
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
        // Map the AgentEvent instance to a plain object to ensure safe serialization over Chrome Port in Manifest V3
        const plainEvent = {
          actor: event.actor,
          state: event.state,
          data: event.data,
          timestamp: event.timestamp,
          type: event.type,
          screenshot: event.screenshot,
        };
        currentPort.postMessage(plainEvent);
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
    // Cleanup happens when the executor's run ends (runExecutor), for that executor only.
  });
}

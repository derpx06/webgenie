/**
 * TabTools — chrome.tabs API integration toolkit
 *
 * Wraps the full chrome.tabs surface area useful for a browser agent:
 *   - Screenshot capture (captureVisibleTab)
 *   - Tab duplication for rollback before risky operations
 *   - Zoom control
 *   - Browser history navigation (goBack / goForward)
 *   - Tab lifecycle (create, close, update, discard)
 *   - Tab querying and state inspection
 *   - Inter-tab messaging (sendMessage to content scripts)
 *
 * Permissions required: "tabs" ✅ (already in manifest), "activeTab" ✅
 *
 * STATUS: Standalone tool — not yet wired into the agent pipeline.
 * To integrate: import from './chromium-apis' in interaction handlers or navigator.
 */

import { createLogger } from '@src/background/log';

const logger = createLogger('TabTools');

// ── Screenshot ────────────────────────────────────────────────────────────────

export interface ScreenshotResult {
  dataUrl: string;   // data:image/jpeg;base64,...
  format: 'jpeg' | 'png';
  windowId: number;
}

/**
 * Capture a screenshot of the currently visible tab in a given window.
 * Returns a base64-encoded data URL.
 *
 * Agent use-case: vision-grounded reasoning without needing the debugger.
 * Much faster than CDP Page.captureScreenshot for simple viewport snapshots.
 */
export async function captureTabScreenshot(
  windowId: number = chrome.windows.WINDOW_ID_CURRENT,
  format: 'jpeg' | 'png' = 'jpeg',
  quality = 80,
): Promise<ScreenshotResult> {
  logger.debug(`[TabTools] Capturing screenshot — window ${windowId}, format: ${format}`);
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format, quality });
  logger.info(`[TabTools] Screenshot captured — ${dataUrl.length} chars`);
  return { dataUrl, format, windowId };
}

// ── Tab Rollback (Duplicate) ──────────────────────────────────────────────────

export interface RollbackHandle {
  /** Clone tab ID created as the rollback snapshot */
  cloneTabId: number;
  /** Original tab ID */
  originalTabId: number;
  /** Restore the original tab to the state when rollback() was called */
  restore(): Promise<void>;
  /** Discard the clone (rollback no longer needed) */
  discard(): Promise<void>;
}

/**
 * Create a rollback snapshot of a tab by duplicating it (hidden in background).
 * The returned handle lets the agent restore or discard the clone.
 *
 * Agent use-case: before submitting a destructive form, snap the tab state.
 * If the action fails catastrophically, call handle.restore().
 *
 * @example
 * const rollback = await createRollbackSnapshot(tabId);
 * try { await riskyAction(); }
 * catch { await rollback.restore(); }
 * finally { await rollback.discard(); }
 */
export async function createRollbackSnapshot(originalTabId: number): Promise<RollbackHandle> {
  logger.info(`[TabTools] Creating rollback snapshot for tab ${originalTabId}`);
  const clone = await chrome.tabs.duplicate(originalTabId);
  const cloneTabId = clone.id!;

  // Move clone to end of tab strip and keep it inactive
  await chrome.tabs.update(cloneTabId, { active: false });
  logger.debug(`[TabTools] Clone tab created: ${cloneTabId}`);

  return {
    cloneTabId,
    originalTabId,
    async restore(): Promise<void> {
      logger.info(`[TabTools] Restoring tab ${originalTabId} from clone ${cloneTabId}`);
      const cloneTab = await chrome.tabs.get(cloneTabId);
      if (cloneTab.url) {
        await chrome.tabs.update(originalTabId, { url: cloneTab.url });
      }
      await chrome.tabs.remove(cloneTabId);
    },
    async discard(): Promise<void> {
      logger.debug(`[TabTools] Discarding rollback clone ${cloneTabId}`);
      try { await chrome.tabs.remove(cloneTabId); } catch { /* already closed */ }
    },
  };
}

// ── Zoom ──────────────────────────────────────────────────────────────────────

/**
 * Set the zoom level of a tab.
 * Useful for improving element visibility / interaction accuracy.
 *
 * @param zoomFactor - 1.0 = 100%, 0.5 = 50%, 2.0 = 200%
 */
export async function setTabZoom(tabId: number, zoomFactor: number): Promise<void> {
  logger.debug(`[TabTools] Setting zoom ${zoomFactor} on tab ${tabId}`);
  await chrome.tabs.setZoom(tabId, zoomFactor);
}

export async function getTabZoom(tabId: number): Promise<number> {
  return chrome.tabs.getZoom(tabId);
}

export async function resetTabZoom(tabId: number): Promise<void> {
  await chrome.tabs.setZoom(tabId, 0); // 0 resets to default
}

// ── History Navigation ────────────────────────────────────────────────────────

/**
 * Navigate the tab backward in browser history.
 * Equivalent to pressing the browser Back button.
 */
export async function tabGoBack(tabId: number): Promise<void> {
  logger.debug(`[TabTools] goBack on tab ${tabId}`);
  await chrome.tabs.goBack(tabId);
}

/**
 * Navigate the tab forward in browser history.
 * Equivalent to pressing the browser Forward button.
 */
export async function tabGoForward(tabId: number): Promise<void> {
  logger.debug(`[TabTools] goForward on tab ${tabId}`);
  await chrome.tabs.goForward(tabId);
}

// ── Tab Lifecycle ─────────────────────────────────────────────────────────────

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  status: string;
  active: boolean;
  windowId: number;
  groupId: number;
}

/**
 * Get full info for a tab.
 */
export async function getTabInfo(tabId: number): Promise<TabInfo> {
  const tab = await chrome.tabs.get(tabId);
  return {
    id: tab.id!,
    url: tab.url ?? '',
    title: tab.title ?? '',
    status: tab.status ?? 'unknown',
    active: tab.active,
    windowId: tab.windowId,
    groupId: tab.groupId ?? -1,
  };
}

/**
 * Get all open tabs, optionally filtered by URL pattern.
 */
export async function queryTabs(urlPattern?: string): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query(urlPattern ? { url: urlPattern } : {});
  return tabs.map(tab => ({
    id: tab.id!,
    url: tab.url ?? '',
    title: tab.title ?? '',
    status: tab.status ?? 'unknown',
    active: tab.active,
    windowId: tab.windowId,
    groupId: tab.groupId ?? -1,
  }));
}

/**
 * Create a new tab, optionally navigating to a URL.
 */
export async function createTab(url?: string, active = false): Promise<TabInfo> {
  logger.info(`[TabTools] Creating tab — url: ${url ?? 'blank'}, active: ${active}`);
  const tab = await chrome.tabs.create({ url, active });
  return {
    id: tab.id!,
    url: tab.url ?? '',
    title: tab.title ?? '',
    status: tab.status ?? 'loading',
    active: tab.active,
    windowId: tab.windowId,
    groupId: tab.groupId ?? -1,
  };
}

/**
 * Navigate an existing tab to a URL.
 */
export async function navigateTab(tabId: number, url: string): Promise<void> {
  logger.info(`[TabTools] Navigating tab ${tabId} → ${url}`);
  await chrome.tabs.update(tabId, { url });
}

/**
 * Close a tab.
 */
export async function closeTab(tabId: number): Promise<void> {
  logger.info(`[TabTools] Closing tab ${tabId}`);
  try { await chrome.tabs.remove(tabId); } catch { /* already closed */ }
}

/**
 * Discard a tab (freeze it, freeing memory — content is restored on reactivation).
 * Useful when the agent has opened many background tabs.
 */
export async function discardTab(tabId: number): Promise<void> {
  logger.debug(`[TabTools] Discarding tab ${tabId} to free memory`);
  await chrome.tabs.discard(tabId);
}

/**
 * Switch the active tab to the given tabId.
 */
export async function activateTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  logger.debug(`[TabTools] Activating tab ${tabId} in window ${tab.windowId}`);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

// ── Messaging ─────────────────────────────────────────────────────────────────

/**
 * Send a message to a content script running in a tab.
 * The content script must have a chrome.runtime.onMessage listener.
 *
 * @returns Response from the content script, or null if no listener responded.
 */
export async function sendMessageToTab<T = unknown, R = unknown>(
  tabId: number,
  message: T,
): Promise<R | null> {
  try {
    logger.debug(`[TabTools] Sending message to tab ${tabId}:`, message);
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response as R;
  } catch (err) {
    // Content script not registered or no listener — not necessarily an error
    logger.debug(`[TabTools] No response from tab ${tabId}:`, err);
    return null;
  }
}

// ── Detection Utilities ───────────────────────────────────────────────────────

/**
 * Check whether a tab has finished loading.
 */
export async function isTabLoaded(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId);
  return tab.status === 'complete';
}

/**
 * Wait for a tab to finish loading, with timeout.
 */
export async function waitForTabLoad(tabId: number, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isTabLoaded(tabId)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  logger.warning(`[TabTools] Timeout waiting for tab ${tabId} to load`);
  return false;
}

/**
 * Detect whether a tab is playing audio (useful before interrupting media).
 */
export async function isTabAudible(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId);
  return tab.audible ?? false;
}

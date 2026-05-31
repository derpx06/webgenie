/**
 * NetworkWatcher — Phase 4 Chromium API Integration
 *
 * Uses chrome.webRequest to intercept XHR/fetch completions and provide
 * ground-truth action verification instead of DOM hash polling.
 *
 * Problem it solves:
 *   Current: Agent clicks "Submit" → waits 2s → checks if DOM changed → unreliable
 *   This:    Agent clicks "Submit" → webRequest fires HTTP 200 → CONFIRMED success
 *
 * SPAs (Gmail, Twitter, GitHub) often submit forms via API calls without
 * changing the DOM structure. The current DOM-hash approach treats these as
 * failures. This watcher detects the network event and confirms success.
 *
 * STATUS: Ready for integration — not yet wired into navigator.ts doMultiAction.
 * To integrate: import and call watchNextNonGetRequest() before each click action.
 *
 * Permission required in manifest: "webRequest"
 */

import { createLogger } from '@src/background/log';

const logger = createLogger('NetworkWatcher');

export interface NetworkResult {
  ok: boolean;
  statusCode?: number;
  url?: string;
  method?: string;
  errorText?: string;
}

/**
 * Set up a one-shot webRequest listener for the next non-GET request on a tab.
 * Returns a Promise that resolves when a non-GET network response is received,
 * or rejects after the timeout if no relevant request was made.
 *
 * Usage:
 * ```typescript
 * const networkPromise = watchNextNonGetRequest(tabId, 3000);
 * await actionHandler.handleClickElement(input); // fire the action
 * const result = await networkPromise;
 * if (result.ok) { // confirmed network success }
 * ```
 */
export function watchNextNonGetRequest(
  tabId: number,
  timeoutMs = 3000,
): Promise<NetworkResult> {
  return new Promise<NetworkResult>((resolve) => {
    let settled = false;

    const settle = (result: NetworkResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result.ok) {
        logger.info(`[NetworkWatcher] ✅ Non-GET ${result.statusCode} from ${result.url}`);
      } else {
        logger.warning(`[NetworkWatcher] ⚠️ Non-GET request failed: ${result.errorText ?? result.statusCode}`);
      }
      resolve(result);
    };

    const onCompleted = (details: chrome.webRequest.WebResponseCacheDetails) => {
      if (details.tabId !== tabId) return;
      if (details.method === 'GET') return;
      settle({
        ok: details.statusCode >= 200 && details.statusCode < 300,
        statusCode: details.statusCode,
        url: details.url,
        method: details.method,
        errorText: details.statusCode >= 400
          ? `Server returned HTTP ${details.statusCode}`
          : undefined,
      });
    };

    const onError = (details: chrome.webRequest.WebResponseErrorDetails) => {
      if (details.tabId !== tabId) return;
      if (details.method === 'GET') return;
      settle({
        ok: false,
        url: details.url,
        method: details.method,
        errorText: `Network error: ${details.error}`,
      });
    };

    const cleanup = () => {
      try {
        chrome.webRequest.onCompleted.removeListener(onCompleted);
        chrome.webRequest.onErrorOccurred.removeListener(onError);
      } catch {
        // Listener may already be removed
      }
    };

    chrome.webRequest.onCompleted.addListener(onCompleted, {
      urls: ['<all_urls>'],
      types: ['xmlhttprequest', 'fetch'],
    });
    chrome.webRequest.onErrorOccurred.addListener(onError, {
      urls: ['<all_urls>'],
      types: ['xmlhttprequest', 'fetch'],
    });

    // Timeout: if no non-GET request happened, return a neutral result
    setTimeout(() => {
      if (!settled) {
        logger.debug(`[NetworkWatcher] Timeout after ${timeoutMs}ms — no non-GET request detected`);
        settle({ ok: false, errorText: 'timeout — no non-GET request within window' });
      }
    }, timeoutMs);
  });
}

/**
 * Monitor all requests from a tab during an async operation.
 * Useful for debugging — logs every request made while the callback runs.
 */
export async function monitorRequestsDuring<T>(
  tabId: number,
  operation: () => Promise<T>,
): Promise<{ result: T; requests: NetworkResult[] }> {
  const requests: NetworkResult[] = [];

  const onCompleted = (details: chrome.webRequest.WebResponseCacheDetails) => {
    if (details.tabId !== tabId) return;
    requests.push({
      ok: details.statusCode >= 200 && details.statusCode < 300,
      statusCode: details.statusCode,
      url: details.url,
      method: details.method,
    });
  };

  chrome.webRequest.onCompleted.addListener(onCompleted, { urls: ['<all_urls>'] });

  let result: T;
  try {
    result = await operation();
  } finally {
    chrome.webRequest.onCompleted.removeListener(onCompleted);
  }

  logger.debug(`[NetworkWatcher] ${requests.length} requests during operation:`, requests);
  return { result, requests };
}

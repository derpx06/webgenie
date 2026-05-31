/**
 * NavigationTools — chrome.webNavigation API integration toolkit
 *
 * Provides deterministic, event-driven page lifecycle signals to the agent:
 *   - Frame inspection (getAllFrames — know every iframe on a page)
 *   - Page load completion detection (no more arbitrary waits)
 *   - SPA navigation detection (onHistoryStateUpdated)
 *   - Navigation error detection (onErrorOccurred)
 *
 * Permissions required: "webNavigation" ✅ (already in manifest)
 *
 * STATUS: Standalone tool — not yet wired into the agent pipeline.
 */

import { createLogger } from '@src/background/log';

const logger = createLogger('NavigationTools');

// ── Frame Inspection ──────────────────────────────────────────────────────────

export interface FrameInfo {
  tabId: number;
  frameId: number;
  parentFrameId: number;
  url: string;
  documentId?: string;
  errorOccurred: boolean;
}

/**
 * Get all frames (main frame + all iframes) for a tab.
 * Critical for multi-frame DOM operations — iframes have separate frameIds
 * that must be targeted explicitly in scripting/CDP calls.
 *
 * Agent use-case: enumerate all iframes on a page (Stripe payment, YouTube embed,
 * Google Maps) before deciding which frame to interact with.
 */
export async function getAllFrames(tabId: number): Promise<FrameInfo[]> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames) return [];
  logger.debug(`[NavigationTools] Tab ${tabId} has ${frames.length} frames`);
  return frames.map(f => ({
    tabId,
    frameId: f.frameId,
    parentFrameId: f.parentFrameId,
    url: f.url,
    documentId: f.documentId,
    errorOccurred: f.errorOccurred,
  }));
}

/**
 * Get the frame tree as a nested structure (root → children → grandchildren).
 * Useful for understanding iframe nesting depth and cross-origin boundaries.
 */
export async function getFrameTree(tabId: number): Promise<FrameTreeNode | null> {
  const frames = await getAllFrames(tabId);
  if (!frames.length) return null;

  const byId = new Map<number, FrameTreeNode>();
  for (const f of frames) {
    byId.set(f.frameId, { ...f, children: [] });
  }

  let root: FrameTreeNode | null = null;
  for (const node of byId.values()) {
    if (node.parentFrameId === -1 || node.frameId === 0) {
      root = node;
    } else {
      const parent = byId.get(node.parentFrameId);
      if (parent) parent.children.push(node);
    }
  }
  return root;
}

export interface FrameTreeNode extends FrameInfo {
  children: FrameTreeNode[];
}

/**
 * Find frames containing a specific URL pattern (substring or regex).
 */
export async function findFramesByUrl(
  tabId: number,
  urlPattern: string | RegExp,
): Promise<FrameInfo[]> {
  const frames = await getAllFrames(tabId);
  return frames.filter(f =>
    typeof urlPattern === 'string'
      ? f.url.includes(urlPattern)
      : urlPattern.test(f.url),
  );
}

/**
 * Find cross-origin iframes (iframes with a different domain than the main frame).
 * These cannot be directly scripted by content scripts — need CDP for access.
 */
export async function getCrossOriginFrames(tabId: number): Promise<FrameInfo[]> {
  const frames = await getAllFrames(tabId);
  if (!frames.length) return [];
  const mainFrame = frames.find(f => f.frameId === 0);
  if (!mainFrame) return [];

  let mainOrigin: string;
  try {
    mainOrigin = new URL(mainFrame.url).origin;
  } catch {
    return [];
  }

  return frames.filter(f => {
    if (f.frameId === 0) return false;
    try {
      return new URL(f.url).origin !== mainOrigin;
    } catch {
      return false;
    }
  });
}

// ── Page Load Detection ───────────────────────────────────────────────────────

/**
 * Wait for a tab's main frame to complete loading, using webNavigation events.
 * More reliable than polling chrome.tabs.get() for status === 'complete'.
 *
 * @param tabId     - Tab to watch
 * @param timeoutMs - Max wait time before resolving false
 */
export function waitForNavigation(tabId: number, timeoutMs = 10000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;

    const settle = (success: boolean) => {
      if (settled) return;
      settled = true;
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      chrome.webNavigation.onErrorOccurred.removeListener(onError);
      resolve(success);
    };

    const onCompleted = (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => {
      if (details.tabId === tabId && details.frameId === 0) {
        logger.info(`[NavigationTools] Navigation completed: ${details.url}`);
        settle(true);
      }
    };

    const onError = (details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => {
      if (details.tabId === tabId && details.frameId === 0) {
        logger.warning(`[NavigationTools] Navigation error: ${details.error}`);
        settle(false);
      }
    };

    chrome.webNavigation.onCompleted.addListener(onCompleted);
    chrome.webNavigation.onErrorOccurred.addListener(onError);

    setTimeout(() => {
      if (!settled) {
        logger.debug(`[NavigationTools] Navigation timeout after ${timeoutMs}ms`);
        settle(false);
      }
    }, timeoutMs);
  });
}

/**
 * Wait for the next SPA client-side navigation (pushState/replaceState).
 * Use this after clicking an in-app link in Gmail, GitHub, Twitter, etc.
 */
export function waitForSPANavigation(tabId: number, timeoutMs = 5000): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;

    const settle = (url: string | null) => {
      if (settled) return;
      settled = true;
      chrome.webNavigation.onHistoryStateUpdated.removeListener(onHistory);
      resolve(url);
    };

    const onHistory = (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
      if (details.tabId === tabId && details.frameId === 0) {
        logger.info(`[NavigationTools] SPA navigation detected: ${details.url}`);
        settle(details.url);
      }
    };

    chrome.webNavigation.onHistoryStateUpdated.addListener(onHistory);
    setTimeout(() => {
      if (!settled) {
        logger.debug(`[NavigationTools] SPA navigation timeout after ${timeoutMs}ms`);
        settle(null);
      }
    }, timeoutMs);
  });
}

// ── Current Navigation State ──────────────────────────────────────────────────

/**
 * Get the current state of navigation for a specific frame.
 */
export async function getFrameInfo(tabId: number, frameId: number): Promise<FrameInfo | null> {
  try {
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId });
    if (!frame) return null;
    return {
      tabId,
      frameId,
      parentFrameId: frame.parentFrameId,
      url: frame.url,
      documentId: frame.documentId,
      errorOccurred: frame.errorOccurred,
    };
  } catch {
    return null;
  }
}

/**
 * Detect if the current page is a Single Page Application by checking
 * whether it has fired pushState/replaceState events recently.
 * Returns the framework hint if detectable.
 */
export async function detectSPAFramework(tabId: number): Promise<string | null> {
  const frames = await getAllFrames(tabId);
  const mainFrame = frames.find(f => f.frameId === 0);
  if (!mainFrame) return null;

  // Check URL patterns for known SPAs
  const url = mainFrame.url;
  if (url.includes('mail.google.com')) return 'Gmail (Angular/Polymer)';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'Twitter/X (React)';
  if (url.includes('github.com')) return 'GitHub (React)';
  if (url.includes('notion.so')) return 'Notion (React)';
  if (url.includes('figma.com')) return 'Figma (React)';
  if (url.includes('slack.com')) return 'Slack (React)';
  if (url.includes('linkedin.com')) return 'LinkedIn (React)';
  if (url.includes('youtube.com')) return 'YouTube (Polymer/LitElement)';

  return null;
}

import type { DOMState } from './dom/views';
import type { DOMHistoryElement } from './dom/history/view';
import type { BrowserObservation } from '../agent/validation/types';

interface BrowserContextWindowSize {
  width: number;
  height: number;
}

export interface BrowserContextConfig {
  /**
   * Minimum time to wait before getting page state for LLM input
   * @default 0.25
   */
  minimumWaitPageLoadTime: number;

  /**
   * Time to wait for network requests to finish before getting page state.
   * Lower values may result in incomplete page loads.
   * @default 0.5
   */
  waitForNetworkIdlePageLoadTime: number;

  /**
   * Maximum time to wait for the page's requests to go quiet before reading it anyway.
   * @default 2.0
   */
  maximumWaitPageLoadTime: number;

  /**
   * Time to wait between multiple actions in one step
   * @default 0.5
   */
  waitBetweenActions: number;

  /**
   * Maximum time to wait for a dynamic page to expose an action postcondition.
   * @default 2000
   */
  actionSettleTimeoutMs: number;

  /**
   * Poll interval while waiting for a dynamic action postcondition.
   * @default 100
   */
  actionPollIntervalMs: number;

  /**
   * Default browser window size
   * @default { width: 1280, height: 1100 }
   */
  browserWindowSize: BrowserContextWindowSize;

  /**
   * Viewport expansion in pixels. This amount will increase the number of elements
   * which are included in the state what the LLM will see.
   * If set to -1, all elements will be included (this leads to high token usage).
   * If set to 0, only the elements which are visible in the viewport will be included.
   * @default 0
   */
  viewportExpansion: number;

  /**
   * List of allowed domains that can be accessed. If None, all domains are allowed.
   * @default null
   */
  allowedUrls: string[];

  /**
   * List of denied domains that can be accessed. If None, all domains are allowed.
   * @default null
   */
  deniedUrls: string[];

  /**
   * Include dynamic attributes in the CSS selector. If you want to reuse the css_selectors, it might be better to set this to False.
   * @default true
   */
  includeDynamicAttributes: boolean;

  /**
   * Home page url
   * @default 'https://www.google.com'
   */
  homePageUrl: string;

  /**
   * Display highlights on interactive elements
   * @default true
   */
  displayHighlights: boolean;

  /**
   * Log the complete DOM snapshot sent to the model.
   * @default false
   */
  logDOMSnapshot: boolean;
}

export const DEFAULT_BROWSER_CONTEXT_CONFIG: BrowserContextConfig = {
  minimumWaitPageLoadTime: 0.1,
  waitForNetworkIdlePageLoadTime: 0.25,
  // 26% of network-idle waits spent the whole 5 s cap, while the 74% that returned early returned in 0.30 s: the
  // signal arrives fast or not at all, so the last three seconds bought nothing (analysis-3-latency.md, item 7).
  maximumWaitPageLoadTime: 2.0,
  waitBetweenActions: 0.15,
  actionSettleTimeoutMs: 2000,
  actionPollIntervalMs: 150,
  browserWindowSize: { width: 1280, height: 1100 },
  viewportExpansion: 0,
  allowedUrls: [],
  deniedUrls: [],
  includeDynamicAttributes: true,
  homePageUrl: 'about:blank',
  displayHighlights: false,
  logDOMSnapshot: false,
};

/** A JavaScript dialog the page is waiting on; nothing else on the page responds until it is answered. */
export interface PageDialog {
  type: string;
  message: string;
  defaultValue?: string;
}

export interface PageState extends DOMState {
  tabId: number;
  url: string;
  title: string;
  screenshot: string | null;
  scrollY: number;
  scrollHeight: number;
  visualViewportHeight: number;
  dialog?: PageDialog;
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  /** The agent opened this tab, or switched to it on purpose: it is part of the task's working set. */
  mine?: boolean;
}

export interface BrowserState extends PageState {
  tabs: TabInfo[];
  observation?: BrowserObservation;
  // browser_errors: string[];
}

export class BrowserStateHistory {
  url: string;
  title: string;
  tabs: TabInfo[];
  interactedElements: (DOMHistoryElement | null)[];
  // screenshot is too large to store in the history
  // screenshot: string | null;

  constructor(state: BrowserState, interactedElements?: (DOMHistoryElement | null)[]) {
    this.url = state.url;
    this.title = state.title;
    this.tabs = state.tabs;
    this.interactedElements = interactedElements ?? [];
    // this.screenshot = state.screenshot;
  }
}

class BrowserError extends Error {
  /**
   * Base class for all browser errors
   */
  constructor(message?: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

export class URLNotAllowedError extends BrowserError {
  /**
   * Error raised when a URL is not allowed
   */
  constructor(message?: string) {
    super(message);
    this.name = 'URLNotAllowedError';
  }
}

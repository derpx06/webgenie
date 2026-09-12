import 'webextension-polyfill';
import {
  connect,
  ExtensionTransport,
  type HTTPRequest,
  type HTTPResponse,
  type ProtocolType,
  type KeyInput,
} from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import type { Browser } from 'puppeteer-core/lib/esm/puppeteer/api/Browser.js';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import type { CDPSession } from 'puppeteer-core/lib/esm/puppeteer/api/CDPSession.js';
import type { Dialog } from 'puppeteer-core/lib/esm/puppeteer/api/Dialog.js';
import {
  removeHighlights as _removeHighlights,
  getScrollInfo as _getScrollInfo,
  drawHighlightOverlaysViaCoordinates,
} from './dom/service';
import { DOMElementNode, type DOMState } from './dom/views';
import {
  type BrowserContextConfig,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  type PageDialog,
  type PageState,
  URLNotAllowedError,
} from './views';
import { createLogger } from '@src/background/log';
import { record } from '@src/background/trace';
import { isUrlAllowed, isNewTabPage } from './util';
import { getAXTreeState } from './chromium-apis/ax-tree-extractor';
import { pruneAXTree } from './dom/ax-tree-pruner';
import type { IBrowserAdapter } from '../adapters/IBrowserAdapter';
import type { IStorageProvider } from '../adapters/IStorageProvider';
import { ChromeBrowserAdapter } from '../adapters/ChromeBrowserAdapter';
import { ChromeStorageProvider } from '../adapters/ChromeStorageProvider';


const logger = createLogger('Page');

/** Navigations wait for the document to be parsed; the next page read waits for the network to go idle. */
const NAVIGATION_OPTIONS = { waitUntil: 'domcontentloaded' as const, timeout: 15000 };

/** What a mouse gesture caused besides changing the page. */
export interface MouseOutcome {
  dialog?: PageDialog;
  fileChooser: boolean;
}

export interface InputOutcome {
  matched: boolean;
  secret: boolean;
  actualLength: number;
  /** The field's value after typing; null for password fields. */
  actual: string | null;
}

const MODIFIER_KEYS: Record<string, KeyInput> = {
  ctrl: 'Control',
  control: 'Control',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  win: 'Meta',
  super: 'Meta',
};

const NAMED_KEYS: Record<string, KeyInput> = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}` as KeyInput])),
};

/**
 * Parses a key or shortcut ("Enter", "page down", "Control+Shift+T", "Control++") into puppeteer key names.
 * Named keys are case-insensitive; single characters keep their case; modifiers are never swapped per OS.
 */
export function normalizeKeyCombo(combo: string): { modifiers: KeyInput[]; key: KeyInput } {
  const trimmed = combo.trim();
  const parts = trimmed === '+' ? ['+'] : trimmed.endsWith('++') ? [...trimmed.slice(0, -2).split('+'), '+'] : trimmed.split('+');
  const names = parts.map(part => (part === '+' ? part : part.trim())).filter(Boolean);
  if (names.length === 0) {
    throw new Error('No key given');
  }
  const lookup = (name: string) => name.toLowerCase().replace(/[\s_-]/g, '');
  const modifiers = names.slice(0, -1).map(name => {
    const modifier = MODIFIER_KEYS[lookup(name)];
    if (!modifier) throw new Error(`Unknown modifier "${name}". Use Control, Shift, Alt or Meta.`);
    return modifier;
  });
  const last = names[names.length - 1];
  const key = last.length === 1 ? (last as KeyInput) : (NAMED_KEYS[lookup(last)] ?? MODIFIER_KEYS[lookup(last)]);
  if (!key) {
    throw new Error(`Unknown key "${last}". Use a single character or one of: ${[...new Set(Object.values(NAMED_KEYS))].join(', ')}`);
  }
  return { modifiers, key };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The value an <input type=date> needs for a date typed the way a user would (mm/dd/yyyy). */
function toDateInputValue(text: string): string {
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : text;
}

export function getAdaptiveDomRetryDelayMs(attempt: number): number {
  return Math.min(750, Math.max(250, attempt * 250));
}

export function build_initial_state(tabId?: number, url?: string, title?: string): PageState {
  return {
    elementTree: new DOMElementNode({
      tagName: 'root',
      isVisible: true,
      parent: null,
      xpath: '',
      attributes: {},
      children: [],
    }),
    selectorMap: new Map(),
    tabId: tabId || 0,
    url: url || '',
    title: title || '',
    screenshot: null,
    scrollY: 0,
    scrollHeight: 0,
    visualViewportHeight: 0,
  };
}

export default class Page {
  private _tabId: number;
  private _browser: Browser | null = null;
  private _puppeteerPage: PuppeteerPage | null = null;
  private _config: BrowserContextConfig;
  private _state: PageState;
  private _validWebPage = false;
  private _cachedState: PageState | null = null;
  /** Bumped by every invalidation: a read started under an older generation is never cached or joined. */
  private _generation = 0;
  private _pendingState: { generation: number; useVision: boolean; promise: Promise<PageState> } | null = null;
  /** URL of the last successful read; a read at a different URL waits for the page to load first. */
  private _lastReadUrl: string | null = null;
  /** A JavaScript dialog left open for the agent to answer. */
  private _pendingDialog: Dialog | null = null;
  /** True while navigateTo/goBack/goForward/refreshPage run, so their own beforeunload prompt is accepted. */
  private _agentNavigating = false;
  private _fileChooserOpened = false;
  private _browserAdapter: IBrowserAdapter;
  private _storageProvider: IStorageProvider;

  constructor(
    tabId: number,
    url: string,
    title: string,
    config: Partial<BrowserContextConfig> = {},
    browserAdapter?: IBrowserAdapter,
    storageProvider?: IStorageProvider
  ) {
    this._tabId = tabId;
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this._state = build_initial_state(tabId, url, title);
    this._browserAdapter = browserAdapter || new ChromeBrowserAdapter();
    this._storageProvider = storageProvider || new ChromeStorageProvider();
    // chrome://newtab/, chrome://newtab/extensions, https://chromewebstore.google.com/ are not valid web pages, can't be attached
    const lowerCaseUrl = url.trim().toLowerCase();
    this._validWebPage =
      (tabId &&
        lowerCaseUrl &&
        lowerCaseUrl.startsWith('http') &&
        !lowerCaseUrl.startsWith('https://chromewebstore.google.com')) ||
      false;
  }

  get tabId(): number {
    return this._tabId;
  }

  get validWebPage(): boolean {
    return this._validWebPage;
  }

  get attached(): boolean {
    return this._validWebPage && this._puppeteerPage !== null;
  }

  /**
   * Re-evaluate whether this page is a valid web page based on a new URL.
   * Safe to call at any time; only promotes false→true, never demotes.
   */
  refreshValidWebPage(url: string): void {
    if (!url) return;
    const lower = url.trim().toLowerCase();
    if (lower.startsWith('http') && !lower.startsWith('https://chromewebstore.google.com')) {
      this._validWebPage = true;
    }
  }

  updateUrl(url: string): void {
    if (!url) return;
    const previousUrl = this._state.url;
    // Replaced, not mutated: the old object may be a state the agent is still comparing against.
    this._state = { ...this._state, url };
    this.refreshValidWebPage(url);

    // ── SPA Cache Invalidation ────────────────────────────────────────────────
    // When a SPA performs a client-side navigation (pushState / replaceState),
    // chrome.webNavigation.onHistoryStateUpdated fires and calls updateUrl().
    // The old _cachedState holds element indices from the PREVIOUS view — any
    // LLM action referencing those indices will fail with
    // "Element with index X does not exist".
    // Clearing the cache here forces a fresh DOM extraction on the next getState()
    // call, ensuring indices always match the currently rendered view.
    if (previousUrl && previousUrl !== url) {
      logger.info(`[SPA Nav] URL changed ${previousUrl} → ${url} — invalidating DOM cache`);
      this.invalidateCache();
    }
    // ─────────────────────────────────────────────────────────────────────────
  }

  /**
   * Re-checks the live tab URL and promotes _validWebPage if the tab has
   * navigated to a real page since construction. Called at the start of
   * getState() so we never return an empty state just because the Page was
   * constructed from a newtab URL.
   * Also tries to attach puppeteer so click/input actions work immediately.
   */
  private async _revalidateFromTab(): Promise<void> {
    if (this._validWebPage) return; // already valid, nothing to do
    try {
      const tab = await this._browserAdapter.getTab(this._tabId);
      this.refreshValidWebPage(tab.url ?? '');
      if (this._validWebPage) {
        // Update the cached state URL/title now that we know the real URL
        this._state = { ...this._state, url: tab.url ?? '', title: tab.title ?? '' };
        logger.info('Page re-validated from tab', this._tabId, tab.url);
        // Attempt puppeteer attachment so click/input actions can work.
        // Failure is non-fatal; DOM reads via chrome.scripting will still work.
        if (!this._puppeteerPage) {
          await this.attachPuppeteer().catch(err =>
            logger.warning('Re-validation puppeteer attach failed (non-fatal):', err),
          );
        }
      }
    } catch {
      // Tab may have been closed; leave _validWebPage as-is
    }
  }

  async attachPuppeteer(): Promise<boolean> {
    if (!this._validWebPage) {
      return false;
    }
    if (this._puppeteerPage) {
      return true;
    }

    logger.info('attaching puppeteer', this._tabId);
    const connectTab = async () =>
      connect({
        transport: await ExtensionTransport.connectTab(this._tabId),
        defaultViewport: null,
        protocol: 'cdp' as ProtocolType,
      });
    let browser: Browser;
    try {
      browser = await connectTab();
    } catch (error) {
      // A session left behind by an earlier service worker blocks a new attach: release it once and retry.
      if (!/already attached/i.test(error instanceof Error ? error.message : String(error))) throw error;
      await this._browserAdapter.detachDebugger({ tabId: this._tabId }).catch(() => undefined);
      browser = await connectTab();
    }
    const [page] = await browser.pages();
    this._browser = browser;
    this._puppeteerPage = page;

    try {
      const client = (page.mainFrame() as unknown as { client: CDPSession }).client;
      // Focus and :focus behave as in a focused window even while the user works in another one.
      await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      // A native file picker would block the tab; the agent is told about the chooser instead.
      await client.send('Page.setInterceptFileChooserDialog', { enabled: true });
      client.on('Page.fileChooserOpened', () => {
        this._fileChooserOpened = true;
      });
    } catch (error) {
      logger.warning('Could not configure the page session:', error);
    }

    // Dialogs stay open for the agent to answer (handle_dialog); the page state shows them.
    page.on('dialog', dialog => {
      if (dialog.type() === 'beforeunload' && this._agentNavigating) {
        void dialog.accept().catch(() => undefined);
        return;
      }
      logger.info(`JavaScript ${dialog.type()} dialog opened: "${dialog.message().slice(0, 200)}"`);
      this._pendingDialog = dialog;
      this.invalidateCache();
    });
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) this._pendingDialog = null;
    });

    return true;
  }

  /** Attaches on first use; throws when this tab cannot be controlled. */
  public async ensurePuppeteerConnected(): Promise<void> {
    if (this._puppeteerPage) {
      return;
    }
    if (!this._validWebPage) {
      throw new Error(`Cannot control this tab (${this._state.url || 'no page loaded'}): only web pages can be automated`);
    }
    try {
      await this.attachPuppeteer();
    } catch (error) {
      throw new Error(
        `Cannot control this tab (DevTools may be open on it): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Forgets the debugger session (closed by the browser or the user); the next use attaches again. */
  markDetached(): void {
    const browser = this._browser;
    if (browser) void Promise.resolve().then(() => browser.disconnect()).catch(() => undefined);
    this._browser = null;
    this._puppeteerPage = null;
    this._pendingState = null;
    this._lastReadUrl = null;
    this._pendingDialog = null;
    this.invalidateCache();
  }

  async detachPuppeteer(): Promise<void> {
    const browser = this._browser;
    if (browser) await Promise.resolve().then(() => browser.disconnect()).catch(() => undefined);
    this._browser = null;
    this.markDetached();
    this._state = build_initial_state(this._tabId, this._state.url, this._state.title);
  }

  async removeHighlight(): Promise<void> {
    // A script injected while a JavaScript dialog is open blocks until the dialog closes.
    if (this._validWebPage && !this._pendingDialog) {
      await _removeHighlights(this._tabId, this._browserAdapter);
    }
  }

  /** The page's interactive elements and text, from the accessibility tree of every frame. */
  async getClickableElements(showHighlightElements: boolean): Promise<DOMState | null> {
    if (!this._validWebPage) {
      return null;
    }
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    const state = pruneAXTree(await getAXTreeState(this._puppeteerPage));
    if (showHighlightElements) {
      await this._drawHighlightsFromCoords(state);
    }
    return state;
  }

  /**
   * Draw highlight overlays for all interactive elements in a DOMState using their
   * stored pageCoordinates. Works for both AXTree-derived and DOMSnapshot-derived states.
   */
  private async _drawHighlightsFromCoords(state: DOMState): Promise<void> {
    const rects: { index: number; x: number; y: number; w: number; h: number }[] = [];
    for (const [idx, el] of state.selectorMap.entries()) {
      if (el.pageCoordinates) {
        rects.push({
          index: idx,
          x: el.pageCoordinates.center.x,
          y: el.pageCoordinates.center.y,
          w: el.pageCoordinates.width,
          h: el.pageCoordinates.height,
        });
      }
    }
    if (rects.length > 0) {
      await drawHighlightOverlaysViaCoordinates(this._tabId, rects, this._browserAdapter);
    }
  }

  /** Waits until the element count of every frame holds still for two checks, at most maxWaitMs. */
  private async _waitForDomStability(maxWaitMs = 1000, checkIntervalMs = 50): Promise<void> {
    const page = this._puppeteerPage;
    if (!page) {
      return;
    }
    const countIn = (frame: ReturnType<PuppeteerPage['frames']>[number]) =>
      Promise.race([
        frame.evaluate(() => document.getElementsByTagName('*').length).catch(() => 0),
        // A frame blocked by a dialog or busy script must not hold up the read.
        new Promise<number>(resolve => setTimeout(() => resolve(0), 300)),
      ]);
    let previous = -1;
    let stableTicks = 0;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const counts = await Promise.all(page.frames().filter(frame => !frame.detached).map(countIn));
      const count = counts.reduce((sum, value) => sum + value, 0);
      if (count > 0 && count === previous) {
        if (++stableTicks >= 2) return;
      } else {
        stableTicks = 0;
        previous = count;
      }
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
  }

  // Get scroll position information for the current page.
  async getScrollInfo(): Promise<[number, number, number]> {
    if (!this._validWebPage) {
      return [0, 0, 0];
    }
    return _getScrollInfo(this._tabId, this._browserAdapter);
  }

  // Get scroll position information for a specific element.
  async getElementScrollInfo(elementNode: DOMElementNode): Promise<[number, number, number]> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    const element = await this.locateElement(elementNode);
    if (!element) {
      throw new Error(`Element: ${elementNode} not found`);
    }

    // Find the nearest scrollable ancestor
    const scrollableElement = await this._findNearestScrollableElement(element);
    if (!scrollableElement) {
      throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
    }

    const scrollInfo = await scrollableElement.evaluate(el => {
      return {
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      };
    });

    return [scrollInfo.scrollTop, scrollInfo.clientHeight, scrollInfo.scrollHeight];
  }

  /**
   * Find the nearest scrollable ancestor of the given element
   * @param element The element to start searching from
   * @returns The nearest scrollable ancestor or null if none found
   */
  private async _findNearestScrollableElement(element: ElementHandle): Promise<ElementHandle | null> {
    if (!this._puppeteerPage) {
      return null;
    }

    // Check if the current element is scrollable
    const isScrollable = await element.evaluate((el: Element) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const hasVerticalScrollbar = el.scrollHeight > el.clientHeight;
      const canScrollVertically =
        style.overflowY === 'scroll' ||
        style.overflowY === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflow === 'auto';

      return hasVerticalScrollbar && canScrollVertically;
    });

    if (isScrollable) {
      return element;
    }

    // Check parent elements
    let currentElement: ElementHandle<Element> | null = element;

    try {
      while (currentElement) {
        // Get the parent element (as an ElementHandle) of the current element
        const parentHandle = (await currentElement.evaluateHandle(
          (el: Element) => el.parentElement,
        )) as ElementHandle<Element> | null;

        const parentElement = parentHandle ? await parentHandle.asElement() : null;

        if (!parentElement) {
          // Reached the root without finding a scrollable ancestor
          currentElement = null;
          break;
        }

        const parentIsScrollable = await parentElement.evaluate((el: Element) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          const hasVerticalScrollbar = el.scrollHeight > el.clientHeight;
          const canScrollVertically =
            ['scroll', 'auto'].includes(style.overflowY) || ['scroll', 'auto'].includes(style.overflow);

          return hasVerticalScrollbar && canScrollVertically;
        });

        if (parentIsScrollable) {
          // Found a scrollable ancestor – return it (the caller should dispose when finished)
          return parentElement;
        }

        // Move up the DOM tree – dispose the previous element handle before continuing
        if (currentElement !== element) {
          try {
            await currentElement.dispose();
          } catch (disposeErr) {
            logger.debug('Failed to dispose element handle:', disposeErr);
          }
        }

        currentElement = parentElement;
      }
    } catch (error) {
      // Error accessing parent, break out of loop
      logger.error('Error finding scrollable parent:', error);
    }

    // If no scrollable ancestor found, return the document body or documentElement
    try {
      const bodyElement = await this._puppeteerPage.$('body');
      if (bodyElement) {
        const bodyIsScrollable = await bodyElement.evaluate(el => {
          if (!(el instanceof HTMLElement)) return false;
          return el.scrollHeight > el.clientHeight;
        });
        if (bodyIsScrollable) {
          return bodyElement;
        }
      }

      // Last resort: return document element for page-level scrolling
      const documentElement = await this._puppeteerPage.evaluateHandle(() => document.documentElement);
      const docElement = (await documentElement.asElement()) as ElementHandle<Element> | null;
      return docElement;
    } catch (error) {
      logger.error('Failed to find scrollable element:', error);
      return null;
    }
  }

  /** The last read, or null once anything has invalidated it. */
  getCachedState(): PageState | null {
    return this._cachedState;
  }

  /** The last read if nothing invalidated it and the tab is still on that URL; otherwise a new read. */
  async getCurrentState(useVision = false): Promise<PageState> {
    const cached = this._cachedState;
    if (cached && !this._pendingState && (!useVision || cached.screenshot)) {
      const liveUrl = await this._browserAdapter.getTab(this._tabId).then(
        tab => tab.url ?? '',
        () => cached.url,
      );
      if (liveUrl === cached.url && this._cachedState === cached) return cached;
    }
    return this.getState(useVision);
  }

  invalidateCache(): void {
    this._generation++;
    this._cachedState = null;
  }

  async getState(useVision = false): Promise<PageState> {
    const pending = this._pendingState;
    // A read started before an invalidation may predate the change the caller is waiting for.
    if (pending && pending.generation === this._generation && (pending.useVision || !useVision)) {
      return pending.promise;
    }
    const generation = this._generation;
    const promise = this._readState(useVision).then(state => {
      if (generation === this._generation) this._cachedState = state;
      return state;
    });
    const entry = { generation, useVision, promise };
    this._pendingState = entry;
    try {
      return await promise;
    } finally {
      if (this._pendingState === entry) this._pendingState = null;
    }
  }

  private async _readState(useVision: boolean): Promise<PageState> {
    // The tab may have left an initial chrome://newtab/ URL since this Page was constructed.
    await this._revalidateFromTab();
    if (!this._validWebPage) {
      return build_initial_state(this._tabId, this._state.url, this._state.title);
    }

    const dialog = this.pendingDialog;
    if (dialog) {
      // The page's scripts are paused until the dialog is answered; reading the page would only time out.
      const tab = await this._browserAdapter.getTab(this._tabId).catch(() => null);
      return { ...build_initial_state(this._tabId, tab?.url ?? this._state.url, tab?.title ?? this._state.title), dialog };
    }

    // Network idle only after the page moved (a navigation, the first read); otherwise only the DOM must hold still.
    const liveUrl = await this._browserAdapter.getTab(this._tabId).then(
      tab => tab.url ?? '',
      () => '',
    );
    if (liveUrl !== this._lastReadUrl) {
      await this.waitForPageAndFramesLoad();
    }
    await this._waitForDomStability();

    const read = async (): Promise<PageState | null> => {
      try {
        return await this._updateState(useVision);
      } catch (error) {
        if (error instanceof URLNotAllowedError) throw error;
        logger.warning(`[getState] Page read failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    };

    // SPAs paint a shell and hydrate later, and frames briefly fail mid-navigation: retry briefly.
    const MAX_DOM_RETRIES = 3;
    let state = await read();
    for (let attempt = 1; attempt < MAX_DOM_RETRIES && !(state && state.selectorMap.size > 0); attempt++) {
      const retryDelayMs = getAdaptiveDomRetryDelayMs(attempt);
      logger.warning(
        `[getState] Empty DOM on attempt ${attempt}/${MAX_DOM_RETRIES} for ${state?.url ?? this._state.url} — retrying in ${retryDelayMs}ms`,
      );
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      state = await read();
    }
    if (state) {
      this._lastReadUrl = state.url;
      return state;
    }

    // Never serve an older page as the current one: report the live tab with no elements.
    const tab = await this._browserAdapter.getTab(this._tabId).catch(() => null);
    return build_initial_state(this._tabId, tab?.url ?? this._state.url, tab?.title ?? this._state.title);
  }

  async _updateState(useVision = false): Promise<PageState> {
    try {
      // chrome.tabs.get is the authoritative URL/title: puppeteer can report about:blank mid-navigation.
      let url: string;
      let title: string;
      try {
        const tab = await this._browserAdapter.getTab(this._tabId);
        url = tab.url || this._puppeteerPage?.url() || '';
        title = tab.title || (await this._puppeteerPage?.title()) || '';
      } catch {
        url = this._puppeteerPage?.url() || '';
        title = (await this._puppeteerPage?.title()) || '';
      }
      // Checked on every read, so redirects, tab switches and pages opened by clicks cannot slip past the firewall.
      if (url && !isNewTabPage(url) && !isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
        await this._puppeteerPage?.goto(this._config.homePageUrl || 'about:blank').catch(() => undefined);
        throw new URLNotAllowedError(`URL: ${url} is not allowed`);
      }

      await this.removeHighlight();
      const displayHighlights = this._config.displayHighlights || useVision;
      const content = await this.getClickableElements(displayHighlights);
      if (!content) {
        throw new Error('Failed to get clickable elements');
      }

      // Take screenshot if needed
      const screenshot = useVision ? await this.takeScreenshot() : null;
      const [scrollY, visualViewportHeight, scrollHeight] = await this.getScrollInfo();

      // A new object per read: states handed out earlier are never mutated.
      this._state = {
        elementTree: content.elementTree,
        selectorMap: content.selectorMap,
        tabId: this._tabId,
        url,
        title,
        screenshot,
        scrollY,
        visualViewportHeight,
        scrollHeight,
      };

      // ── DOM → LLM COMPLETE LOG ───────────────────────────────────────────
      // Full structured dump of every interactive element sent to the LLM.
      // Open the background service worker DevTools to see this output.
      // NO elements are trimmed — the agent sees exactly what is logged here.
      if (this._config.logDOMSnapshot) {
        const elementCount = this._state.selectorMap.size;
        const logTime = new Date().toISOString();
        const divider = '─'.repeat(60);

        if (elementCount === 0) {
          console.warn(
            `\n╔══ [DOM→LLM] EMPTY PAGE ════════════════════════════════════╗\n` +
            `║ ⚠  EMPTY selector map — LLM sees NO interactive elements!\n` +
            `║ tab=${this._tabId}  url=${this._state.url}\n` +
            `║ time=${logTime}\n` +
            `╚════════════════════════════════════════════════════════════╝`,
          );
        } else {
          // Build per-element lines — ALL elements, no cap
          const allEntries = Array.from(this._state.selectorMap.entries());
          const lines = allEntries.map(([idx, el]) => {
            const tag         = el.tagName || '?';
            const text        = el.getAllTextTillNextClickableElement(3)?.trim() || '';
            const role        = el.attributes?.['role']          || '';
            const label       = el.attributes?.['aria-label']    || '';
            const href        = el.attributes?.['href']          || '';
            const ariasel     = el.attributes?.['aria-selected'] || '';
            const placeholder = el.attributes?.['placeholder']   || '';
            const eltype      = el.attributes?.['type']          || '';
            const name        = el.attributes?.['name']          || '';
            const elid        = el.attributes?.['id']            || '';
            const isNew       = (el as unknown as { isNew?: boolean }).isNew ? ' NEW' : '';

            const extras = [
              role        && `role=${role}`,
              label       && `aria="${label}"`,
              href        && `href=${href.slice(0, 60)}`,
              ariasel     && `aria-selected=${ariasel}`,
              placeholder && `placeholder="${placeholder}"`,
              eltype      && `type=${eltype}`,
              name        && `name="${name}"`,
              elid        && `id="${elid}"`,
            ].filter(Boolean).join(' | ');

            const textPart   = text   ? ` "${text}"`  : '';
            const extrasPart = extras ? `\n       ${extras}` : '';
            return `  [${idx}]${isNew} <${tag}>${textPart}${extrasPart}`;
          });

          // Tag-type frequency summary
          const tagCounts: Record<string, number> = {};
          for (const [, el] of allEntries) {
            const t = el.tagName || 'unknown';
            tagCounts[t] = (tagCounts[t] || 0) + 1;
          }
          const tagSummary = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => `${t}x${n}`)
            .join('  ');

          console.log(
            `\n[DOM→LLM] ` + divider + `\n` +
            `  tab     : ${this._tabId}\n` +
            `  url     : ${this._state.url}\n` +
            `  time    : ${logTime}\n` +
            `  scroll  : scrollY=${this._state.scrollY}px  bodyH=${this._state.scrollHeight}px  vpH=${Math.round(this._state.visualViewportHeight)}px\n` +
            `  elements: ${elementCount} total  [${tagSummary}]\n` +
            divider + `\n` +
            `${lines.join('\n')}\n` +
            divider,
          );
        }
      }
      // ────────────────────────────────────────────────────────────────────


      return this._state;
    } catch (error) {
      // getState retries, then reports the live tab with no elements; it never serves an older read.
      logger.warning('Failed to update state:', error);
      throw error;
    }
  }

  async takeScreenshot(fullPage = false): Promise<string | null> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    try {
      // First disable animations/transitions
      await this._puppeteerPage.evaluate(() => {
        const styleId = 'puppeteer-disable-animations';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            *, *::before, *::after {
              animation: none !important;
              transition: none !important;
            }
          `;
          document.head.appendChild(style);
        }
      });

      // Take the screenshot using JPEG format with 80% quality
      const screenshot = await this._puppeteerPage.screenshot({
        fullPage: fullPage,
        encoding: 'base64',
        type: 'jpeg',
        quality: 80, // Good balance between quality and file size
      });

      // Clean up the style element
      await this._puppeteerPage.evaluate(() => {
        const style = document.getElementById('puppeteer-disable-animations');
        if (style) {
          style.remove();
        }
      });

      return screenshot as string;
    } catch (error) {
      logger.error('Failed to take screenshot:', error);
      throw error;
    }
  }

  url(): string {
    // Note: this._puppeteerPage.url() can return 'about:blank' or an intermediate URL
    // during frame initialization after attach, even when the tab is on Gmail/Calendar.
    // Always prefer _state.url which is populated from chrome.tabs.get (authoritative).
    // Fall back to puppeteer only if state URL is empty.
    if (this._state.url && !isNewTabPage(this._state.url) && !this._state.url.startsWith('chrome://')) {
      return this._state.url;
    }
    if (this._puppeteerPage) {
      const puppeteerUrl = this._puppeteerPage.url();
      if (puppeteerUrl && !isNewTabPage(puppeteerUrl) && !puppeteerUrl.startsWith('chrome://')) {
        return puppeteerUrl;
      }
    }
    return this._state.url;
  }

  async title(): Promise<string> {
    if (this._puppeteerPage) {
      return await this._puppeteerPage.title();
    }
    return this._state.title;
  }

  async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }
    await this._navigate(page => page.goto(url, NAVIGATION_OPTIONS), `navigate to ${url}`);
  }

  async refreshPage(): Promise<void> {
    await this._navigate(page => page.reload(NAVIGATION_OPTIONS), 'reload');
  }

  async goBack(): Promise<void> {
    await this._navigate(page => page.goBack(NAVIGATION_OPTIONS), 'go back');
  }

  async goForward(): Promise<void> {
    await this._navigate(page => page.goForward(NAVIGATION_OPTIONS), 'go forward');
  }

  private async _navigate(navigation: (page: PuppeteerPage) => Promise<unknown>, label: string): Promise<void> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    logger.info(label);
    this.invalidateCache();
    this._agentNavigating = true;
    try {
      await navigation(this._puppeteerPage);
    } catch (error) {
      if (!(error instanceof Error && /timeout/i.test(error.message))) throw error;
      logger.warning(`${label} timed out; continuing with the partly loaded page`);
    } finally {
      this._agentNavigating = false;
    }
    const url = this._puppeteerPage?.url();
    if (url) this.updateUrl(url);
  }

  // scroll to a percentage of the page or element
  // if yPercent is 0, scroll to the top of the page, if 100, scroll to the bottom of the page
  // if elementNode is provided, scroll to a percentage of the element
  // if elementNode is not provided, scroll to a percentage of the page
  async scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    if (!elementNode) {
      await this._puppeteerPage.evaluate(yPercent => {
        const scrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const scrollTop = (scrollHeight - viewportHeight) * (yPercent / 100);
        window.scrollTo({
          top: scrollTop,
          left: window.scrollX,
          behavior: 'instant',
        });
      }, yPercent);
    } else {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Find the nearest scrollable ancestor
      const scrollableElement = await this._findNearestScrollableElement(element);
      if (!scrollableElement) {
        throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
      }

      await scrollableElement.evaluate((el, yPercent) => {
        const scrollHeight = el.scrollHeight;
        const viewportHeight = el.clientHeight;
        const scrollTop = (scrollHeight - viewportHeight) * (yPercent / 100);
        el.scrollTo({
          top: scrollTop,
          left: el.scrollLeft,
          behavior: 'instant',
        });
      }, yPercent);
    }
  }

  async scrollToPreviousPage(elementNode?: DOMElementNode): Promise<void> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    if (!elementNode) {
      // Scroll the whole page up by viewport height
      await this._puppeteerPage.evaluate('window.scrollBy(0, -(window.visualViewport?.height || window.innerHeight));');
    } else {
      // Scroll the specific element up by its client height
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Find the nearest scrollable ancestor
      const scrollableElement = await this._findNearestScrollableElement(element);
      if (!scrollableElement) {
        throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
      }

      await scrollableElement.evaluate(el => {
        el.scrollBy(0, -el.clientHeight);
      });
    }
  }

  async scrollToNextPage(elementNode?: DOMElementNode): Promise<void> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    if (!elementNode) {
      // Scroll the whole page down by viewport height
      await this._puppeteerPage.evaluate('window.scrollBy(0, (window.visualViewport?.height || window.innerHeight));');
    } else {
      // Scroll the specific element down by its client height
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Find the nearest scrollable ancestor
      const scrollableElement = await this._findNearestScrollableElement(element);
      if (!scrollableElement) {
        throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
      }

      await scrollableElement.evaluate(el => {
        el.scrollBy(0, el.clientHeight);
      });
    }
  }

  async sendKeys(keys: string): Promise<void> {
    const { modifiers, key } = normalizeKeyCombo(keys);
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    const keyboard = this._puppeteerPage.keyboard;
    try {
      for (const modifier of modifiers) await keyboard.down(modifier);
      // A key that opens a dialog is not acknowledged until the dialog closes.
      await Promise.race([keyboard.press(key), sleep(1500)]);
    } finally {
      for (const modifier of [...modifiers].reverse()) {
        await keyboard.up(modifier).catch(() => undefined);
      }
    }
  }

  /** Scrolls the nth visible match of the text (case-insensitive, open shadow roots and every frame included) into view. */
  async scrollToText(text: string, nth = 1): Promise<boolean> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    let remaining = nth;
    for (const frame of this._puppeteerPage.frames().filter(candidate => !candidate.detached)) {
      const found = await withTimeout(
        frame.evaluate(
          (needle, wanted) => {
            const matches: Element[] = [];
            const visit = (root: Node) => {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
              for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
                if (node.nodeType === Node.TEXT_NODE) {
                  const parent = node.parentElement;
                  if (parent && matches[matches.length - 1] !== parent && node.textContent?.toLowerCase().includes(needle)) {
                    const rect = parent.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) matches.push(parent);
                  }
                } else if ((node as Element).shadowRoot) {
                  visit((node as Element).shadowRoot as ShadowRoot);
                }
              }
            };
            visit(document.body ?? document.documentElement);
            const target = matches[wanted - 1];
            target?.scrollIntoView({ block: 'center', behavior: 'instant' });
            return target ? -1 : matches.length;
          },
          text.trim().toLowerCase(),
          remaining,
        ),
        2000,
        'scroll to text',
      ).catch(() => 0);
      if (found < 0) return true;
      remaining -= found;
    }
    return false;
  }

  /** The live element for a node of the last read, adopted by backendNodeId in the frame it came from. */
  async locateElement(element: DOMElementNode): Promise<ElementHandle | null> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage || element.backendNodeId == null) {
      return null;
    }
    const frame = element.frame ?? this._puppeteerPage.mainFrame();
    try {
      return (await frame.mainRealm().adoptBackendNode(element.backendNodeId)) as unknown as ElementHandle;
    } catch (error) {
      logger.warning(`${element} is no longer in the page: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async _requireHandle(node: DOMElementNode): Promise<ElementHandle> {
    const handle = await this.locateElement(node);
    if (!handle) {
      throw new Error(`Element with index ${node.highlightIndex} is no longer available`);
    }
    return handle;
  }

  private _pageClient(): CDPSession {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    return (this._puppeteerPage.mainFrame() as unknown as { client: CDPSession }).client;
  }

  /**
   * One mouse gesture on an element: scroll it into view, refuse it when disabled or covered, then send the
   * move/press/release events once. Events are never re-sent: an unacknowledged press may still land, and
   * a second one would click twice. Coordinates from clickablePoint include iframe offsets.
   */
  private async _dispatchMouse(
    handle: ElementHandle,
    kind: 'click' | 'right' | 'hover',
    { clickCount = 1, checkCover = true } = {},
  ): Promise<MouseOutcome> {
    // An inline element around positioned content (a link wrapping an absolutely placed image) has no box of its
    // own: aim at its first visible descendant.
    const sized = await handle.evaluateHandle(el => {
      const hasBox = (candidate: Element) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      return hasBox(el) ? el : (Array.from(el.querySelectorAll('*')).find(hasBox) ?? el);
    });
    const target = (sized.asElement() as ElementHandle | null) ?? handle;
    await target.scrollIntoView();
    const blocker = await target.evaluate(
      (el, isHover, checkCovered) => {
        if (!isHover && ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true')) {
          return 'The element is disabled';
        }
        if (!checkCovered) return null;
        const rect = el.getBoundingClientRect();
        const root = el.getRootNode() as unknown as DocumentOrShadowRoot;
        const hit = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return null;
        if (hit.closest('label')?.control === el) return null;
        const text = (hit.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
        return `The element is covered by <${hit.tagName.toLowerCase()}>${text ? ` "${text}"` : ''}; close or move past it first`;
      },
      kind === 'hover',
      checkCover,
    );
    if (blocker) {
      throw new Error(blocker);
    }
    const { x, y } = await target.clickablePoint().catch(() => {
      throw new Error('The element has no visible area to point at (hidden, collapsed or off the page); choose another element.');
    });

    const client = this._pageClient();
    const button = kind === 'right' ? 'right' : 'left';
    this._fileChooserOpened = false;
    const events: Promise<unknown>[] = [client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })];
    if (kind !== 'hover') {
      for (let count = 1; count <= clickCount; count++) {
        events.push(client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count }));
        events.push(client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count }));
      }
    }
    const startedAt = Date.now();
    const settled = await Promise.race([
      Promise.all(events).then(
        () => 'acked' as const,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
      ),
      sleep(1500).then(() => 'timeout' as const),
    ]);
    const dialog = this.pendingDialog ?? undefined;
    record({
      level: settled === 'acked' || dialog ? 'info' : 'warning',
      kind: 'span',
      component: 'Page',
      msg: 'input dispatch',
      durationMs: Date.now() - startedAt,
      data: { kind, acked: settled === 'acked', dialogOpened: Boolean(dialog) },
    });
    if (settled instanceof Error) {
      throw settled;
    }
    return { dialog, fileChooser: this._fileChooserOpened };
  }

  async clickNode(node: DOMElementNode, clickCount = 1): Promise<MouseOutcome> {
    return this._dispatchMouse(await this._requireHandle(node), 'click', { clickCount });
  }

  async hoverNode(node: DOMElementNode): Promise<MouseOutcome> {
    return this._dispatchMouse(await this._requireHandle(node), 'hover');
  }

  async rightClickNode(node: DOMElementNode): Promise<MouseOutcome> {
    return this._dispatchMouse(await this._requireHandle(node), 'right');
  }

  /**
   * Replaces the field's content with text and reads it back from the live element. Text goes in as one
   * Input.insertText (what an IME or paste does, so framework-controlled inputs see it); date, range and
   * similar inputs get their value set directly. Password values never leave this method.
   */
  async inputTextNode(node: DOMElementNode, text: string): Promise<InputOutcome> {
    const handle = await this._requireHandle(node);
    const field = await handle.evaluate(el => {
      const input = el as HTMLInputElement;
      const tag = el.tagName.toLowerCase();
      if (input.disabled || el.getAttribute('aria-disabled') === 'true') return { error: 'The field is disabled' };
      if (input.readOnly) return { error: 'The field is read-only' };
      if (tag === 'input' && ['date', 'datetime-local', 'time', 'month', 'week', 'color', 'range'].includes(input.type)) {
        return { mode: 'setter', type: input.type, secret: false };
      }
      if (tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable) {
        return { mode: 'insert', type: tag === 'input' ? input.type : tag, secret: tag === 'input' && input.type === 'password' };
      }
      return { error: `A <${tag}> does not accept text; type into an input, textarea or editable element` };
    });
    if ('error' in field) {
      throw new Error(field.error);
    }

    const expected = field.type === 'date' ? toDateInputValue(text) : text;
    const setValue = (value: string) =>
      handle.evaluate((el, next) => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
        if (setter) setter.call(el, next);
        else (el as HTMLElement).innerText = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);

    if (field.mode === 'setter') {
      await setValue(expected);
    } else {
      // A real click puts focus in the field's own frame; programmatic focus cannot enter a cross-site iframe.
      await this._dispatchMouse(handle, 'click', { checkCover: false });
      await handle.evaluate(el => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          el.select();
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await withTimeout(
        text ? this._pageClient().send('Input.insertText', { text }) : this._puppeteerPage!.keyboard.press('Backspace'),
        2000,
        'typing',
      );
    }

    const readBack = () =>
      handle.evaluate(el =>
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText ?? '',
      );
    const same = (value: string) => value.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim();
    let actual = await readBack();
    if (!same(actual) && field.mode === 'insert') {
      // Some pages swallow inserted text; set the value directly once and let the page's listeners see it.
      await setValue(text);
      actual = await readBack();
    }
    return { matched: same(actual), secret: field.secret, actualLength: actual.length, actual: field.secret ? null : actual };
  }

  /** Visible option texts of a native select, or of an ARIA combobox/listbox (opened to render them). */
  async dropdownOptions(node: DOMElementNode): Promise<string[]> {
    const handle = await this._requireHandle(node);
    const native = await handle.evaluate(el => (el instanceof HTMLSelectElement ? Array.from(el.options).map(option => option.text.trim()) : null));
    if (native) {
      return native;
    }
    let options = await this._ariaOptionTexts(handle);
    if (options.length === 0) {
      await this._dispatchMouse(handle, 'click', { checkCover: false });
      const deadline = Date.now() + 1000;
      while (options.length === 0 && Date.now() < deadline) {
        await sleep(100);
        options = await this._ariaOptionTexts(handle);
      }
    }
    return options;
  }

  /** Selects by visible text: sets a native select, or opens an ARIA widget and clicks the matching option. */
  async selectOption(node: DOMElementNode, text: string): Promise<{ selected: boolean; confirmed: boolean; message: string }> {
    const handle = await this._requireHandle(node);
    const native = await handle.evaluate((el, wanted) => {
      if (!(el instanceof HTMLSelectElement)) return null;
      const options = Array.from(el.options);
      const option = options.find(candidate => candidate.text.trim() === wanted.trim());
      if (!option) {
        return {
          selected: false,
          confirmed: false,
          message: `Option "${wanted}" not found. Available options: ${options.map(candidate => `"${candidate.text.trim()}"`).join(', ')}`,
        };
      }
      if (el.value !== option.value) {
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { selected: true, confirmed: el.value === option.value, message: `Selected option "${wanted}"` };
    }, text);
    if (native) {
      return native;
    }

    let option = await this._ariaOption(handle, text);
    if (!option) {
      await this._dispatchMouse(handle, 'click', { checkCover: false });
      const deadline = Date.now() + 1000;
      while (!option && Date.now() < deadline) {
        await sleep(100);
        option = await this._ariaOption(handle, text);
      }
    }
    if (!option) {
      const available = await this._ariaOptionTexts(handle);
      return {
        selected: false,
        confirmed: false,
        message: `Option "${text}" not found${available.length ? `. Available options: ${available.map(o => `"${o}"`).join(', ')}` : ' after opening the dropdown'}`,
      };
    }
    await this._dispatchMouse(option, 'click', { checkCover: false });
    await sleep(100);
    const confirmed = await handle
      .evaluate((el, wanted) => {
        const shows = (candidate: Element | null) =>
          Boolean(candidate && `${(candidate as HTMLInputElement).value ?? ''} ${candidate.textContent ?? ''}`.includes(wanted));
        return shows(el) || shows(el.parentElement) || shows(el.parentElement?.parentElement ?? null) || shows(el.parentElement?.parentElement?.parentElement ?? null);
      }, text)
      .catch(() => false);
    return { selected: true, confirmed, message: `Selected option "${text}"` };
  }

  private async _ariaOptionTexts(handle: ElementHandle): Promise<string[]> {
    return handle.evaluate(el => {
      const doc = el.ownerDocument;
      const ids = `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean);
      const scopes = ids.map(id => doc.getElementById(id)).filter((scope): scope is HTMLElement => scope !== null);
      return (scopes.length ? scopes : [doc])
        .flatMap(scope => Array.from(scope.querySelectorAll('[role="option"]')))
        .filter(option => option.getBoundingClientRect().height > 0)
        .map(option => (option.textContent ?? '').trim().replace(/\s+/g, ' '));
    });
  }

  private async _ariaOption(handle: ElementHandle, text: string): Promise<ElementHandle | null> {
    const found = await handle.evaluateHandle((el, wanted) => {
      const doc = el.ownerDocument;
      const ids = `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean);
      const scopes = ids.map(id => doc.getElementById(id)).filter((scope): scope is HTMLElement => scope !== null);
      const normalized = wanted.trim().replace(/\s+/g, ' ');
      return (
        (scopes.length ? scopes : [doc])
          .flatMap(scope => Array.from(scope.querySelectorAll('[role="option"]')))
          .find(option => option.getBoundingClientRect().height > 0 && (option.textContent ?? '').trim().replace(/\s+/g, ' ') === normalized) ?? null
      );
    }, text);
    const element = found.asElement() as ElementHandle | null;
    if (!element) {
      await found.dispose();
    }
    return element;
  }

  /** Drags one element onto another: HTML5 draggables through drag interception, anything else with mouse moves. */
  async dragNode(sourceNode: DOMElementNode, targetNode: DOMElementNode): Promise<void> {
    const source = await this._requireHandle(sourceNode);
    const target = await this._requireHandle(targetNode);
    const page = this._puppeteerPage!;
    await source.scrollIntoView();
    const html5 = await source.evaluate(el => el.closest('[draggable="true"]') !== null);
    if (html5) {
      // Mouse events do not start an HTML5 drag in an automated tab; intercepted drags are replayed as drag events.
      await page.setDragInterception(true);
      try {
        await source.dragAndDrop(target, { delay: 50 });
      } finally {
        await page.setDragInterception(false);
      }
      return;
    }
    const from = await source.clickablePoint();
    const to = await target.clickablePoint();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 15 });
    await page.mouse.up();
  }

  get pendingDialog(): PageDialog | null {
    const dialog = this._pendingDialog;
    return dialog ? { type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() || undefined } : null;
  }

  async handleDialog(accept: boolean, promptText?: string): Promise<string> {
    const dialog = this._pendingDialog;
    if (!dialog) {
      return 'No dialog is showing.';
    }
    this._pendingDialog = null;
    this.invalidateCache();
    const description = `${dialog.type()} dialog "${dialog.message().slice(0, 200)}"`;
    try {
      if (accept) await dialog.accept(promptText);
      else await dialog.dismiss();
    } catch (error) {
      logger.warning(`Answering the ${description} failed: ${error instanceof Error ? error.message : String(error)}`);
      return `The ${description} was already closed.`;
    }
    return `${accept ? 'Accepted' : 'Dismissed'} the ${description}${accept && promptText !== undefined ? ' after entering the text' : ''}.`;
  }

  private async _waitForStableNetwork() {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe', 'xhr', 'fetch']);

    const RELEVANT_CONTENT_TYPES = new Set([
      'text/html',
      'text/css',
      'application/javascript',
      'image/',
      'font/',
      'application/json',
    ]);

    const IGNORED_URL_PATTERNS = new Set([
      // Analytics and tracking
      'analytics',
      'tracking',
      'telemetry',
      'beacon',
      'metrics',
      // Ad-related
      'doubleclick',
      'adsystem',
      'adserver',
      'advertising',
      // Social media widgets
      'facebook.com/plugins',
      'platform.twitter',
      'linkedin.com/embed',
      // Live chat and support
      'livechat',
      'zendesk',
      'intercom',
      'crisp.chat',
      'hotjar',
      // Push notifications
      'push-notifications',
      'onesignal',
      'pushwoosh',
      // Background sync/heartbeat
      'heartbeat',
      'ping',
      'alive',
      // WebRTC and streaming
      'webrtc',
      'rtmp://',
      'wss://',
      // Common CDNs
      'cloudfront.net',
      'fastly.net',
    ]);

    const pendingRequests = new Set();
    let lastActivity = Date.now();

    const onRequest = (request: HTTPRequest) => {
      // Filter by resource type
      const resourceType = request.resourceType();
      if (!RELEVANT_RESOURCE_TYPES.has(resourceType)) {
        return;
      }

      // Filter out streaming, websocket, and other real-time requests
      if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(resourceType)) {
        return;
      }

      // Filter out by URL patterns
      const url = request.url().toLowerCase();
      if (Array.from(IGNORED_URL_PATTERNS).some(pattern => url.includes(pattern))) {
        return;
      }

      // Filter out data URLs and blob URLs
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        return;
      }

      // Filter out requests with certain headers
      const headers = request.headers();
      if (
        // biome-ignore lint/complexity/useLiteralKeys: <explanation>
        headers['purpose'] === 'prefetch' ||
        headers['sec-fetch-dest'] === 'video' ||
        headers['sec-fetch-dest'] === 'audio'
      ) {
        return;
      }

      pendingRequests.add(request);
      lastActivity = Date.now();
    };

    const onResponse = (response: HTTPResponse) => {
      const request = response.request();
      if (!pendingRequests.has(request)) {
        return;
      }

      // Filter by content type
      const contentType = response.headers()['content-type']?.toLowerCase() || '';

      // Skip streaming content
      if (
        ['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(t =>
          contentType.includes(t),
        )
      ) {
        pendingRequests.delete(request);
        return;
      }

      // Only process relevant content types
      if (!Array.from(RELEVANT_CONTENT_TYPES).some(ct => contentType.includes(ct))) {
        pendingRequests.delete(request);
        return;
      }

      // Skip large responses
      const contentLength = response.headers()['content-length'];
      if (contentLength && Number.parseInt(contentLength) > 5 * 1024 * 1024) {
        // 5MB
        pendingRequests.delete(request);
        return;
      }

      pendingRequests.delete(request);
      lastActivity = Date.now();
    };

    // Add event listeners
    this._puppeteerPage.on('request', onRequest);
    this._puppeteerPage.on('response', onResponse);

    try {
      const startTime = Date.now();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const now = Date.now();
        const timeSinceLastActivity = (now - lastActivity) / 1000; // Convert to seconds

        if (pendingRequests.size === 0 && timeSinceLastActivity >= this._config.waitForNetworkIdlePageLoadTime) {
          break;
        }

        const elapsedTime = (now - startTime) / 1000; // Convert to seconds
        if (elapsedTime > this._config.maximumWaitPageLoadTime) {
          console.debug(
            `Network timeout after ${this._config.maximumWaitPageLoadTime}s with ${pendingRequests.size} pending requests:`,
            Array.from(pendingRequests).map(r => (r as HTTPRequest).url()),
          );
          break;
        }
      }
    } finally {
      // Clean up event listeners
      this._puppeteerPage.off('request', onRequest);
      this._puppeteerPage.off('response', onResponse);
    }
    console.debug(`Network stabilized for ${this._config.waitForNetworkIdlePageLoadTime} seconds`);
  }

  async waitForPageAndFramesLoad(timeoutOverwrite?: number): Promise<void> {
    // Start timing
    const startTime = Date.now();

    // Wait for page load
    try {
      await this._waitForStableNetwork();

      // Check if the loaded URL is allowed
      if (this._puppeteerPage) {
        await this._checkAndHandleNavigation();
      }
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }
      console.warn('Page load failed, continuing...', error);
    }

    // Calculate remaining time to meet minimum wait time
    const elapsed = (Date.now() - startTime) / 1000; // Convert to seconds
    const minWaitTime = timeoutOverwrite || this._config.minimumWaitPageLoadTime;
    const remaining = Math.max(minWaitTime - elapsed, 0);

    console.debug(
      `--Page loaded in ${elapsed.toFixed(2)} seconds, waiting for additional ${remaining.toFixed(2)} seconds`,
    );

    // Sleep remaining time if needed
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining * 1000)); // Convert seconds to milliseconds
    }
  }

  /** The text of every frame of the page, each child frame under a header with its URL. */
  async getCompletePageContent(): Promise<string> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    const main = this._puppeteerPage.mainFrame();
    const parts = await Promise.all(
      this._puppeteerPage
        .frames()
        .filter(frame => !frame.detached)
        .map(async frame => {
          const text = await withTimeout(frame.evaluate(() => document.body?.innerText ?? ''), 2000, 'page text').catch(() => '');
          const trimmed = text.trim();
          if (!trimmed) return '';
          return frame === main ? trimmed : `[Frame ${frame.url()}]\n${trimmed}`;
        }),
    );
    return parts.filter(Boolean).join('\n\n');
  }

  /**
   * Check the current page URL and handle if it's not allowed
   * @throws URLNotAllowedError if the current URL is not allowed
   */
  private async _checkAndHandleNavigation(): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }

    const currentUrl = this._puppeteerPage.url();

    // New tab pages (about:blank, chrome://new-tab-page) are a valid navigation state.
    // Only mark as invalid for URLs that are explicitly blocked.
    if (isNewTabPage(currentUrl)) {
      // Silently allow — do not change _validWebPage, do not throw
      return;
    }

    if (!isUrlAllowed(currentUrl, this._config.allowedUrls, this._config.deniedUrls)) {
      const errorMessage = `URL: ${currentUrl} is not allowed`;
      logger.error(errorMessage);

      // Navigate to home page or about:blank
      const safeUrl = this._config.homePageUrl || 'about:blank';
      logger.info(`Redirecting to safe URL: ${safeUrl}`);

      try {
        await this._puppeteerPage.goto(safeUrl);
      } catch (error) {
        logger.error(`Failed to redirect to safe URL: ${error instanceof Error ? error.message : String(error)}`);
      }

      throw new URLNotAllowedError(errorMessage);
    }
  }
}

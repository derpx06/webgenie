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
import type { Frame } from 'puppeteer-core/lib/esm/puppeteer/api/Frame.js';
import {
  getClickableElements as _getClickableElements,
  removeHighlights as _removeHighlights,
  getScrollInfo as _getScrollInfo,
  drawHighlightOverlaysViaCoordinates,
} from './dom/service';
import { DOMElementNode, type DOMState } from './dom/views';
import { type BrowserContextConfig, DEFAULT_BROWSER_CONTEXT_CONFIG, type PageState, URLNotAllowedError } from './views';
import { createLogger } from '@src/background/log';
import { ClickableElementProcessor } from './dom/clickable/service';
import { isUrlAllowed, isNewTabPage } from './util';
import { getDOMStateViaSnapshot } from './chromium-apis/dom-snapshot-extractor';
import { getAXTreeState } from './chromium-apis/ax-tree-extractor';
import { pruneAXTree } from './dom/ax-tree-pruner';
import { healElement } from './dom/selector-healer';
import { cdpBridge } from './chromium-apis/cdp-bridge';


const logger = createLogger('Page');

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

/**
 * Cached clickable elements hashes for the last state
 */
export class CachedStateClickableElementsHashes {
  url: string;
  hashes: Set<string>;

  constructor(url: string, hashes: Set<string>) {
    this.url = url;
    this.hashes = hashes;
  }
}

export default class Page {
  private _tabId: number;
  private _browser: Browser | null = null;
  private _puppeteerPage: PuppeteerPage | null = null;
  private _config: BrowserContextConfig;
  private _state: PageState;
  private _validWebPage = false;
  private _cachedState: PageState | null = null;
  private _cachedStateClickableElementsHashes: CachedStateClickableElementsHashes | null = null;

  constructor(tabId: number, url: string, title: string, config: Partial<BrowserContextConfig> = {}) {
    this._tabId = tabId;
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this._state = build_initial_state(tabId, url, title);
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
    this._state.url = url;
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
      this._cachedState = null;
      this._cachedStateClickableElementsHashes = null;
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
      const tab = await chrome.tabs.get(this._tabId);
      this.refreshValidWebPage(tab.url ?? '');
      if (this._validWebPage) {
        // Update the cached state URL/title now that we know the real URL
        this._state.url = tab.url ?? '';
        this._state.title = tab.title ?? '';
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
    try {
      await chrome.debugger.detach({ tabId: this._tabId });
      logger.info('Detached existing debugger session on tab', this._tabId);
    } catch (err) {
      // Ignore if debugger was not attached
    }

    const browser = await connect({
      transport: await ExtensionTransport.connectTab(this._tabId),
      defaultViewport: null,
      protocol: 'cdp' as ProtocolType,
    });
    this._browser = browser;

    const [page] = await browser.pages();
    this._puppeteerPage = page;

    // Add anti-detection scripts
    await this._addAntiDetectionScripts();

    // ── DIALOG WATCHDOG ──────────────────────────────────────────────────────
    // Auto-dismiss unexpected native dialogs (alert/confirm/prompt/beforeunload).
    // Without this, any dialog will freeze the Puppeteer CDP session until the
    // agent's step timeout fires, causing a full step failure.
    this._puppeteerPage.on('dialog', async dialog => {
      logger.warning(
        `[DialogWatchdog] Auto-dismissing ${dialog.type()} dialog: "${dialog.message().slice(0, 120)}"`
      );
      try {
        // For confirm/beforeunload, accept is usually the safer action
        // (allows navigation/submission to proceed).
        // For alert/prompt, accept or dismiss are equivalent for unblocking.
        await dialog.accept();
      } catch {
        try { await dialog.dismiss(); } catch { /* ignore — dialog may have closed itself */ }
      }
    });
    // ────────────────────────────────────────────────────────────────────────

    return true;
  }

  public async sendCDPCommand(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not attached to this page');
    }
    return chrome.debugger.sendCommand({ tabId: this._tabId }, method, params);
  }

  public async cdpClick(element: ElementHandle<Element>): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not attached to this page');
    }
    
    // Fetch high-precision viewport coordinates using client rects to avoid clicking empty space on line wraps or large wrappers
    const coords = await element.evaluate((el) => {
      const rects = el.getClientRects();
      if (rects.length > 0) {
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r.width > 0 && r.height > 0) {
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
      }
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') {
      throw new Error('Element has no visible layout rectangles');
    }

    await this._puppeteerPage.bringToFront();
    await this._puppeteerPage.mouse.move(coords.x, coords.y);
    await this._puppeteerPage.mouse.click(coords.x, coords.y, { delay: 50 });
  }

  public async cdpType(element: ElementHandle<Element>, text: string): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not attached to this page');
    }
    await this._puppeteerPage.bringToFront();
    
    // Natively focus and position the cursor by clicking the element first
    try {
      await this.cdpClick(element);
    } catch (clickErr) {
      logger.warning('Failed to click element before typing in cdpType, focusing programmatically', clickErr);
      await element.focus();
    }
    
    // Brief delay to allow click/focus handlers to process
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await this._puppeteerPage.keyboard.type(text, { delay: 35 });
  }


  private async _addAntiDetectionScripts(): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }

    await this._puppeteerPage.evaluateOnNewDocument(`
      // Webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Languages
      // Object.defineProperty(navigator, 'languages', {
      //   get: () => ['en-US']
      // });

      // Plugins
      // Object.defineProperty(navigator, 'plugins', {
      //   get: () => [1, 2, 3, 4, 5]
      // });

      // Chrome runtime
      window.chrome = { runtime: {} };

      // Permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // Shadow DOM
      (function () {
        const originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function attachShadow(options) {
          return originalAttachShadow.call(this, { ...options, mode: "open" });
        };
      })();
    `);
  }

  async detachPuppeteer(): Promise<void> {
    if (this._browser) {
      await this._browser.disconnect();
      this._browser = null;
      this._puppeteerPage = null;
      // reset the state
      this._state = build_initial_state(this._tabId);
    }
  }

  async removeHighlight(): Promise<void> {
    if (this._config.displayHighlights && this._validWebPage) {
      await _removeHighlights(this._tabId);
    }
  }

  async getClickableElements(showHighlightElements: boolean, focusElement: number): Promise<DOMState | null> {
    if (!this._validWebPage) {
      return null;
    }

    // Wait for layout/DOM stability before any extraction
    try {
      await this._waitForDomStability();
    } catch (err) {
      logger.warning('[Page] Error waiting for DOM stability:', err);
    }

    const mode = this._config.domPerceptionMode ?? 'snapshot';

    // ── Path A: AXTree-first ──────────────────────────────────────────────────
    // Token-efficient, CSP-proof. Uses native Accessibility domain, no script injection.
    if (mode === 'axtree') {
      try {
        const { width, height } = this._config.browserWindowSize;
        const rawState = await getAXTreeState(this._tabId, width, height);
        if (rawState && rawState.selectorMap.size > 0) {
          let goal: string | undefined;
          try {
            const registryState = await chrome.storage.local.get('tab-orchestration-state');
            const tabRecord = registryState?.['tab-orchestration-state']?.tabs?.[this._tabId];
            if (tabRecord && tabRecord.purpose) {
              goal = tabRecord.purpose;
            }
          } catch {
            // Ignore
          }
          const state = pruneAXTree(rawState, goal);
          logger.info(`[Page] AXTree: ${state.selectorMap.size} interactive elements after pruning`);
          if (showHighlightElements) {
            await this._drawHighlightsFromCoords(state);
          }
          return state;
        }
        logger.warning('[Page] AXTree returned empty selectorMap — falling through to snapshot');
      } catch (err) {
        logger.error('[Page] AXTree extraction error — falling through to snapshot:', err);
      }
    }

    // ── Path B: DOMSnapshot ───────────────────────────────────────────────────
    // Current default. Coordinate-rich, high-fidelity, CSP-proof via CDP.
    if (mode === 'snapshot' || mode === 'axtree') {
      try {
        const state = await getDOMStateViaSnapshot(this._tabId);
        if (state && state.selectorMap.size > 0) {
          if (showHighlightElements) {
            await this._drawHighlightsFromCoords(state);
          }
          return state;
        }
      } catch (error) {
        logger.error('[Page] DOMSnapshot extraction failed, falling back to legacy DOM service:', error);
      }
    }

    // ── Path C: Legacy script-injection ──────────────────────────────────────
    // Final fallback — CSP-vulnerable but works without debugger permission.
    let tabUrl = this._state.url;
    try {
      const tab = await chrome.tabs.get(this._tabId);
      tabUrl = tab.url ?? tabUrl;
    } catch {
      // Tab closed or inaccessible
    }
    return _getClickableElements(
      this._tabId,
      tabUrl,
      showHighlightElements,
      focusElement,
      this._config.viewportExpansion,
    );
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
      await drawHighlightOverlaysViaCoordinates(this._tabId, rects);
    }
  }

  /**
   * Non-blocking node count monitor that waits for DOM stabilization before parsing.
   */
  private async _waitForDomStability(maxWaitMs = 1500, checkIntervalMs = 100): Promise<void> {
    let prevNodeCount = 0;
    let stableTicks = 0;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        let nodeCount = 0;
        if (this._puppeteerPage) {
          const frames = this._puppeteerPage.frames();
          const counts = await Promise.all(
            frames.map(async (frame) => {
              try {
                return await frame.evaluate(() => document.getElementsByTagName('*').length);
              } catch {
                return 0;
              }
            })
          );
          nodeCount = counts.reduce((sum, c) => sum + c, 0);
        } else {
          const mainCount = await cdpBridge.evaluate<number>(
            this._tabId,
            "document.getElementsByTagName('*').length"
          );
          nodeCount = mainCount ?? 0;
        }

        if (nodeCount > 0) {
          if (nodeCount === prevNodeCount) {
            stableTicks++;
            if (stableTicks >= 2) {
              logger.info(`[waitForDomStability] DOM stabilized at ${nodeCount} elements across all frames.`);
              return;
            }
          } else {
            stableTicks = 0;
            prevNodeCount = nodeCount;
          }
        }
      } catch {
        // Continue
      }
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
    logger.info(`[waitForDomStability] Timeout reached before absolute stability.`);
  }

  // Get scroll position information for the current page.
  async getScrollInfo(): Promise<[number, number, number]> {
    if (!this._validWebPage) {
      return [0, 0, 0];
    }
    return _getScrollInfo(this._tabId);
  }

  // Get scroll position information for a specific element.
  async getElementScrollInfo(elementNode: DOMElementNode): Promise<[number, number, number]> {
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

  async getContent(): Promise<string> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    return await this._puppeteerPage.content();
  }

  getCachedState(): PageState | null {
    return this._cachedState;
  }

  async getState(useVision = false, cacheClickableElementsHashes = false): Promise<PageState> {
    // Re-validate from the live tab URL in case the tab has navigated away from
    // an initial chrome://newtab/ URL since this Page was constructed.
    await this._revalidateFromTab();

    if (!this._validWebPage) {
      // return the initial state
      return build_initial_state(this._tabId);
    }
    await this.waitForPageAndFramesLoad();

    // SPA-aware DOM extraction: retry up to 3 times if the page returns an empty
    // selector map. Gmail and other SPAs paint the shell first then hydrate the
    // inbox asynchronously — network-idle fires too early. Retrying with a short
    // delay gives the JS framework time to finish rendering.
    const MAX_DOM_RETRIES = 3;
    const DOM_RETRY_DELAY_MS = 1500;
    let updatedState = await this._updateState(useVision);

    for (let attempt = 1; attempt < MAX_DOM_RETRIES; attempt++) {
      if (updatedState.selectorMap.size > 0) break; // got elements — done
      logger.warning(
        `[getState] Empty DOM on attempt ${attempt}/${MAX_DOM_RETRIES} for ${updatedState.url} — retrying in ${DOM_RETRY_DELAY_MS}ms`,
      );
      await new Promise(resolve => setTimeout(resolve, DOM_RETRY_DELAY_MS));
      updatedState = await this._updateState(useVision);
    }

    if (updatedState.selectorMap.size === 0) {
      logger.warning(`[getState] DOM still empty after ${MAX_DOM_RETRIES} attempts — serving cached state if available`);
      if (this._cachedState && this._cachedState.selectorMap.size > 0) {
        return this._cachedState;
      }
    }

    // Find out which elements are new
    // Do this only if url has not changed
    if (cacheClickableElementsHashes) {
      // If we are on the same url as the last state, we can use the cached hashes
      if (
        this._cachedStateClickableElementsHashes &&
        this._cachedStateClickableElementsHashes.url === updatedState.url
      ) {
        // Get clickable elements from the updated state
        const updatedStateClickableElements = ClickableElementProcessor.getClickableElements(updatedState.elementTree);

        // Mark elements as new if they weren't in the previous state
        for (const domElement of updatedStateClickableElements) {
          const hash = await ClickableElementProcessor.hashDomElement(domElement);
          domElement.isNew = !this._cachedStateClickableElementsHashes.hashes.has(hash);
        }
      }

      // In any case, we need to cache the new hashes
      const newHashes = await ClickableElementProcessor.getClickableElementsHashes(updatedState.elementTree);
      this._cachedStateClickableElementsHashes = new CachedStateClickableElementsHashes(updatedState.url, newHashes);
    }

    // Save the updated state as the cached state
    this._cachedState = updatedState;

    return updatedState;
  }

  async _updateState(useVision = false, focusElement = -1): Promise<PageState> {
    // ── Puppeteer liveness check ─────────────────────────────────────────────
    // _puppeteerPage may be null when the page was constructed from a newtab URL
    // and Puppeteer hasn't attached yet (e.g. Gmail is still loading). In that
    // case we skip the CDP ping and fall through to the chrome.scripting DOM
    // extraction which works without Puppeteer.
    if (this._puppeteerPage) {
      try {
        await this._puppeteerPage.evaluate('1');
      } catch (error) {
        logger.warning('Current page is no longer accessible via CDP:', error);
        // Try to recover by grabbing another page from the browser
        if (this._browser) {
          try {
            const pages = await this._browser.pages();
            if (pages.length > 0) {
              this._puppeteerPage = pages[0];
            }
          } catch {
            // Browser disconnected — clear references; chrome.scripting still works
            this._puppeteerPage = null;
            this._browser = null;
          }
        } else {
          // No browser reference — Puppeteer is gone, clear it
          this._puppeteerPage = null;
        }
      }
    } else {
      // No CDP session yet — attempt a non-blocking re-attach so future interactions work
      this.attachPuppeteer().catch(err =>
        logger.debug('[_updateState] Background puppeteer re-attach failed (non-fatal):', err)
      );
    }

    try {
      await this.removeHighlight();

      // Get DOM content (equivalent to dom_service.get_clickable_elements)
      // This part would need to be implemented based on your DomService logic
      // showHighlightElements is true if either useVision or displayHighlights is true
      const displayHighlights = this._config.displayHighlights || useVision;
      const content = await this.getClickableElements(displayHighlights, focusElement);
      if (!content) {
        logger.warning('Failed to get clickable elements');
        // Return last known good state if available
        return this._state;
      }
      // log the attributes of content object
      if ('selectorMap' in content) {
        logger.debug('content.selectorMap:', content.selectorMap.size);
      } else {
        logger.debug('content.selectorMap: not found');
      }
      if ('elementTree' in content) {
        logger.debug('content.elementTree:', content.elementTree?.tagName);
      } else {
        logger.debug('content.elementTree: not found');
      }

      // Take screenshot if needed
      const screenshot = useVision ? await this.takeScreenshot() : null;
      const [scrollY, visualViewportHeight, scrollHeight] = await this.getScrollInfo();

      // update the state
      this._state.elementTree = content.elementTree;
      this._state.selectorMap = content.selectorMap;
      // Use chrome.tabs.get as the authoritative URL/title source.
      // puppeteer.url() can return 'about:blank' during/after cross-origin navigation,
      // which would cause dom/service.ts to return an empty DOM tree.
      try {
        const tab = await chrome.tabs.get(this._tabId);
        this._state.url = tab.url || this._puppeteerPage?.url() || '';
        this._state.title = tab.title || (await this._puppeteerPage?.title()) || '';
      } catch {
        this._state.url = this._puppeteerPage?.url() || '';
        this._state.title = (await this._puppeteerPage?.title()) || '';
      }
      this._state.screenshot = screenshot;
      this._state.scrollY = scrollY;
      this._state.visualViewportHeight = visualViewportHeight;
      this._state.scrollHeight = scrollHeight;

      // ── DOM → LLM COMPLETE LOG ───────────────────────────────────────────
      // Full structured dump of every interactive element sent to the LLM.
      // Open the background service worker DevTools to see this output.
      // NO elements are trimmed — the agent sees exactly what is logged here.
      {
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
            const testid      = el.attributes?.['data-testid']   || '';
            const ariasel     = el.attributes?.['aria-selected'] || '';
            const placeholder = el.attributes?.['placeholder']   || '';
            const eltype      = el.attributes?.['type']          || '';
            const name        = el.attributes?.['name']          || '';
            const elid        = el.attributes?.['id']            || '';
            const cls         = (el.attributes?.['class'] || '').slice(0, 40);
            const isNew       = (el as unknown as { isNew?: boolean }).isNew ? ' NEW' : '';

            const extras = [
              role        && `role=${role}`,
              label       && `aria="${label}"`,
              href        && `href=${href.slice(0, 60)}`,
              testid      && `data-testid="${testid}"`,
              ariasel     && `aria-selected=${ariasel}`,
              placeholder && `placeholder="${placeholder}"`,
              eltype      && `type=${eltype}`,
              name        && `name="${name}"`,
              elid        && `id="${elid}"`,
              cls         && `class="${cls}"`,
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
      const errMsg = error instanceof Error ? error.message : String(error);
      // When Chrome transitions to a new frame (e.g. navigateTo gmail.com), the
      // old frame is briefly marked as an "error page" before the new frame is
      // ready. If we silently return this._state here, the stale selectorMap
      // (e.g. 200 Google elements) makes getState's SPA retry loop think the DOM
      // is fine — so it never waits for Gmail to load, and the agent keeps
      // re-navigating to Gmail in a loop.
      //
      // Fix: on frame-transition errors, wipe the selectorMap so getState DOES
      // retry (up to 3×1500ms), giving the new frame time to become ready.
      if (
        errMsg.includes('showing error page') ||
        errMsg.includes('Cannot find context') ||
        errMsg.includes('Frame was detached')
      ) {
        logger.warning(`[_updateState] Frame transitioning (${errMsg.split(':')[0]}) — clearing selectorMap to force SPA retry`);
        this._state.selectorMap = new Map();
        return this._state;
      }
      logger.error('Failed to update state:', error);
      // Return last known good state if available
      return this._state;
    }
  }

  async takeScreenshot(fullPage = false): Promise<string | null> {
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
    if (!this._puppeteerPage) {
      return;
    }
    logger.info('navigateTo', url);

    // Check if URL is allowed
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goto(url)]);
      logger.info('navigateTo complete');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Navigation timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Navigation failed:', error);
      throw error;
    }
  }

  async refreshPage(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.reload()]);
      logger.info('Page refresh complete');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Refresh timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Page refresh failed:', error);
      throw error;
    }
  }

  async goBack(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goBack()]);
      logger.info('Navigation back completed');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Back navigation timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Could not navigate back:', error);
      throw error;
    }
  }

  async goForward(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goForward()]);
      logger.info('Navigation forward completed');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Forward navigation timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Could not navigate forward:', error);
      throw error;
    }
  }

  // scroll to a percentage of the page or element
  // if yPercent is 0, scroll to the top of the page, if 100, scroll to the bottom of the page
  // if elementNode is provided, scroll to a percentage of the element
  // if elementNode is not provided, scroll to a percentage of the page
  async scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void> {
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
          behavior: 'smooth',
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
          behavior: 'smooth',
        });
      }, yPercent);
    }
  }

  async scrollBy(y: number, elementNode?: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    if (!elementNode) {
      await this._puppeteerPage.evaluate(y => {
        window.scrollBy({
          top: y,
          left: 0,
          behavior: 'smooth',
        });
      }, y);
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
      await scrollableElement.evaluate(el => {
        el.scrollBy({
          top: y,
          left: 0,
          behavior: 'smooth',
        });
      });
    }
  }

  async scrollToPreviousPage(elementNode?: DOMElementNode): Promise<void> {
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
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    // Split combination keys (e.g., "Control+A" or "Shift+ArrowLeft")
    const keyParts = keys.split('+');
    const modifiers = keyParts.slice(0, -1);
    const mainKey = keyParts[keyParts.length - 1];

    // Press modifiers and main key, ensure modifiers are released even if an error occurs.
    try {
      // Press all modifier keys (e.g., Control, Shift, etc.)
      for (const modifier of modifiers) {
        await this._puppeteerPage.keyboard.down(this._convertKey(modifier));
      }
      // Press the main key
      // also wait for stable state
      await Promise.all([
        this._puppeteerPage.keyboard.press(this._convertKey(mainKey)),
        this.waitForPageAndFramesLoad(),
      ]);
      logger.info('sendKeys complete', keys);
    } catch (error) {
      logger.error('Failed to send keys:', error);
      throw new Error(`Failed to send keys: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Release all modifier keys in reverse order regardless of any errors in key press.
      for (const modifier of [...modifiers].reverse()) {
        try {
          await this._puppeteerPage.keyboard.up(this._convertKey(modifier));
        } catch (releaseError) {
          logger.error('Failed to release modifier:', modifier, releaseError);
        }
      }
    }
  }

  private _convertKey(key: string): KeyInput {
    const lowerKey = key.trim().toLowerCase();
    const isMac = navigator.userAgent.toLowerCase().includes('mac os x');

    if (isMac) {
      if (lowerKey === 'control' || lowerKey === 'ctrl') {
        return 'Meta' as KeyInput; // Use Command key on Mac
      }
      if (lowerKey === 'command' || lowerKey === 'cmd') {
        return 'Meta' as KeyInput; // Map Command/Cmd to Meta on Mac
      }
      if (lowerKey === 'option' || lowerKey === 'opt') {
        return 'Alt' as KeyInput; // Map Option/Opt to Alt on Mac
      }
    }

    const keyMap: { [key: string]: string } = {
      // Letters
      a: 'KeyA',
      b: 'KeyB',
      c: 'KeyC',
      d: 'KeyD',
      e: 'KeyE',
      f: 'KeyF',
      g: 'KeyG',
      h: 'KeyH',
      i: 'KeyI',
      j: 'KeyJ',
      k: 'KeyK',
      l: 'KeyL',
      m: 'KeyM',
      n: 'KeyN',
      o: 'KeyO',
      p: 'KeyP',
      q: 'KeyQ',
      r: 'KeyR',
      s: 'KeyS',
      t: 'KeyT',
      u: 'KeyU',
      v: 'KeyV',
      w: 'KeyW',
      x: 'KeyX',
      y: 'KeyY',
      z: 'KeyZ',

      // Numbers
      '0': 'Digit0',
      '1': 'Digit1',
      '2': 'Digit2',
      '3': 'Digit3',
      '4': 'Digit4',
      '5': 'Digit5',
      '6': 'Digit6',
      '7': 'Digit7',
      '8': 'Digit8',
      '9': 'Digit9',

      // Special keys
      control: 'Control',
      shift: 'Shift',
      alt: 'Alt',
      meta: 'Meta',
      enter: 'Enter',
      backspace: 'Backspace',
      delete: 'Delete',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      escape: 'Escape',
      tab: 'Tab',
      space: 'Space',
    };

    const convertedKey = keyMap[lowerKey] || key;
    logger.info('convertedKey', convertedKey);
    return convertedKey as KeyInput;
  }

  async scrollToText(text: string, nth: number = 1): Promise<boolean> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      // Convert text to lowercase for consistent searching
      const lowerCaseText = text.toLowerCase();

      // Try different locator strategies to find all elements containing the text
      const selectors = [
        // Using text selector (equivalent to get_by_text) - for exact text match
        `::-p-text(${text})`,
        // Using XPath selector (contains text) - case insensitive
        `::-p-xpath(//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${lowerCaseText}')])`,
      ];

      for (const selector of selectors) {
        try {
          // Use $$ to get all matching elements
          const elements = await this._puppeteerPage.$$(selector);

          if (elements.length > 0) {
            // Find visible elements and select the nth occurrence
            const visibleElements = [];

            for (const element of elements) {
              const isVisible = await element.evaluate(el => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return (
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  style.opacity !== '0' &&
                  rect.width > 0 &&
                  rect.height > 0
                );
              });

              if (isVisible) {
                visibleElements.push(element);
              }
            }

            // Check if we have enough visible elements for the requested nth occurrence
            if (visibleElements.length >= nth) {
              const targetElement = visibleElements[nth - 1]; // Convert to 0-indexed
              await this._scrollIntoViewIfNeeded(targetElement);
              await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll to complete

              // Dispose of all element handles to prevent memory leaks
              for (const element of elements) {
                await element.dispose();
              }

              return true;
            }
          }

          // Dispose of all element handles to prevent memory leaks
          for (const element of elements) {
            await element.dispose();
          }
        } catch (e) {
          logger.debug(`Locator attempt failed: ${e}`);
        }
      }
      return false;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  async getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);

    if (!element || !this._puppeteerPage) {
      throw new Error('Element not found or puppeteer is not connected');
    }

    try {
      // Get the element handle using the element's selector
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        throw new Error('Dropdown element not found');
      }

      // Evaluate the select element to get all options
      const options = await elementHandle.evaluate(select => {
        if (!(select instanceof HTMLSelectElement)) {
          throw new Error('Element is not a select element');
        }

        return Array.from(select.options).map(option => ({
          index: option.index,
          text: option.text, // Not trimming to maintain exact match for selection
          value: option.value,
        }));
      });

      if (!options.length) {
        throw new Error('No options found in dropdown');
      }

      return options;
    } catch (error) {
      throw new Error(`Failed to get dropdown options: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async selectDropdownOption(index: number, text: string): Promise<string> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);

    if (!element || !this._puppeteerPage) {
      throw new Error('Element not found or puppeteer is not connected');
    }

    logger.debug(`Attempting to select '${text}' from dropdown`);
    logger.debug(`Element attributes: ${JSON.stringify(element.attributes)}`);
    logger.debug(`Element tag: ${element.tagName}`);

    // Validate that we're working with a select element
    if (element.tagName?.toLowerCase() !== 'select') {
      const msg = `Cannot select option: Element with index ${index} is a ${element.tagName}, not a SELECT`;
      logger.error(msg);
      throw new Error(msg);
    }

    try {
      // Get the element handle using the element's selector
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        throw new Error(`Dropdown element with index ${index} not found`);
      }

      // Verify dropdown and select option in one call
      const result = await elementHandle.evaluate(
        (select, optionText, elementIndex) => {
          if (!(select instanceof HTMLSelectElement)) {
            return {
              found: false,
              message: `Element with index ${elementIndex} is not a SELECT`,
            };
          }

          const options = Array.from(select.options);
          const option = options.find(opt => opt.text.trim() === optionText);

          if (!option) {
            const availableOptions = options.map(o => o.text.trim()).join('", "');
            return {
              found: false,
              message: `Option "${optionText}" not found in dropdown element with index ${elementIndex}. Available options: "${availableOptions}"`,
            };
          }

          // Set the value and dispatch events
          const previousValue = select.value;
          select.value = option.value;

          // Only dispatch events if the value actually changed
          if (previousValue !== option.value) {
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));
          }

          return {
            found: true,
            message: `Selected option "${optionText}" with value "${option.value}"`,
          };
        },
        text,
        index,
      );

      logger.debug('Selection result:', result);
      // whether found or not, return the message
      return result.message;
    } catch (error) {
      const errorMessage = `${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  async locateElement(element: DOMElementNode): Promise<ElementHandle | null> {
    if (!this._puppeteerPage) {
      // throw new Error('Puppeteer page is not connected');
      logger.warning('Puppeteer is not connected');
      return null;
    }
    let currentFrame: PuppeteerPage | Frame = this._puppeteerPage;

    // Start with the target element and collect all parents
    const parents: DOMElementNode[] = [];
    let current = element;
    while (current.parent) {
      parents.push(current.parent);
      current = current.parent;
    }

    // Process all iframe parents in sequence (in reverse order - top to bottom)
    const iframes = parents.reverse().filter(item => item.tagName === 'iframe');
    for (const parent of iframes) {
      const cssSelector = parent.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);
      const frameElement: ElementHandle | null = await currentFrame.$(cssSelector);
      if (!frameElement) {
        // throw new Error(`Could not find iframe with selector: ${cssSelector}`);
        logger.warning(`Could not find iframe with selector: ${cssSelector}`);
        return null;
      }
      const frame: Frame | null = await frameElement.contentFrame();
      if (!frame) {
        // throw new Error(`Could not access frame content for selector: ${cssSelector}`);
        logger.warning(`Could not access frame content for selector: ${cssSelector}`);
        return null;
      }
      currentFrame = frame;
      logger.info('currentFrame changed', currentFrame);
    }

    let elementHandle: ElementHandle | null = null;

    try {
      // 0. Try adopting via backendNodeId if available (SOTA and precise)
      if (element.backendNodeId != null) {
        try {
          logger.info(`Locating element via backendNodeId: ${element.backendNodeId}`);
          const adopted = await (currentFrame as any).mainRealm().adoptBackendNode(element.backendNodeId);
          if (adopted) {
            elementHandle = adopted;
          }
        } catch (err) {
          logger.debug(`Failed to adopt backendNodeId ${element.backendNodeId}:`, err);
        }
      }

      // 1. Try CSS selector first — trust it; SPAs change DOM structure between snapshot
      //    and action time so XPath re-validation causes false negatives on valid elements.
      if (!elementHandle) {
        const cssSelector = element.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);
        if (cssSelector) {
          elementHandle = await currentFrame.$(cssSelector);
        }
      }

      // 2. CSS failed — try raw XPath as a structural fallback
      if (!elementHandle) {
        const xpath = element.xpath;
        if (xpath) {
          try {
            logger.info('CSS selector failed, trying XPath:', xpath);
            const fullXpath = xpath.startsWith('/') ? xpath : `/${xpath}`;
            elementHandle = await currentFrame.$(`::-p-xpath(${fullXpath})`);
          } catch (xpathError) {
            logger.debug('XPath selector failed:', xpathError);
          }
        }
      }

      // 3. Both selectors failed — try SelectorHealer fuzzy match against selectorMap
      if (!elementHandle && this._state.selectorMap.size > 0) {
        logger.info('CSS and XPath failed, trying SelectorHealer fuzzy match...');
        const candidates = Array.from(this._state.selectorMap.values());
        const healed = healElement(element, candidates, 0.60);
        if (healed) {
          logger.info(
            `[SelectorHealer] Healed target element to candidate [${healed.node.highlightIndex}] (Score: ${healed.score.toFixed(
              2,
            )}, Matched by: ${healed.matchedBy.join(', ')})`,
          );
          const healedCss = healed.node.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);
          elementHandle = await currentFrame.$(healedCss);
          if (!elementHandle && healed.node.xpath) {
            try {
              const fullXpath = healed.node.xpath.startsWith('/') ? healed.node.xpath : `/${healed.node.xpath}`;
              elementHandle = await currentFrame.$(`::-p-xpath(${fullXpath})`);
            } catch (healedXpathError) {
              logger.debug('Healed XPath lookup failed:', healedXpathError);
            }
          }
        }
      }

      // 4. All specific selectors failed — try general semantic heuristic (stable attributes + text + role)
      if (!elementHandle) {
        logger.info('Fuzzy matching failed, trying general heuristic matching...');
        elementHandle = await this._heuristicLocate(currentFrame, element);
      }

      // Scroll into view if found and visible
      if (elementHandle) {
        const isHidden = await elementHandle.isHidden();
        if (!isHidden) {
          await this._scrollIntoViewIfNeeded(elementHandle);
        }
        return elementHandle;
      }

      logger.info('locateElement: element not found by any strategy');
    } catch (error) {
      logger.error('Failed to locate element:', error);
    }

    return null;
  }

  async inputTextElementNode(useVision: boolean, elementNode: DOMElementNode, text: string): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      // Highlight before typing
      // if (elementNode.highlightIndex != null) {
      //   await this._updateState(useVision, elementNode.highlightIndex);
      // }

      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Ensure element is ready for input
      try {
        // First wait for element stability
        await this._waitForElementStability(element, 1500);

        // Then check visibility and scroll into view if needed
        const isHidden = await element.isHidden();
        if (!isHidden) {
          await this._scrollIntoViewIfNeeded(element, 1500);

          // --- CURSOR ANIMATION BROADCAST (non-blocking) ---
          // Fire-and-forget: broadcast cursor coords without blocking the type action.
          element.boundingBox().then(box => {
            if (box) {
              const x = box.x + box.width / 2;
              const y = box.y + box.height / 2;
              chrome.tabs.sendMessage(this._tabId, {
                type: 'AGENT_ACTION',
                action: 'type',
                x, y
              }).catch(() => { });
            }
          }).catch(() => { });
        }
      } catch (e) {
        // Continue even if these operations fail
        logger.debug(`Non-critical error preparing element: ${e}`);
      }

      // Get element properties to determine input method
      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      const isContentEditable = await element.evaluate(el => {
        if (el instanceof HTMLElement) {
          return el.isContentEditable;
        }
        return false;
      });
      const isReadOnly = await element.evaluate(el => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          return el.readOnly;
        }
        return false;
      });
      const isDisabled = await element.evaluate(el => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.disabled) return true;
        }
        // aria-disabled="true" is used by many component libraries (MUI, Radix, etc.)
        if (el.getAttribute('aria-disabled') === 'true') return true;
        // inert attribute makes element non-interactive
        if (el.hasAttribute('inert') || el.closest('[inert]')) return true;
        return false;
      });

      // Choose appropriate input method based on element properties
      if (isContentEditable || tagName === 'input' || tagName === 'textarea') {
        if (isReadOnly || isDisabled) {
          throw new Error(`Cannot type into a readonly or disabled element`);
        }

        // Clear the field first
        await element.evaluate(el => {
          if (el instanceof HTMLElement) {
            el.focus();
            // Try framework-safe document.execCommand first to preserve React/Draft.js editor states
            try {
              document.execCommand('selectAll', false, undefined);
              document.execCommand('delete', false, undefined);
            } catch (err) {
              // Ignore and let fallback handle it
            }
          }
        });

        // Check if clearing with execCommand was successful. If not, use descriptor mutation fallback.
        const isEmptyAfterExec = await element.evaluate(el => {
          if ('value' in el) return (el as HTMLInputElement).value === '';
          if (el instanceof HTMLElement) return el.textContent === '';
          return true;
        });

        if (!isEmptyAfterExec) {
          logger.warning('execCommand clear failed or incomplete, falling back to direct value/textContent assignment');
          await element.evaluate(el => {
            if (el instanceof HTMLElement) {
              el.textContent = '';
            }
            if ('value' in el) {
              // React / Angular / Vue use a synthetic input event system.
              // Directly setting .value= bypasses their internal state tracking.
              // We must use the native property descriptor setter so the framework
              // sees the change as if the user typed it.
              const nativeInputProto = Object.getPrototypeOf(el);
              const nativeDescriptor =
                Object.getOwnPropertyDescriptor(nativeInputProto, 'value') ||
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
              if (nativeDescriptor?.set) {
                nativeDescriptor.set.call(el, '');
              } else {
                (el as HTMLInputElement).value = '';
              }
            }
            // Dispatch input + change so framework state updates
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }

        // Type the text with OS-level inputs via CDP
        try {
          logger.info(`Attempting CDP OS-level type on element: ${elementNode}`);
          await this.cdpType(element, text);
        } catch (error) {
          logger.warning('CDP typing failed, trying legacy element.type() fallback:', error);
          await element.type(text, { delay: 50 });
        }

        // Verify the typed text actually appeared (detect silent failures)
        let actualValue = await element.evaluate(el => {
          if ('value' in el) return (el as HTMLInputElement).value;
          if (el instanceof HTMLElement) return el.textContent || '';
          return '';
        });

        // First fallback: If CDP typing didn't result in the correct text, try legacy element.type()
        if (actualValue !== text) {
          logger.warning(
            `[InputVerify] CDP type mismatch (expected "${text.slice(0, 40)}", got "${actualValue.slice(0, 40)}"). Retrying with legacy element.type()`
          );
          try {
            // Clear value first before retrying
            await element.evaluate(el => {
              if (el instanceof HTMLElement) el.textContent = '';
              if ('value' in el) (el as HTMLInputElement).value = '';
            });
            await element.type(text, { delay: 50 });
            actualValue = await element.evaluate(el => {
              if ('value' in el) return (el as HTMLInputElement).value;
              if (el instanceof HTMLElement) return el.textContent || '';
              return '';
            });
          } catch (err) {
            logger.error('Legacy element.type() fallback failed:', err);
          }
        }

        // Second fallback: If still not matching, set value directly and trigger framework events
        if (actualValue !== text) {
          logger.warning(
            `[InputVerify] Legacy type also mismatch. Retrying with direct property descriptor injection`
          );
          await element.evaluate((el, value) => {
            const nativeInputProto = Object.getPrototypeOf(el);
            const nativeDescriptor =
              Object.getOwnPropertyDescriptor(nativeInputProto, 'value') ||
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (nativeDescriptor?.set) {
              nativeDescriptor.set.call(el, value);
            } else if ('value' in el) {
              (el as HTMLInputElement).value = value;
            } else if (el instanceof HTMLElement) {
              el.textContent = value;
            }
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, text);
        }
      } else {
        // Non-editable element: use direct value setting
        await element.evaluate((el, value) => {
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = value;
          } else if (el instanceof HTMLElement && el.isContentEditable) {
            el.textContent = value;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, text);
      }

      // Wait for page stability after input
      await this.waitForPageAndFramesLoad();
    } catch (error) {
      const errorMsg = `Failed to input text into element: ${elementNode}. Error: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Wait for an element to become stable (no position/size changes)
   * Similar to Playwright's wait_for_element_state('stable')
   */
  private async _waitForElementStability(element: ElementHandle, timeout = 1000): Promise<void> {
    const startTime = Date.now();
    let lastRect = await element.boundingBox();

    while (Date.now() - startTime < timeout) {
      // Wait a short time
      await new Promise(resolve => setTimeout(resolve, 50));

      // Get current position and size
      const currentRect = await element.boundingBox();

      // If element is no longer in DOM or not visible
      if (!currentRect) {
        break;
      }

      // Compare with previous position/size
      if (
        lastRect &&
        Math.abs(lastRect.x - currentRect.x) < 2 &&
        Math.abs(lastRect.y - currentRect.y) < 2 &&
        Math.abs(lastRect.width - currentRect.width) < 2 &&
        Math.abs(lastRect.height - currentRect.height) < 2
      ) {
        // Position is stable - wait a bit more to be sure and then return
        await new Promise(resolve => setTimeout(resolve, 50));
        return;
      }

      // Update last position
      lastRect = currentRect;
    }

    // If we got here, either the element stabilized or we timed out
    logger.debug('Element stability check completed (timeout or stable)');
  }

  private async _scrollIntoViewIfNeeded(element: ElementHandle, timeout = 1000): Promise<void> {
    const startTime = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check if element is in viewport
      const isVisible = await element.evaluate(el => {
        const rect = el.getBoundingClientRect();

        // Check if element has size
        if (rect.width === 0 || rect.height === 0) return false;

        // Check if element is hidden
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
          return false;
        }

        // Check if element is partially in viewport to avoid unnecessary scrolling which closes dropdowns
        const isPartiallyInViewport =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
          rect.left < (window.innerWidth || document.documentElement.clientWidth);

        if (!isPartiallyInViewport) {
          // Scroll into view if completely out of bounds
          el.scrollIntoView({
            behavior: 'auto',
            block: 'center',
            inline: 'center',
          });
          return false;
        }

        return true;
      });

      if (isVisible) break;

      // Check timeout - log warning and return instead of throwing
      if (Date.now() - startTime > timeout) {
        logger.warning('Timed out while trying to scroll element into view, continuing anyway');
        break;
      }

      // Small delay before next check
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async _heuristicLocate(
    frame: PuppeteerPage | Frame,
    elementNode: DOMElementNode,
  ): Promise<ElementHandle<Element> | null> {
    const tagName = elementNode.tagName?.toLowerCase();
    if (!tagName) return null;

    const attributes = elementNode.attributes || {};
    const text = elementNode.getAllTextTillNextClickableElement(2) || '';

    try {
      const handle = await frame.evaluateHandle(
        (tag, attrs, txt) => {
          // Pierce shadow DOM by collecting candidates from all shadow roots
          function queryShadow(root: Document | ShadowRoot, selector: string): Element[] {
            const results: Element[] = [];
            const direct = Array.from(root.querySelectorAll(selector));
            results.push(...direct);
            // Walk all elements to find shadow roots
            Array.from(root.querySelectorAll('*')).forEach(el => {
              if (el.shadowRoot) {
                results.push(...queryShadow(el.shadowRoot, selector));
              }
            });
            return results;
          }

          const candidates = queryShadow(document, tag);

          // 1. Try matching by stable attributes (most reliable)
          const stableAttrs = [
            'data-testid', 'data-cy', 'data-test',
            'aria-label', 'aria-description',
            'placeholder', 'id', 'name',
          ];
          for (const attrName of stableAttrs) {
            const attrVal = (attrs as Record<string, string>)[attrName];
            if (attrVal) {
              const found = candidates.find(el => el.getAttribute(attrName) === attrVal);
              if (found) return found;
            }
          }

          // 2. Try matching by exact text content (short labels)
          if (txt && txt.length > 0 && txt.length < 80) {
            const found = candidates.find(el => el.textContent?.trim() === txt);
            if (found) return found;
          }

          // 3. Fuzzy match by role + text prefix
          const roleVal = (attrs as Record<string, string>)['role'];
          if (roleVal && txt.length > 0) {
            const found = candidates.find(
              el =>
                el.getAttribute('role') === roleVal &&
                el.textContent?.trim().startsWith(txt.substring(0, 8)),
            );
            if (found) return found;
          }

          return null;
        },
        tagName,
        attributes,
        text,
      );

      // evaluateHandle returns a JSHandle wrapping null when the in-page function returns null.
      // We must check asElement() before using it.
      const asEl = handle.asElement() as ElementHandle<Element> | null;
      if (!asEl) {
        await handle.dispose();
        return null;
      }
      return asEl;
    } catch (err) {
      logger.debug('[HeuristicLocate] error:', err);
      return null;
    }
  }

  async clickElementNode(useVision: boolean, elementNode: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Scroll element into view if needed
      await this._scrollIntoViewIfNeeded(element);

      // Wait for element position/size to stabilize (prevents clicking shifting nodes)
      await this._waitForElementStability(element, 1000);

      // Verify element interactivity/clickability before executing CDP click
      const clickabilityError = await element.evaluate((el) => {
        if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          if (el.disabled) return 'Element is disabled';
        }
        if (el.getAttribute('aria-disabled') === 'true') {
          return 'Element has aria-disabled set to true';
        }
        const style = window.getComputedStyle(el);
        if (style.pointerEvents === 'none') {
          return 'Element has pointer-events: none';
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return 'Element has 0 width or height';
        }
        return null;
      });

      if (clickabilityError) {
        logger.warning(`[ClickabilityCheck] Target may not be clickable: ${clickabilityError}. Proceeding with best-effort click.`);
      }

      try {
        // Primary attempt: Use OS-level click via CDP Input.dispatchMouseEvent
        logger.info(`Attempting CDP OS-level click on element: ${elementNode}`);
        await Promise.race([
          this.cdpClick(element),
          new Promise((_, reject) => setTimeout(() => reject(new Error('CDP Click timeout')), 5000)),
        ]);
        await this._checkAndHandleNavigation();
      } catch (error) {
        if (error instanceof URLNotAllowedError) {
          throw error;
        }
        
        // Fallback: Re-locate a fresh handle to avoid stale references, focus it, and dispatch a full synthetic event chain
        logger.warning('CDP click failed, trying synthetic MouseEvent dispatch chain on fresh handle', error);
        try {
          const freshElement = await this.locateElement(elementNode);
          if (!freshElement) {
            throw new Error('Element no longer found for fallback click');
          }
          await freshElement.evaluate((el: Element) => {
            if (el instanceof HTMLElement) {
              el.focus();
            }
            const eventOpts = { bubbles: true, cancelable: true, view: window };
            el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
            el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
            if (el instanceof HTMLElement) {
              el.click();
            } else {
              el.dispatchEvent(new MouseEvent('click', eventOpts));
            }
          });
          await this._checkAndHandleNavigation();
        } catch (secondError) {
          if (secondError instanceof URLNotAllowedError) {
            throw secondError;
          }
          throw new Error(
            `Failed to click element: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
          );
        }
      }

      // Broadcast cursor animation after click (fire-and-forget, non-blocking)
      try {
        const box = await element.boundingBox();
        if (box) {
          chrome.tabs.sendMessage(this._tabId, {
            type: 'AGENT_ACTION',
            action: 'click',
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          }).catch(() => { });
        }
      } catch {
        // Non-critical; ignore
      }

    } catch (error) {
      throw new Error(
        `Failed to click element: ${elementNode}. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getSelectorMap(): Map<number, DOMElementNode> {
    // If there is no cached state, return an empty map
    if (this._cachedState === null) {
      return new Map();
    }
    // Otherwise return the cached state's selector map
    return this._cachedState.selectorMap;
  }

  async getElementByIndex(index: number): Promise<ElementHandle | null> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap.get(index);
    if (!element) return null;
    return await this.locateElement(element);
  }

  getDomElementByIndex(index: number): DOMElementNode | null {
    const selectorMap = this.getSelectorMap();
    return selectorMap.get(index) || null;
  }

  isFileUploader(elementNode: DOMElementNode, maxDepth = 3, currentDepth = 0): boolean {
    if (currentDepth > maxDepth) {
      return false;
    }

    // Check current element
    if (elementNode.tagName === 'input') {
      // Check for file input attributes
      const attributes = elementNode.attributes;
      // biome-ignore lint/complexity/useLiteralKeys: <explanation>
      if (attributes['type']?.toLowerCase() === 'file' || !!attributes['accept']) {
        return true;
      }
    }

    // Recursively check children
    if (elementNode.children && currentDepth < maxDepth) {
      for (const child of elementNode.children) {
        if ('tagName' in child) {
          // DOMElementNode type guard
          if (this.isFileUploader(child as DOMElementNode, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  async waitForPageLoadState(timeout?: number) {
    const timeoutValue = timeout || 8000;
    await this._puppeteerPage?.waitForNavigation({ timeout: timeoutValue });
  }

  private async _waitForStableNetwork() {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe']);

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

  /**
   * Get the complete textual content of the current page.
   * This extracts the full innerText of the document body or main content area,
   * bypassing any need to scroll or stitch elements.
   */
  async getCompletePageContent(): Promise<string> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    try {
      const frames = this._puppeteerPage.frames();
      const contentParts: string[] = [];

      for (const frame of frames) {
        try {
          const text = await frame.evaluate(() => {
            const main = document.querySelector('article') || document.querySelector('main') || document.body;
            return main ? (main.innerText || main.textContent || '') : '';
          });
          const trimmed = text.trim();
          if (trimmed) {
            contentParts.push(trimmed);
          }
        } catch (err) {
          logger.debug(`Failed to extract content from frame ${frame.url()}:`, err);
        }
      }

      return contentParts.join('\n\n');
    } catch (error) {
      logger.error('Failed to get complete page content:', error);
      throw error;
    }
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

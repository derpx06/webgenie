import 'webextension-polyfill';
import {
  type BrowserContextConfig,
  type BrowserState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  type TabInfo,
  URLNotAllowedError,
} from './views';
import Page, { build_initial_state } from './page';
import { createLogger } from '@src/background/log';
import { isUrlAllowed } from './util';
import { analytics } from '../services/analytics';

const logger = createLogger('BrowserContext');
export default class BrowserContext {
  private _config: BrowserContextConfig;
  private _currentTabId: number | null = null;
  private _attachedPages: Map<number, Page> = new Map();

  constructor(config: Partial<BrowserContextConfig>) {
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
  }

  
  public getConfig(): BrowserContextConfig {
    return this._config;
  }

  public updateConfig(config: Partial<BrowserContextConfig>): void {
    this._config = { ...this._config, ...config };
  }

  public updateCurrentTabId(tabId: number): void {
    // only update tab id, but don't attach it.
    this._currentTabId = tabId;
  }

  public getCurrentTabId(): number | null {
    return this._currentTabId;
  }

  // Per-tab in-flight promise: prevents multiple concurrent callers from each
  // spawning a new Page for the same tabId (the source of "creating new page ×7" logs).
  private _creatingPages: Map<number, Promise<Page>> = new Map();

  private async _getOrCreatePage(tab: chrome.tabs.Tab, forceUpdate = false): Promise<Page> {
    if (!tab.id) {
      throw new Error('Tab ID is not available');
    }

    const existingPage = this._attachedPages.get(tab.id);
    if (existingPage) {
      logger.info('getOrCreatePage', tab.id, 'already attached');
      if (!forceUpdate) {
        return existingPage;
      }
      // detach the page and remove it from the attached pages if forceUpdate is true
      await existingPage.detachPuppeteer();
      this._attachedPages.delete(tab.id);
    }

    // If a creation is already in-flight for this tab, wait for it instead of
    // creating yet another Page object for the same tab.
    const inFlight = this._creatingPages.get(tab.id);
    if (inFlight && !forceUpdate) {
      logger.info('getOrCreatePage', tab.id, 'waiting for in-flight creation');
      return inFlight;
    }

    logger.info('getOrCreatePage', tab.id, 'creating new page');
    const creation = Promise.resolve(new Page(tab.id, tab.url || '', tab.title || '', this._config));
    this._creatingPages.set(tab.id, creation);
    const page = await creation;
    this._creatingPages.delete(tab.id);
    return page;
  }


  public async cleanup(): Promise<void> {
    const currentPage = await this.getCurrentPage();
    currentPage?.removeHighlight();
    // detach all pages
    for (const page of this._attachedPages.values()) {
      await page.detachPuppeteer();
    }
    this._attachedPages.clear();
    this._currentTabId = null;
  }

  public async attachPage(page: Page): Promise<boolean> {
    // check if page is already attached
    if (this._attachedPages.has(page.tabId)) {
      logger.info('attachPage', page.tabId, 'already attached');
      return true;
    }

    if (await page.attachPuppeteer()) {
      logger.info('attachPage', page.tabId, 'attached');
      // add page to managed pages
      this._attachedPages.set(page.tabId, page);
      return true;
    }
    return false;
  }

  public async detachPage(tabId: number): Promise<void> {
    // detach page
    const page = this._attachedPages.get(tabId);
    if (page) {
      await page.detachPuppeteer();
      // remove page from managed pages
      this._attachedPages.delete(tabId);
    }
  }

  public getPageForTab(tabId: number): Page | undefined {
    return this._attachedPages.get(tabId);
  }

  public async getCurrentPage(): Promise<Page> {
    // 1. If _currentTabId not set, query the active tab and attach it
    if (!this._currentTabId) {
      let activeTab: chrome.tabs.Tab;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        // open a new tab with blank page
        const newTab = await chrome.tabs.create({ url: this._config.homePageUrl });
        if (!newTab.id) {
          throw new Error('No tab ID available');
        }
        activeTab = newTab;
      } else {
        activeTab = tab;
      }
      logger.info('active tab', activeTab.id, activeTab.url, activeTab.title);
      const page = await this._getOrCreatePage(activeTab);
      this._currentTabId = activeTab.id || null;
      // Attempt puppeteer attach but don't block if it fails (e.g. newtab).
      // _revalidateFromTab() inside getState() will re-try when the tab navigates.
      await this.attachPage(page);
      return page;
    }

    // 2. If _currentTabId is set but not in attachedPages, try to attach
    const existingPage = this._attachedPages.get(this._currentTabId);
    if (!existingPage) {
      const tab = await chrome.tabs.get(this._currentTabId);
      const page = await this._getOrCreatePage(tab);
      // Attempt attach; if it fails (e.g. still on newtab) we still return the
      // page so getState() can call _revalidateFromTab() and promote it once
      // the real URL is available.
      await this.attachPage(page);
      return page;
    }

    // 3. Return existing page from attachedPages
    return existingPage;
  }

  /**
   * Get all tab IDs from the browser and the current window.
   * @returns A set of tab IDs.
   */
  public async getAllTabIds(): Promise<Set<number>> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return new Set(tabs.map(tab => tab.id).filter(id => id !== undefined));
  }

  /**
   * Wait for tab events to occur after a tab is created or updated.
   * @param tabId - The ID of the tab to wait for events on.
   * @param options - An object containing options for the wait.
   * @returns A promise that resolves when the tab events occur.
   */
  private async waitForTabEvents(
    tabId: number,
    options: {
      waitForUpdate?: boolean;
      waitForActivation?: boolean;
      timeoutMs?: number;
      /** When true, skip the pre-check of current tab status and only listen
       *  for the next onUpdated event. Use for chrome.tabs.update navigations
       *  where the tab may still be 'complete' at the OLD URL. */
      skipCurrentStateCheck?: boolean;
    } = {},
  ): Promise<void> {
    const { waitForUpdate = true, waitForActivation = true, timeoutMs = 3000, skipCurrentStateCheck = false } = options;

    const promises: Promise<void>[] = [];

    if (waitForUpdate) {
      // Resolve as soon as the tab reaches 'complete' status — url/title may
      // arrive in separate events (especially on SPA navigations like Gmail).
      const updatePromise = new Promise<void>(resolve => {
        const onUpdatedHandler = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (updatedTabId !== tabId) return;
          if (changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdatedHandler);

        // Only pre-check current state for cases like openTab where the tab
        // is freshly created and already at the final URL. For navigateTo via
        // chrome.tabs.update, skip this to avoid resolving on the OLD URL's
        // 'complete' state before the navigation even starts.
        if (!skipCurrentStateCheck) {
          chrome.tabs.get(tabId).then(tab => {
            if (tab.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
              resolve();
            }
          }).catch(() => {
            chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
            resolve(); // Tab closed; resolve gracefully
          });
        }
      });
      promises.push(updatePromise);
    }

    if (waitForActivation) {
      const activatedPromise = new Promise<void>(resolve => {
        const onActivatedHandler = (activeInfo: chrome.tabs.TabActiveInfo) => {
          if (activeInfo.tabId === tabId) {
            chrome.tabs.onActivated.removeListener(onActivatedHandler);
            resolve();
          }
        };
        chrome.tabs.onActivated.addListener(onActivatedHandler);

        // Always pre-check activation state — it can only transition one way.
        chrome.tabs.get(tabId).then(tab => {
          if (tab.active) {
            chrome.tabs.onActivated.removeListener(onActivatedHandler);
            resolve();
          }
        }).catch(() => {
          chrome.tabs.onActivated.removeListener(onActivatedHandler);
          resolve();
        });
      });
      promises.push(activatedPromise);
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tab operation timed out after ${timeoutMs} ms`)), timeoutMs),
    );

    await Promise.race([Promise.all(promises), timeoutPromise]);
  }

  public async switchTab(tabId: number): Promise<Page> {
    logger.info('switchTab', tabId);

    await chrome.tabs.update(tabId, { active: true });
    await this.waitForTabEvents(tabId, { waitForUpdate: false });

    // Force-recreate the page so we always get the current URL/title, not a
    // stale cached one from when the tab was first opened.
    const page = await this._getOrCreatePage(await chrome.tabs.get(tabId), true);
    await this.attachPage(page);
    this._currentTabId = tabId;
    return page;
  }

  public async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    // Track domain visit for analytics
    void analytics.trackDomainVisit(url);

    const page = await this.getCurrentPage();
    if (!page) {
      await this.openTab(url);
      return;
    }
    // If page is already puppeteer-attached, use puppeteer's navigation which
    // handles its own internal wait — no need for tab-event polling.
    if (page.attached) {
      await page.navigateTo(url);
      // Refresh the Page object so _validWebPage reflects the new URL.
      const tabId = page.tabId;
      const updatedTab = await chrome.tabs.get(tabId).catch(() => null);
      if (updatedTab) {
        await page.refreshValidWebPage(updatedTab.url ?? '');
      }
      return;
    }
    // Use chrome.tabs.update only if the page is not yet puppeteer-attached
    const tabId = page.tabId;
    await chrome.tabs.update(tabId, { url, active: true });
    // skipCurrentStateCheck=true: avoid false-resolve on old URL's 'complete' state
    await this.waitForTabEvents(tabId, { skipCurrentStateCheck: true }).catch(() => { /* timeout is non-fatal */ });

    // Reattach the page after navigation completes so the new URL is picked up.
    const updatedPage = await this._getOrCreatePage(await chrome.tabs.get(tabId), true);
    await this.attachPage(updatedPage);
    this._currentTabId = tabId;
  }

  public async openTab(url: string): Promise<Page> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`Open tab failed. URL: ${url} is not allowed`);
    }

    // Create the new tab
    const tab = await chrome.tabs.create({ url, active: true });
    if (!tab.id) {
      throw new Error('No tab ID available');
    }
    // Wait for the tab to finish loading. Non-fatal: even if the timeout fires
    // (e.g. Gmail takes >3 s), we still proceed and get whatever state the tab
    // is in — the agent will re-read the DOM on the next step.
    await this.waitForTabEvents(tab.id).catch(() => {
      logger.warning('openTab: waitForTabEvents timed out, continuing anyway');
    });

    // Get updated tab information (may still be loading, that's OK)
    const updatedTab = await chrome.tabs.get(tab.id);
    // Create and attach the page after tab is fully loaded and activated
    const page = await this._getOrCreatePage(updatedTab);
    await this.attachPage(page);
    this._currentTabId = tab.id;

    return page;
  }

  public async closeTab(tabId: number): Promise<void> {
    await this.detachPage(tabId);
    await chrome.tabs.remove(tabId);
    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  /**
   * Remove a tab from the attached pages map. This will not run detachPuppeteer.
   * @param tabId - The ID of the tab to remove.
   */
  public removeAttachedPage(tabId: number): void {
    this._attachedPages.delete(tabId);
    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  public async getTabInfos(): Promise<TabInfo[]> {
    const tabs = await chrome.tabs.query({});
    const tabInfos: TabInfo[] = [];

    for (const tab of tabs) {
      if (tab.id && tab.url && tab.title) {
        tabInfos.push({
          id: tab.id,
          url: tab.url,
          title: tab.title,
        });
      }
    }
    return tabInfos;
  }

  public async getCachedState(useVision = false, cacheClickableElementsHashes = false): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();

    let pageState = !currentPage ? build_initial_state() : currentPage.getCachedState();
    if (!pageState) {
      pageState = await currentPage.getState(useVision, cacheClickableElementsHashes);
    }

    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
    };
    return browserState;
  }

  public async getState(useVision = false, cacheClickableElementsHashes = false, skipNetworkIdle = false): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();

    const pageState = !currentPage
      ? build_initial_state()
      : await currentPage.getState(useVision, cacheClickableElementsHashes, skipNetworkIdle);
    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
    };
    return browserState;
  }

  public async removeHighlight(): Promise<void> {
    const page = await this.getCurrentPage();
    if (page) {
      await page.removeHighlight();
    }
  }

  public async waitForPageAndFramesLoad(): Promise<void> {
    const page = await this.getCurrentPage();
    if (page) {
      await page.waitForPageAndFramesLoad();
    }
  }
}

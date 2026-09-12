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
import { record } from '../trace';
import { isUrlAllowed } from './util';
import { analytics } from '../services/analytics';
import type { IBrowserAdapter } from '../adapters/IBrowserAdapter';
import type { IStorageProvider } from '../adapters/IStorageProvider';
import { ChromeBrowserAdapter } from '../adapters/ChromeBrowserAdapter';
import { ChromeStorageProvider } from '../adapters/ChromeStorageProvider';
import { ensureBrowserObservation } from '../agent/validation/observation';

const logger = createLogger('BrowserContext');

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default class BrowserContext {
  private _config: BrowserContextConfig;
  private _currentTabId: number | null = null;
  /** One Page per tab, attached or not: a tab that cannot be attached still has a Page, so actions can say why. */
  private _pages: Map<number, Page> = new Map();
  private _browserAdapter: IBrowserAdapter;
  private _storageProvider: IStorageProvider;

  constructor(
    config: Partial<BrowserContextConfig>,
    browserAdapter?: IBrowserAdapter,
    storageProvider?: IStorageProvider
  ) {
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this._browserAdapter = browserAdapter || new ChromeBrowserAdapter();
    this._storageProvider = storageProvider || new ChromeStorageProvider();
  }

  public getConfig(): BrowserContextConfig {
    return this._config;
  }

  public get browser(): IBrowserAdapter {
    return this._browserAdapter;
  }

  public updateConfig(config: Partial<BrowserContextConfig>): void {
    this._config = { ...this._config, ...config };
  }

  /** Makes the tab current without attaching; the next use attaches. */
  public updateCurrentTabId(tabId: number): void {
    this._currentTabId = tabId;
  }

  public getCurrentTabId(): number | null {
    return this._currentTabId;
  }

  /** The tab's Page, created once, updated to the tab's URL and attached if possible. */
  private async _getPage(tab: chrome.tabs.Tab): Promise<Page> {
    if (!tab.id) {
      throw new Error('Tab ID is not available');
    }
    let page = this._pages.get(tab.id);
    if (!page) {
      page = new Page(tab.id, tab.url || '', tab.title || '', this._config, this._browserAdapter, this._storageProvider);
      this._pages.set(tab.id, page);
    } else if (tab.url) {
      page.updateUrl(tab.url);
    }
    await this.attachPage(page);
    return page;
  }

  private isInspectableUrl(url: string | undefined): boolean {
    if (!url) return false;
    return /^https?:\/\//i.test(url) && isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls);
  }

  private isSameUrl(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false;
    try {
      return new URL(a).href === new URL(b).href;
    } catch {
      return a === b;
    }
  }

  private async waitForInspectableNavigation(
    tabId: number,
    previousUrl: string | undefined,
    requestedUrl: string,
    timeoutMs = 8000,
    intervalMs = 100,
  ): Promise<chrome.tabs.Tab> {
    const startedAt = Date.now();
    let latest = await this._browserAdapter.getTab(tabId);

    while (Date.now() - startedAt < timeoutMs) {
      const liveUrl = latest.url;
      const previousWasInspectable = this.isInspectableUrl(previousUrl);
      const urlChanged = Boolean(liveUrl && liveUrl !== previousUrl);
      const requestedSameAsLive = this.isSameUrl(liveUrl, requestedUrl);

      if (
        this.isInspectableUrl(liveUrl) &&
        (!previousWasInspectable || urlChanged || requestedSameAsLive)
      ) {
        return latest;
      }

      await sleep(intervalMs);
      latest = await this._browserAdapter.getTab(tabId);
    }

    return latest;
  }

  /** Detaches every page this context holds; never queries or attaches tabs. */
  public async cleanup(): Promise<void> {
    for (const page of this._pages.values()) {
      await page.removeHighlight().catch(() => undefined);
      await page.detachPuppeteer();
    }
    this._pages.clear();
    this._currentTabId = null;
  }

  /** Keeps the page and tries to attach it; a failure (DevTools open, browser page) is logged, not thrown. */
  public async attachPage(page: Page): Promise<boolean> {
    this._pages.set(page.tabId, page);
    try {
      return await page.attachPuppeteer();
    } catch (error) {
      logger.warning(`Cannot attach to tab ${page.tabId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  public async detachPage(tabId: number): Promise<void> {
    const page = this._pages.get(tabId);
    if (page) {
      await page.detachPuppeteer();
      this._pages.delete(tabId);
    }
  }

  public getPageForTab(tabId: number): Page | undefined {
    return this._pages.get(tabId);
  }

  public async getCurrentPage(): Promise<Page> {
    if (this._currentTabId) {
      const existing = this._pages.get(this._currentTabId);
      if (existing?.attached) {
        return existing;
      }
      const tab = await this._browserAdapter.getTab(this._currentTabId).catch(() => null);
      if (tab) {
        return this._getPage(tab);
      }
      // The tab was closed.
      this._currentTabId = null;
    }

    const [active] = await this._browserAdapter.queryTabs({ active: true, currentWindow: true });
    const tab = active?.id ? active : await this._browserAdapter.createTab({ url: this._config.homePageUrl });
    if (!tab.id) {
      throw new Error('No tab ID available');
    }
    logger.info('active tab', tab.id, tab.url, tab.title);
    this._currentTabId = tab.id;
    return this._getPage(tab);
  }

  /** Tab ids across all windows. */
  public async getAllTabIds(): Promise<Set<number>> {
    const tabs = await this._browserAdapter.queryTabs({});
    return new Set(tabs.map(tab => tab.id).filter((id): id is number => id !== undefined));
  }

  /** Resolves when the tab has loaded and is active; its listeners are removed however it ends. */
  private async waitForTabEvents(tabId: number, timeoutMs = 3000): Promise<void> {
    let onUpdated: ((updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) | undefined;
    let onActivated: ((activeInfo: chrome.tabs.TabActiveInfo) => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const loaded = new Promise<void>(resolve => {
      onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') resolve();
      };
      this._browserAdapter.addTabUpdatedListener(onUpdated);
      this._browserAdapter.getTab(tabId).then(tab => tab.status === 'complete' && resolve(), () => resolve());
    });
    const activated = new Promise<void>(resolve => {
      onActivated = activeInfo => {
        if (activeInfo.tabId === tabId) resolve();
      };
      this._browserAdapter.addTabActivatedListener(onActivated);
      this._browserAdapter.getTab(tabId).then(tab => tab.active && resolve(), () => resolve());
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tab operation timed out after ${timeoutMs} ms`)), timeoutMs);
    });

    try {
      await Promise.race([Promise.all([loaded, activated]), timeout]);
    } finally {
      clearTimeout(timer);
      if (onUpdated) this._browserAdapter.removeTabUpdatedListener(onUpdated);
      if (onActivated) this._browserAdapter.removeTabActivatedListener(onActivated);
    }
  }

  public async switchTab(tabId: number): Promise<Page> {
    logger.info('switchTab', tabId);
    await this._browserAdapter.updateTab(tabId, { active: true });
    const page = await this._getPage(await this._browserAdapter.getTab(tabId));
    this._currentTabId = tabId;
    return page;
  }

  public async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    void analytics.trackDomainVisit(url);

    const page = await this.getCurrentPage();
    if (page.attached) {
      // Same tab, same session: the page follows the navigation itself.
      await page.navigateTo(url);
      return;
    }

    // Browser pages (new tab, chrome://) cannot be attached: navigate the tab, then attach once it shows a web page.
    const tabId = page.tabId;
    const previousTab = await this._browserAdapter.getTab(tabId).catch(() => null);
    await this._browserAdapter.updateTab(tabId, { url, active: true });
    const updatedTab = await this.waitForInspectableNavigation(tabId, previousTab?.url, url);
    await this._getPage(updatedTab);
    this._currentTabId = tabId;
  }

  public async openTab(url: string): Promise<Page> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`Open tab failed. URL: ${url} is not allowed`);
    }

    const tab = await this._browserAdapter.createTab({ url, active: true });
    if (!tab.id) {
      throw new Error('No tab ID available');
    }
    // A slow page is still usable; the next read waits for it to settle.
    await this.waitForTabEvents(tab.id).catch(() => {
      logger.warning('openTab: waitForTabEvents timed out, continuing anyway');
    });

    const page = await this._getPage(await this._browserAdapter.getTab(tab.id));
    this._currentTabId = tab.id;
    return page;
  }

  public async closeTab(tabId: number): Promise<void> {
    await this.detachPage(tabId);
    await this._browserAdapter.removeTab(tabId);
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  /** Forgets a closed tab's page without detaching (the session is already gone). */
  public removeAttachedPage(tabId: number): void {
    this._pages.delete(tabId);
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  public async getTabInfos(): Promise<TabInfo[]> {
    const tabs = await this._browserAdapter.queryTabs({});
    return tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number; url: string } => Boolean(tab.id && tab.url))
      .map(tab => ({ id: tab.id, url: tab.url, title: tab.title || tab.url }));
  }

  /** The last page read while it is still current (not invalidated, same URL); otherwise a new read. */
  public async getCachedState(useVision = false): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();
    const pageState = currentPage ? await currentPage.getCurrentState(useVision) : build_initial_state();

    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
    };
    ensureBrowserObservation(browserState);
    return browserState;
  }

  public async getState(useVision = false): Promise<BrowserState> {
    const startedAt = Date.now();
    const currentPage = await this.getCurrentPage();

    const pageState = !currentPage ? build_initial_state() : await currentPage.getState(useVision);
    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
    };
    ensureBrowserObservation(browserState);
    record({
      level: 'info',
      kind: 'span',
      component: 'BrowserContext',
      msg: 'getState',
      durationMs: Date.now() - startedAt,
      data: { url: browserState.url, elements: browserState.selectorMap?.size, tabs: tabInfos.length, useVision },
    });
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

  public async invalidateCache(): Promise<void> {
    const page = await this.getCurrentPage();
    if (page) {
      page.invalidateCache();
    }
  }
}

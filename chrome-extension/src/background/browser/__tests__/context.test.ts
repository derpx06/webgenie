import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock webextension-polyfill before any imports are evaluated
vi.mock('webextension-polyfill', () => {
  return {};
});

// Mock puppeteer-core connection
vi.mock('puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js', () => {
  return {
    connect: vi.fn().mockResolvedValue({
      pages: vi.fn().mockResolvedValue([{
        on: vi.fn(),
        off: vi.fn(),
        url: vi.fn().mockReturnValue('https://example.com'),
        title: vi.fn().mockResolvedValue('Example Domain'),
        evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      }]),
    }),
    ExtensionTransport: {
      connectTab: vi.fn().mockResolvedValue({}),
    },
  };
});

import BrowserContext from '../context';
import type { IBrowserAdapter } from '../../adapters/IBrowserAdapter';
import type { IStorageProvider } from '../../adapters/IStorageProvider';

describe('BrowserContext with Adapter Dependency Injection', () => {
  let mockAdapter: any;
  let mockStorage: any;
  let context: BrowserContext;
  let tabsMap: Map<number, chrome.tabs.Tab>;

  beforeEach(() => {
    tabsMap = new Map<number, chrome.tabs.Tab>([
      [1, { id: 1, url: 'https://example.com', title: 'Example', active: true, status: 'complete', index: 0, windowId: 1, highlighted: false, selected: true, pinned: false, discarded: false, autoDiscardable: true, groupId: -1, incognito: false, frozen: false } as unknown as chrome.tabs.Tab],
    ]);

    mockAdapter = {
      queryTabs: vi.fn().mockImplementation(async (queryInfo) => {
        if (queryInfo.active) {
          return Array.from(tabsMap.values()).filter(t => t.active);
        }
        return Array.from(tabsMap.values());
      }),
      createTab: vi.fn().mockImplementation(async (createProperties) => {
        const id = tabsMap.size + 1;
        // Make previous active tab inactive
        for (const t of tabsMap.values()) {
          t.active = false;
        }
        const newTab = {
          id,
          url: createProperties.url || '',
          title: 'New Tab',
          active: true,
          status: 'complete',
          index: tabsMap.size,
          windowId: 1,
          highlighted: false,
          selected: true,
          pinned: false,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
          incognito: false,
          frozen: false
        } as unknown as chrome.tabs.Tab;
        tabsMap.set(id, newTab);
        return newTab;
      }),
      getTab: vi.fn().mockImplementation(async (tabId) => {
        const tab = tabsMap.get(tabId);
        if (!tab) throw new Error(`Tab ${tabId} not found`);
        return tab;
      }),
      updateTab: vi.fn().mockImplementation(async (tabId, updateProperties) => {
        const tab = tabsMap.get(tabId);
        if (!tab) throw new Error(`Tab ${tabId} not found`);
        if (updateProperties.url !== undefined) tab.url = updateProperties.url;
        if (updateProperties.active !== undefined) {
          for (const t of tabsMap.values()) {
            t.active = false;
          }
          tab.active = updateProperties.active;
        }
        return tab;
      }),
      removeTab: vi.fn().mockImplementation(async (tabId) => {
        tabsMap.delete(tabId);
      }),
      addTabUpdatedListener: vi.fn(),
      removeTabUpdatedListener: vi.fn(),
      addTabActivatedListener: vi.fn(),
      removeTabActivatedListener: vi.fn(),
      detachDebugger: vi.fn().mockResolvedValue(undefined),
    };

    mockStorage = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    context = new BrowserContext({}, mockAdapter, mockStorage);
  });

  it('uses injected browser adapter to get the current page', async () => {
    const page = await context.getCurrentPage();
    expect(page).toBeDefined();
    expect(page.tabId).toBe(1);
    expect(mockAdapter.queryTabs).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it('uses injected browser adapter to query all tab IDs', async () => {
    tabsMap.set(10, { id: 10, url: 'https://a.com', active: false } as any);
    tabsMap.set(20, { id: 20, url: 'https://b.com', active: false } as any);
    const tabIds = await context.getAllTabIds();
    expect(tabIds).toEqual(new Set([1, 10, 20]));
    expect(mockAdapter.queryTabs).toHaveBeenCalledWith({ currentWindow: true });
  });

  it('uses injected browser adapter to open a new tab', async () => {
    const page = await context.openTab('https://foo.com');
    expect(page).toBeDefined();
    expect(page.tabId).toBe(2);
    expect(mockAdapter.createTab).toHaveBeenCalledWith({ url: 'https://foo.com', active: true });
  });

  it('uses injected browser adapter to close a tab', async () => {
    await context.closeTab(3);
    expect(mockAdapter.removeTab).toHaveBeenCalledWith(3);
  });

  it('gets tab infos matching IBrowserAdapter wrapper output', async () => {
    tabsMap.set(2, { id: 2, url: 'https://foo.com', title: 'Foo' } as any);
    const tabInfos = await context.getTabInfos();
    expect(tabInfos).toEqual([
      { id: 1, url: 'https://example.com', title: 'Example' },
      { id: 2, url: 'https://foo.com', title: 'Foo' },
    ]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock webextension-polyfill before any imports are evaluated
vi.mock('webextension-polyfill', () => {
  return {};
});

// Mock puppeteer-core connection
vi.mock('puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js', () => {
  return {
    connect: vi.fn().mockResolvedValue({
      disconnect: vi.fn(),
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
    expect(mockAdapter.queryTabs).toHaveBeenCalledWith({});
  });

  it('uses injected browser adapter to open a new tab', async () => {
    const page = await context.openTab('https://foo.com');
    expect(page).toBeDefined();
    expect(page.tabId).toBe(2);
    expect(mockAdapter.createTab).toHaveBeenCalledWith({ url: 'https://foo.com', active: true });
  });

  it('waits for a real navigated URL before attaching after navigating from an internal page', async () => {
    tabsMap.set(1, {
      ...tabsMap.get(1)!,
      url: 'chrome://extensions/',
      title: 'Extensions',
      status: 'complete',
    } as chrome.tabs.Tab);

    let updateListener: ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) | null = null;
    let postUpdateGetTabCalls = 0;
    mockAdapter.addTabUpdatedListener.mockImplementation((listener: typeof updateListener) => {
      updateListener = listener;
    });
    mockAdapter.updateTab.mockImplementation(async (tabId: number, updateProperties: chrome.tabs.UpdateProperties) => {
      const tab = tabsMap.get(tabId);
      if (!tab) throw new Error(`Tab ${tabId} not found`);
      if (updateProperties.active !== undefined) tab.active = updateProperties.active;
      updateListener?.(tabId, { status: 'complete' }, tab);
      return tab;
    });
    mockAdapter.getTab.mockImplementation(async (tabId: number) => {
      const tab = tabsMap.get(tabId);
      if (!tab) throw new Error(`Tab ${tabId} not found`);
      postUpdateGetTabCalls += 1;
      if (postUpdateGetTabCalls >= 3) {
        tab.url = 'https://x.com/home';
        tab.title = 'X Home';
      }
      return tab;
    });

    await context.navigateTo('https://twitter.com');

    const attachedPage = context.getPageForTab(1);
    expect(attachedPage).toBeDefined();
    expect(attachedPage?.validWebPage).toBe(true);
    expect(attachedPage?.url()).toBe('https://x.com/home');
  });

  it('navigates an attached page in place without re-attaching', async () => {
    const page = await context.getCurrentPage();
    expect(page.attached).toBe(true);
    const navigate = vi.spyOn(page, 'navigateTo').mockResolvedValue(undefined);

    await context.navigateTo('https://www.example.org/next');

    expect(navigate).toHaveBeenCalledWith('https://www.example.org/next');
    expect(context.getPageForTab(1)).toBe(page);
  });

  it('keeps an unattached page when the debugger cannot attach', async () => {
    const puppeteer = await import('puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js');
    vi.mocked(puppeteer.connect).mockRejectedValueOnce(new Error('Cannot access a chrome-extension:// URL of different extension'));

    const page = await context.getCurrentPage();

    expect(page.attached).toBe(false);
    expect(context.getPageForTab(1)).toBe(page);
  });

  it('uses the tab the task was started from', async () => {
    tabsMap.set(5, { ...tabsMap.get(1)!, id: 5, url: 'https://five.example/', active: false } as chrome.tabs.Tab);
    context.updateCurrentTabId(5);

    expect((await context.getCurrentPage()).tabId).toBe(5);
    expect(mockAdapter.queryTabs).not.toHaveBeenCalled();
  });

  it('removes its tab listeners when waiting for a new tab times out', async () => {
    vi.useFakeTimers();
    try {
      mockAdapter.getTab.mockImplementation(async (tabId: number) => ({ ...tabsMap.get(tabId)!, status: 'loading', active: false }));
      const opening = context.openTab('https://slow.example/');
      await vi.advanceTimersByTimeAsync(3100);
      await opening;

      expect(mockAdapter.removeTabUpdatedListener).toHaveBeenCalledWith(mockAdapter.addTabUpdatedListener.mock.calls[0][0]);
      expect(mockAdapter.removeTabActivatedListener).toHaveBeenCalledWith(mockAdapter.addTabActivatedListener.mock.calls[0][0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up the pages it holds without querying tabs', async () => {
    const page = await context.getCurrentPage();
    const detach = vi.spyOn(page, 'detachPuppeteer');
    mockAdapter.queryTabs.mockClear();
    mockAdapter.getTab.mockClear();

    await context.cleanup();

    expect(detach).toHaveBeenCalled();
    expect(mockAdapter.queryTabs).not.toHaveBeenCalled();
    expect(mockAdapter.getTab).not.toHaveBeenCalled();
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

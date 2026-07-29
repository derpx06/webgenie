import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChromeBrowserAdapter } from '../ChromeBrowserAdapter';
import { ChromeStorageProvider } from '../ChromeStorageProvider';

describe('ChromeBrowserAdapter', () => {
  let adapter: ChromeBrowserAdapter;

  beforeEach(() => {
    adapter = new ChromeBrowserAdapter();
    const mockTabsQuery = vi.fn();
    const mockCaptureVisibleTab = vi.fn();
    const mockAddListener = vi.fn();
    const mockRemoveListener = vi.fn();
    const mockSendMessage = vi.fn();

    const mockTabsCreate = vi.fn();
    const mockTabsGet = vi.fn();
    const mockTabsUpdate = vi.fn();
    const mockTabsRemove = vi.fn();
    const mockTabsSendMessage = vi.fn();
    const mockTabsOnUpdatedAdd = vi.fn();
    const mockTabsOnUpdatedRemove = vi.fn();
    const mockTabsOnActivatedAdd = vi.fn();
    const mockTabsOnActivatedRemove = vi.fn();

    const mockDebuggerAttach = vi.fn();
    const mockDebuggerDetach = vi.fn();
    const mockDebuggerSendCommand = vi.fn();

    vi.stubGlobal('chrome', {
      tabs: {
        query: mockTabsQuery,
        captureVisibleTab: mockCaptureVisibleTab,
        create: mockTabsCreate,
        get: mockTabsGet,
        update: mockTabsUpdate,
        remove: mockTabsRemove,
        sendMessage: mockTabsSendMessage,
        onUpdated: {
          addListener: mockTabsOnUpdatedAdd,
          removeListener: mockTabsOnUpdatedRemove,
        },
        onActivated: {
          addListener: mockTabsOnActivatedAdd,
          removeListener: mockTabsOnActivatedRemove,
        },
      },
      runtime: {
        onMessage: {
          addListener: mockAddListener,
          removeListener: mockRemoveListener,
        },
        sendMessage: mockSendMessage,
      },
      debugger: {
        attach: mockDebuggerAttach,
        detach: mockDebuggerDetach,
        sendCommand: mockDebuggerSendCommand,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gets current URL', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ url: 'https://example.com' } as unknown as chrome.tabs.Tab]);
    const url = await adapter.getCurrentUrl();
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(url).toBe('https://example.com');
  });

  it('captures screenshot', async () => {
    vi.mocked(chrome.tabs.captureVisibleTab as unknown as () => Promise<string>).mockResolvedValue('data:image/png;base64,abc');
    const screenshot = await adapter.captureScreenshot();
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalled();
    expect(screenshot).toBe('data:image/png;base64,abc');
  });

  it('handles capture visible tab error gracefully', async () => {
    vi.mocked(chrome.tabs.captureVisibleTab).mockRejectedValue(new Error('detaching'));
    const screenshot = await adapter.captureScreenshot();
    expect(screenshot).toBeUndefined();
  });

  it('adds and removes message listeners', () => {
    const listener = () => {};
    adapter.addMessageListener(listener);
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledWith(listener);

    adapter.removeMessageListener(listener);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
  });

  it('sends message', async () => {
    vi.mocked(chrome.runtime.sendMessage as unknown as (...args: unknown[]) => Promise<unknown>).mockResolvedValue({ success: true });
    const response = await adapter.sendMessage({ type: 'PING' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PING' });
    expect(response).toEqual({ success: true });
  });

  it('queries tabs', async () => {
    const mockTabs = [{ id: 1, url: 'https://foo.com' }];
    vi.mocked(chrome.tabs.query).mockResolvedValue(mockTabs as unknown as chrome.tabs.Tab[]);
    const result = await adapter.queryTabs({ currentWindow: true });
    expect(chrome.tabs.query).toHaveBeenCalledWith({ currentWindow: true });
    expect(result).toEqual(mockTabs);
  });

  it('creates tab', async () => {
    const mockTab = { id: 2, url: 'https://bar.com' };
    vi.mocked(chrome.tabs.create as unknown as (...args: unknown[]) => Promise<chrome.tabs.Tab>).mockResolvedValue(mockTab as unknown as chrome.tabs.Tab);
    const result = await adapter.createTab({ url: 'https://bar.com' });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://bar.com' });
    expect(result).toEqual(mockTab);
  });

  it('gets tab', async () => {
    const mockTab = { id: 3, url: 'https://baz.com' };
    vi.mocked(chrome.tabs.get).mockResolvedValue(mockTab as unknown as chrome.tabs.Tab);
    const result = await adapter.getTab(3);
    expect(chrome.tabs.get).toHaveBeenCalledWith(3);
    expect(result).toEqual(mockTab);
  });

  it('updates tab', async () => {
    const mockTab = { id: 4, url: 'https://qux.com' };
    vi.mocked(chrome.tabs.update as unknown as (...args: unknown[]) => Promise<chrome.tabs.Tab>).mockResolvedValue(mockTab as unknown as chrome.tabs.Tab);
    const result = await adapter.updateTab(4, { active: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(4, { active: true });
    expect(result).toEqual(mockTab);
  });

  it('removes tab', async () => {
    vi.mocked(chrome.tabs.remove).mockResolvedValue(undefined);
    await adapter.removeTab(5);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(5);
  });

  it('adds and removes tab updated listeners', () => {
    const listener = () => {};
    adapter.addTabUpdatedListener(listener);
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalledWith(listener);

    adapter.removeTabUpdatedListener(listener);
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledWith(listener);
  });

  it('adds and removes tab activated listeners', () => {
    const listener = () => {};
    adapter.addTabActivatedListener(listener);
    expect(chrome.tabs.onActivated.addListener).toHaveBeenCalledWith(listener);

    adapter.removeTabActivatedListener(listener);
    expect(chrome.tabs.onActivated.removeListener).toHaveBeenCalledWith(listener);
  });

  it('sends tab message', async () => {
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({ status: 'ok' });
    const response = await adapter.sendTabMessage(6, { data: 'test' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(6, { data: 'test' });
    expect(response).toEqual({ status: 'ok' });
  });

  it('attaches debugger', async () => {
    vi.mocked(chrome.debugger.attach).mockResolvedValue(undefined);
    await adapter.attachDebugger({ tabId: 7 }, '1.3');
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');
  });

  it('detaches debugger', async () => {
    vi.mocked(chrome.debugger.detach).mockResolvedValue(undefined);
    await adapter.detachDebugger({ tabId: 8 });
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 8 });
  });

  it('sends debugger command', async () => {
    vi.mocked(chrome.debugger.sendCommand as unknown as (...args: unknown[]) => Promise<unknown>).mockResolvedValue({ nodeId: 42 });
    const response = await adapter.sendDebuggerCommand({ tabId: 9 }, 'DOM.getDocument', { depth: 1 });
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 9 }, 'DOM.getDocument', { depth: 1 });
    expect(response).toEqual({ nodeId: 42 });
  });
});

describe('ChromeStorageProvider', () => {
  let provider: ChromeStorageProvider;

  beforeEach(() => {
    provider = new ChromeStorageProvider();
    const mockGet = vi.fn();
    const mockSet = vi.fn();
    const mockRemove = vi.fn();

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: mockGet,
          set: mockSet,
          remove: mockRemove,
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gets value from storage', async () => {
    vi.mocked(chrome.storage.local.get as unknown as (...args: unknown[]) => Promise<unknown>).mockResolvedValue({ myKey: 'myValue' });
    const val = await provider.get('myKey');
    expect(chrome.storage.local.get).toHaveBeenCalledWith('myKey');
    expect(val).toBe('myValue');
  });

  it('returns null if value is not in storage', async () => {
    vi.mocked(chrome.storage.local.get as unknown as (...args: unknown[]) => Promise<unknown>).mockResolvedValue({});
    const val = await provider.get('nonExistentKey');
    expect(val).toBeNull();
  });

  it('sets value in storage', async () => {
    await provider.set('myKey', 'myValue');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ myKey: 'myValue' });
  });

  it('removes value from storage', async () => {
    await provider.remove('myKey');
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('myKey');
  });
});

describe('ChromeBrowserAdapter callback errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects bookmark callbacks when Chrome reports runtime.lastError', async () => {
    const runtime = { lastError: undefined as { message: string } | undefined };
    const search = vi.fn((_query: unknown, callback: (results: unknown[]) => void) => {
      runtime.lastError = { message: 'Bookmarks permission denied' };
      callback([]);
      runtime.lastError = undefined;
    });
    vi.stubGlobal('chrome', {
      runtime,
      bookmarks: { search },
    });

    await expect(new ChromeBrowserAdapter().searchBookmarks('webgenie')).rejects.toThrow('Bookmarks permission denied');
  });

  it('reports unsupported reading-list APIs instead of returning an empty success', async () => {
    vi.stubGlobal('chrome', { runtime: {}, });

    await expect(new ChromeBrowserAdapter().queryReadingList()).rejects.toThrow('chrome.readingList API not available');
  });
});

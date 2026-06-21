import type { IBrowserAdapter } from './IBrowserAdapter';

export class ChromeBrowserAdapter implements IBrowserAdapter {
  async getCurrentUrl(): Promise<string | undefined> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.url;
  }

  async captureScreenshot(): Promise<string | undefined> {
    try {
      return await chrome.tabs.captureVisibleTab();
    } catch (e) {
      return undefined;
    }
  }

  addMessageListener(
    listener: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void | boolean
  ): void {
    chrome.runtime.onMessage.addListener(listener as Parameters<typeof chrome.runtime.onMessage.addListener>[0]);
  }

  removeMessageListener(
    listener: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void | boolean
  ): void {
    chrome.runtime.onMessage.removeListener(listener as Parameters<typeof chrome.runtime.onMessage.removeListener>[0]);
  }

  async sendMessage(message: unknown): Promise<unknown> {
    return chrome.runtime.sendMessage(message);
  }

  // Tabs Management
  async queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
    return chrome.tabs.query(queryInfo);
  }

  async createTab(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
    return chrome.tabs.create(createProperties);
  }

  async getTab(tabId: number): Promise<chrome.tabs.Tab> {
    return chrome.tabs.get(tabId);
  }

  async updateTab(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab | undefined> {
    return chrome.tabs.update(tabId, updateProperties);
  }

  async removeTab(tabId: number): Promise<void> {
    return chrome.tabs.remove(tabId);
  }

  addTabCreatedListener(listener: (tab: chrome.tabs.Tab) => void): void {
    chrome.tabs.onCreated.addListener(listener);
  }

  removeTabCreatedListener(listener: (tab: chrome.tabs.Tab) => void): void {
    chrome.tabs.onCreated.removeListener(listener);
  }

  addTabUpdatedListener(listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void {
    chrome.tabs.onUpdated.addListener(listener);
  }

  removeTabUpdatedListener(listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void {
    chrome.tabs.onUpdated.removeListener(listener);
  }

  addTabRemovedListener(listener: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void): void {
    chrome.tabs.onRemoved.addListener(listener);
  }

  removeTabRemovedListener(listener: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void): void {
    chrome.tabs.onRemoved.removeListener(listener);
  }

  addTabActivatedListener(listener: (activeInfo: chrome.tabs.TabActiveInfo) => void): void {
    chrome.tabs.onActivated.addListener(listener);
  }

  removeTabActivatedListener(listener: (activeInfo: chrome.tabs.TabActiveInfo) => void): void {
    chrome.tabs.onActivated.removeListener(listener);
  }

  addTabMovedListener(listener: (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => void): void {
    chrome.tabs.onMoved.addListener(listener);
  }

  removeTabMovedListener(listener: (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => void): void {
    chrome.tabs.onMoved.removeListener(listener);
  }

  async sendTabMessage(tabId: number, message: unknown): Promise<unknown> {
    return chrome.tabs.sendMessage(tabId, message);
  }

  // Debugger Management
  async attachDebugger(target: chrome.debugger.Debuggee, requiredVersion: string): Promise<void> {
    return chrome.debugger.attach(target, requiredVersion);
  }

  async detachDebugger(target: chrome.debugger.Debuggee): Promise<void> {
    return chrome.debugger.detach(target);
  }

  async sendDebuggerCommand(target: chrome.debugger.Debuggee, method: string, commandParams?: Record<string, unknown>): Promise<unknown> {
    return chrome.debugger.sendCommand(target, method, commandParams);
  }

  async getDebuggerTargets(): Promise<chrome.debugger.TargetInfo[]> {
    return new Promise<chrome.debugger.TargetInfo[]>((resolve) => {
      chrome.debugger.getTargets(resolve);
    });
  }
  // Scripting & Navigation Management
  async executeScript<T>(injection: {
    target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
    func?: (...args: any[]) => T;
    args?: any[];
    files?: string[];
  }): Promise<Array<{ result: T; frameId: number }>> {
    return chrome.scripting.executeScript(injection as any) as unknown as Promise<Array<{ result: T; frameId: number }>>;
  }

  async getAllFrames(details: { tabId: number }): Promise<any[] | null> {
    return chrome.webNavigation.getAllFrames(details);
  }

  // History Management
  async searchHistory(query: chrome.history.HistoryQuery): Promise<chrome.history.HistoryItem[]> {
    return chrome.history.search(query);
  }
  async getHistoryVisits(details: { url: string }): Promise<chrome.history.VisitItem[]> {
    return chrome.history.getVisits(details);
  }
  async addHistoryUrl(details: { url: string }): Promise<void> {
    return chrome.history.addUrl(details);
  }

  // Reading List
  async queryReadingList(queryInfo?: { hasBeenRead?: boolean }): Promise<any[]> {
    return new Promise((resolve) => {
      (chrome as any).readingList.query(queryInfo || {}, resolve);
    });
  }
  async addReadingListItem(entry: any): Promise<void> {
    return new Promise((resolve) => (chrome as any).readingList.addEntry(entry, resolve));
  }
  async updateReadingListItem(entry: { url: string, hasBeenRead?: boolean }): Promise<void> {
    return new Promise((resolve) => (chrome as any).readingList.updateEntry(entry, resolve));
  }

  // Bookmarks Management
  async getBookmarksTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    return chrome.bookmarks.getTree();
  }
  async searchBookmarks(query: string | any): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    return chrome.bookmarks.search(query);
  }
  async createBookmark(bookmark: any): Promise<chrome.bookmarks.BookmarkTreeNode> {
    return chrome.bookmarks.create(bookmark);
  }

  // Window Management
  async getCurrentWindow(): Promise<chrome.windows.Window> {
    return chrome.windows.getCurrent();
  }
  async getAllWindows(queryOptions?: chrome.windows.QueryOptions): Promise<chrome.windows.Window[]> {
    return chrome.windows.getAll(queryOptions);
  }
  async addWindowFocusChangedListener(callback: (windowId: number) => void): Promise<void> {
    chrome.windows.onFocusChanged.addListener(callback);
  }
  async removeWindowFocusChangedListener(callback: (windowId: number) => void): Promise<void> {
    chrome.windows.onFocusChanged.removeListener(callback);
  }

  // Tab Groups Management
  async groupTabs(options: chrome.tabs.GroupOptions): Promise<number> {
    return chrome.tabs.group(options);
  }
  async ungroupTabs(tabIds: number | number[]): Promise<void> {
    return chrome.tabs.ungroup(tabIds);
  }
  async updateTabGroup(groupId: number, updateProperties: chrome.tabGroups.UpdateProperties): Promise<chrome.tabGroups.TabGroup | undefined> {
    return chrome.tabGroups.update(groupId, updateProperties);
  }

  // Downloads
  async downloadFile(options: chrome.downloads.DownloadOptions): Promise<number> {
    return chrome.downloads.download(options);
  }
  async searchDownloads(query: chrome.downloads.DownloadQuery): Promise<chrome.downloads.DownloadItem[]> {
    return chrome.downloads.search(query);
  }
  async pauseDownload(downloadId: number): Promise<void> {
    return chrome.downloads.pause(downloadId);
  }

  // System & Performance
  async getSystemMemory(): Promise<chrome.system.memory.MemoryInfo> {
    return new Promise((resolve) => chrome.system.memory.getInfo(resolve));
  }
  async getSystemCpu(): Promise<chrome.system.cpu.CpuInfo> {
    return new Promise((resolve) => chrome.system.cpu.getInfo(resolve));
  }

  // Sessions
  async getRecentlyClosed(filter?: chrome.sessions.Filter): Promise<chrome.sessions.Session[]> {
    return new Promise((resolve) => chrome.sessions.getRecentlyClosed(filter || {}, resolve));
  }
  async restoreSession(sessionId?: string): Promise<chrome.sessions.Session> {
    return new Promise((resolve) => {
      if (sessionId) {
        chrome.sessions.restore(sessionId, resolve);
      } else {
        chrome.sessions.restore(resolve);
      }
    });
  }

  // Browsing Data
  async removeBrowsingData(options: chrome.browsingData.RemovalOptions, dataToRemove: chrome.browsingData.DataTypeSet): Promise<void> {
    return new Promise((resolve) => chrome.browsingData.remove(options, dataToRemove, resolve));
  }

  // Management (Extensions)
  async getAllExtensions(): Promise<chrome.management.ExtensionInfo[]> {
    return new Promise((resolve) => chrome.management.getAll(resolve));
  }
  async setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
    return new Promise((resolve) => chrome.management.setEnabled(id, enabled, resolve));
  }

  // Context Menus
  async createContextMenu(createProperties: chrome.contextMenus.CreateProperties): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.contextMenus.create(createProperties, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }
  async updateContextMenu(id: string | number, updateProperties: Omit<chrome.contextMenus.CreateProperties, "id">): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.contextMenus.update(id, updateProperties, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }
  async removeContextMenu(menuItemId: string | number): Promise<void> {
    return new Promise((resolve) => chrome.contextMenus.remove(menuItemId, resolve));
  }
  async removeAllContextMenus(): Promise<void> {
    return new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  }
}

import type { IBrowserAdapter } from './IBrowserAdapter';

export class ChromeBrowserAdapter implements IBrowserAdapter {
  private getLastRuntimeError(): Error | null {
    const lastError = chrome.runtime?.lastError;
    return lastError ? new Error(lastError.message) : null;
  }

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
    return new Promise<chrome.debugger.TargetInfo[]>((resolve, reject) => {
      chrome.debugger.getTargets((targets) => {
        const error = this.getLastRuntimeError();
        if (error) reject(error);
        else resolve(targets);
      });
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
    return new Promise((resolve, reject) => {
      const readingList = (chrome as any).readingList;
      if (!readingList) {
        reject(new Error('chrome.readingList API not available'));
        return;
      }
      readingList.query(queryInfo || {}, (items: any[]) => {
        const error = this.getLastRuntimeError();
        if (error) reject(error);
        else resolve(items);
      });
    });
  }
  async addReadingListItem(entry: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const readingList = (chrome as any).readingList;
      if (!readingList) {
        reject(new Error('chrome.readingList API not available'));
        return;
      }
      readingList.addEntry(entry, () => {
        const error = this.getLastRuntimeError();
        if (error) reject(error);
        else resolve();
      });
    });
  }
  async updateReadingListItem(entry: { url: string, hasBeenRead?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const readingList = (chrome as any).readingList;
      if (!readingList) {
        reject(new Error('chrome.readingList API not available'));
        return;
      }
      readingList.updateEntry(entry, () => {
        const error = this.getLastRuntimeError();
        if (error) reject(error);
        else resolve();
      });
    });
  }

  // Bookmarks Management
  async getBookmarksTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    return chrome.bookmarks.getTree();
  }
  async searchBookmarks(query: string | object): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    return new Promise((resolve, reject) => chrome.bookmarks.search(query as any, (results) => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve(results);
    }));
  }
  async getRecentBookmarks(numberOfItems: number): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
    return new Promise((resolve, reject) => chrome.bookmarks.getRecent(numberOfItems, (results) => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve(results);
    }));
  }
  async createBookmark(bookmark: any): Promise<chrome.bookmarks.BookmarkTreeNode> {
    return chrome.bookmarks.create(bookmark);
  }
  async removeBookmark(id: string): Promise<void> {
    return new Promise((resolve, reject) => chrome.bookmarks.remove(id, () => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve();
    }));
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
    return new Promise((resolve, reject) => chrome.system.memory.getInfo((info) => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve(info);
    }));
  }
  async getSystemCpu(): Promise<chrome.system.cpu.CpuInfo> {
    return new Promise((resolve, reject) => chrome.system.cpu.getInfo((info) => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve(info);
    }));
  }

  // Sessions
  async getRecentlyClosed(filter?: chrome.sessions.Filter): Promise<chrome.sessions.Session[]> {
    return new Promise((resolve, reject) => chrome.sessions.getRecentlyClosed(filter || {}, (sessions) => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve(sessions);
    }));
  }
  async restoreSession(sessionId?: string): Promise<chrome.sessions.Session> {
    return new Promise((resolve, reject) => {
      const callback = (session: chrome.sessions.Session) => {
        const error = this.getLastRuntimeError();
        if (error) reject(error);
        else resolve(session);
      };
      if (sessionId) {
        chrome.sessions.restore(sessionId, callback);
      } else {
        chrome.sessions.restore(callback);
      }
    });
  }

  // Browsing Data
  async removeBrowsingData(options: chrome.browsingData.RemovalOptions, dataToRemove: chrome.browsingData.DataTypeSet): Promise<void> {
    return new Promise((resolve, reject) => chrome.browsingData.remove(options, dataToRemove, () => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve();
    }));
  }

  // Management (Extensions)
  async getAllExtensions(): Promise<chrome.management.ExtensionInfo[]> {
    return new Promise((resolve, reject) => chrome.management.getAll((extensions) => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve(extensions);
    }));
  }
  async setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
    return new Promise((resolve, reject) => chrome.management.setEnabled(id, enabled, () => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve();
    }));
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
    return new Promise((resolve, reject) => chrome.contextMenus.remove(menuItemId, () => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve();
    }));
  }
  async removeAllContextMenus(): Promise<void> {
    return new Promise((resolve, reject) => chrome.contextMenus.removeAll(() => {
      const error = this.getLastRuntimeError();
      if (error) reject(error);
      else resolve();
    }));
  }
}

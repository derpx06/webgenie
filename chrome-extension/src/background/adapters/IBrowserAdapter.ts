export interface IBrowserAdapter {
  getCurrentUrl(): Promise<string | undefined>;
  captureScreenshot(): Promise<string | undefined>;
  addMessageListener(
    listener: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void | boolean
  ): void;
  removeMessageListener(
    listener: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void | boolean
  ): void;
  sendMessage(message: unknown): Promise<unknown>;

  // Tabs Management
  queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  createTab(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  getTab(tabId: number): Promise<chrome.tabs.Tab>;
  updateTab(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab | undefined>;
  removeTab(tabId: number): Promise<void>;
  addTabCreatedListener(listener: (tab: chrome.tabs.Tab) => void): void;
  removeTabCreatedListener(listener: (tab: chrome.tabs.Tab) => void): void;
  addTabUpdatedListener(listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void;
  removeTabUpdatedListener(listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void;
  addTabRemovedListener(listener: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void): void;
  removeTabRemovedListener(listener: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void): void;
  addTabActivatedListener(listener: (activeInfo: chrome.tabs.TabActiveInfo) => void): void;
  removeTabActivatedListener(listener: (activeInfo: chrome.tabs.TabActiveInfo) => void): void;
  addTabMovedListener(listener: (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => void): void;
  removeTabMovedListener(listener: (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => void): void;
  sendTabMessage(tabId: number, message: unknown): Promise<unknown>;

  // Debugger Management
  attachDebugger(target: chrome.debugger.Debuggee, requiredVersion: string): Promise<void>;
  detachDebugger(target: chrome.debugger.Debuggee): Promise<void>;
  sendDebuggerCommand(target: chrome.debugger.Debuggee, method: string, commandParams?: Record<string, unknown>): Promise<unknown>;
  getDebuggerTargets(): Promise<chrome.debugger.TargetInfo[]>;

  // Scripting & Navigation Management
  executeScript<T>(injection: {
    target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
    func?: (...args: any[]) => T;
    args?: any[];
    files?: string[];
  }): Promise<Array<{ result: T; frameId: number }>>;
  getAllFrames(details: { tabId: number }): Promise<any[] | null>;

  // History Management
  searchHistory(query: chrome.history.HistoryQuery): Promise<chrome.history.HistoryItem[]>;
  getHistoryVisits(details: { url: string }): Promise<chrome.history.VisitItem[]>;
  addHistoryUrl(details: { url: string }): Promise<void>;

  // Reading List
  queryReadingList(queryInfo?: { hasBeenRead?: boolean }): Promise<any[]>;
  addReadingListItem(entry: any): Promise<void>;
  updateReadingListItem(entry: { url: string, hasBeenRead?: boolean }): Promise<void>;

  // Bookmarks Management
  getBookmarksTree(): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  searchBookmarks(query: string | any): Promise<chrome.bookmarks.BookmarkTreeNode[]>;
  createBookmark(bookmark: any): Promise<chrome.bookmarks.BookmarkTreeNode>;

  // Window Management
  getCurrentWindow(): Promise<chrome.windows.Window>;
  getAllWindows(queryOptions?: chrome.windows.QueryOptions): Promise<chrome.windows.Window[]>;
  addWindowFocusChangedListener(listener: (windowId: number) => void): void;
  removeWindowFocusChangedListener(listener: (windowId: number) => void): void;

  // Tab Groups Management
  groupTabs(options: chrome.tabs.GroupOptions): Promise<number>;
  ungroupTabs(tabIds: number | number[]): Promise<void>;
  updateTabGroup(groupId: number, updateProperties: chrome.tabGroups.UpdateProperties): Promise<chrome.tabGroups.TabGroup | undefined>;

  // Downloads
  downloadFile(options: chrome.downloads.DownloadOptions): Promise<number>;
  searchDownloads(query: chrome.downloads.DownloadQuery): Promise<chrome.downloads.DownloadItem[]>;
  pauseDownload(downloadId: number): Promise<void>;

  // System & Performance
  getSystemMemory(): Promise<chrome.system.memory.MemoryInfo>;
  getSystemCpu(): Promise<chrome.system.cpu.CpuInfo>;

  // Sessions
  getRecentlyClosed(filter?: chrome.sessions.Filter): Promise<chrome.sessions.Session[]>;
  restoreSession(sessionId?: string): Promise<chrome.sessions.Session>;

  // Browsing Data
  removeBrowsingData(options: chrome.browsingData.RemovalOptions, dataToRemove: chrome.browsingData.DataTypeSet): Promise<void>;

  // Management (Extensions)
  getAllExtensions(): Promise<chrome.management.ExtensionInfo[]>;
  setExtensionEnabled(id: string, enabled: boolean): Promise<void>;

  // Context Menus
  createContextMenu(createProperties: chrome.contextMenus.CreateProperties): Promise<void>;
  updateContextMenu(id: string | number, updateProperties: Omit<chrome.contextMenus.CreateProperties, "id">): Promise<void>;
  removeContextMenu(menuItemId: string | number): Promise<void>;
  removeAllContextMenus(): Promise<void>;
}


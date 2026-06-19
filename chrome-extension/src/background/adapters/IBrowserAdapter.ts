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
  updateTab(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab>;
  removeTab(tabId: number): Promise<void>;
  addTabUpdatedListener(listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void;
  removeTabUpdatedListener(listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void;
  addTabActivatedListener(listener: (activeInfo: chrome.tabs.TabActiveInfo) => void): void;
  removeTabActivatedListener(listener: (activeInfo: chrome.tabs.TabActiveInfo) => void): void;
  sendTabMessage(tabId: number, message: unknown): Promise<unknown>;

  // Debugger Management
  attachDebugger(target: chrome.debugger.Debuggee, requiredVersion: string): Promise<void>;
  detachDebugger(target: chrome.debugger.Debuggee): Promise<void>;
  sendDebuggerCommand(target: chrome.debugger.Debuggee, method: string, commandParams?: object): Promise<unknown>;
}


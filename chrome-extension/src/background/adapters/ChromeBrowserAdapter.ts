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

  async updateTab(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> {
    return chrome.tabs.update(tabId, updateProperties);
  }

  async removeTab(tabId: number): Promise<void> {
    return chrome.tabs.remove(tabId);
  }

  addTabUpdatedListener(listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void {
    chrome.tabs.onUpdated.addListener(listener);
  }

  removeTabUpdatedListener(listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void {
    chrome.tabs.onUpdated.removeListener(listener);
  }

  addTabActivatedListener(listener: (activeInfo: chrome.tabs.TabActiveInfo) => void): void {
    chrome.tabs.onActivated.addListener(listener);
  }

  removeTabActivatedListener(listener: (activeInfo: chrome.tabs.TabActiveInfo) => void): void {
    chrome.tabs.onActivated.removeListener(listener);
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

  async sendDebuggerCommand(target: chrome.debugger.Debuggee, method: string, commandParams?: object): Promise<unknown> {
    return chrome.debugger.sendCommand(target, method, commandParams);
  }
}


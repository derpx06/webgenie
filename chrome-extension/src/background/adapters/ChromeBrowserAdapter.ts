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
}

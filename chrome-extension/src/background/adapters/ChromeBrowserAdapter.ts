import { IBrowserAdapter } from './IBrowserAdapter';

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

  addMessageListener(listener: (message: any, sender: any, sendResponse: (response?: any) => void) => void): void {
    chrome.runtime.onMessage.addListener(listener);
  }

  removeMessageListener(listener: any): void {
    chrome.runtime.onMessage.removeListener(listener);
  }

  async sendMessage(message: any): Promise<any> {
    return chrome.runtime.sendMessage(message);
  }
}

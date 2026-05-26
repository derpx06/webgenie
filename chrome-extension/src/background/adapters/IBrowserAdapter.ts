export interface IBrowserAdapter {
  getCurrentUrl(): Promise<string | undefined>;
  captureScreenshot(): Promise<string | undefined>;
  addMessageListener(listener: (message: any, sender: any, sendResponse: (response?: any) => void) => void): void;
  removeMessageListener(listener: Function): void;
  sendMessage(message: any): Promise<any>;
}

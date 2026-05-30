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
}

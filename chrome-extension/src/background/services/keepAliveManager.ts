import { createLogger } from '../log';

const logger = createLogger('KeepAliveManager');
const OFFSCREEN_DOCUMENT_PATH = 'keep-alive/keep-alive.html';

export class KeepAliveManager {
  private static instance: KeepAliveManager;
  private isKeepingAlive = false;

  private constructor() {}

  public static getInstance(): KeepAliveManager {
    if (!KeepAliveManager.instance) {
      KeepAliveManager.instance = new KeepAliveManager();
    }
    return KeepAliveManager.instance;
  }

  public async startKeepAlive(): Promise<void> {
    if (this.isKeepingAlive) return;

    try {
      const hasDocument = await chrome.offscreen.hasDocument();
      if (!hasDocument) {
        logger.info('Starting enterprise keep-alive via offscreen document...');
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: [chrome.offscreen.Reason.WORKERS || 'WORKERS'],
          justification: 'Keep service worker alive during long LLM execution to prevent premature termination.',
        });
        this.isKeepingAlive = true;
        logger.info('Offscreen keep-alive document created successfully.');
      } else {
        this.isKeepingAlive = true;
      }
    } catch (error) {
      logger.error('Failed to create offscreen keep-alive document:', error);
    }
  }

  public async stopKeepAlive(): Promise<void> {
    if (!this.isKeepingAlive) return;

    try {
      const hasDocument = await chrome.offscreen.hasDocument();
      if (hasDocument) {
        logger.info('Stopping enterprise keep-alive. Closing offscreen document...');
        await chrome.offscreen.closeDocument();
        logger.info('Offscreen document closed.');
      }
    } catch (error) {
      logger.error('Failed to close offscreen keep-alive document:', error);
    } finally {
      this.isKeepingAlive = false;
    }
  }
}

export const keepAliveManager = KeepAliveManager.getInstance();

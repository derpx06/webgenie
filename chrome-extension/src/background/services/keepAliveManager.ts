import { createLogger } from '../log';

const logger = createLogger('KeepAliveManager');
const OFFSCREEN_DOCUMENT_PATH = 'keep-alive/keep-alive.html';

/**
 * The offscreen document that keeps the service worker alive through a long model call.
 *
 * It holds no state of its own, deliberately. It used to track `isKeepingAlive` in a field, and that field lives on
 * the service worker while the document does not: an offscreen document opened for `WORKERS` has no lifetime limit,
 * so it outlived every worker that created it. After a worker death the field read `false`, `stopKeepAlive()` took
 * its early return, and the document went on pinging for the rest of the browser session — defeating the idle
 * shutdown it exists to defer, invisibly, with no way for the user to stop it.
 *
 * An extension may have exactly one offscreen document, so this is also the only claim on that slot.
 */
export class KeepAliveManager {
  private static instance: KeepAliveManager;
  /** In flight only, so two concurrent starts await one creation rather than racing into an error. */
  private creating: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): KeepAliveManager {
    if (!KeepAliveManager.instance) {
      KeepAliveManager.instance = new KeepAliveManager();
    }
    return KeepAliveManager.instance;
  }

  /**
   * Whether our offscreen document is open, asked of the browser.
   *
   * `chrome.offscreen.hasDocument()` is Chrome 150 or newer; `getContexts` is the documented check and works
   * further back, so it is tried first and `hasDocument` is only the fallback.
   */
  private async isOpen(): Promise<boolean> {
    const url = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    try {
      if (typeof chrome.runtime.getContexts === 'function') {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
          documentUrls: [url],
        });
        return contexts.length > 0;
      }
      return await chrome.offscreen.hasDocument();
    } catch (error) {
      logger.warning('Could not ask the browser whether the offscreen document is open:', error);
      return false;
    }
  }

  public async startKeepAlive(): Promise<void> {
    if (this.creating) return this.creating;
    if (await this.isOpen()) return;

    this.creating = (async () => {
      try {
        logger.info('Starting keep-alive via offscreen document...');
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: [chrome.offscreen.Reason.WORKERS || 'WORKERS'],
          justification: 'Keep service worker alive during long LLM execution to prevent premature termination.',
        });
        logger.info('Offscreen keep-alive document created.');
      } catch (error) {
        // createDocument takes over 100ms, so two near-simultaneous starts can both pass the check above. One wins.
        if (/single offscreen document|only a single/i.test(String(error))) {
          logger.info('An offscreen document already exists; using it.');
          return;
        }
        logger.error('Failed to create offscreen keep-alive document:', error);
      } finally {
        this.creating = null;
      }
    })();
    return this.creating;
  }

  public async stopKeepAlive(): Promise<void> {
    if (!(await this.isOpen())) return;
    try {
      logger.info('Stopping keep-alive. Closing offscreen document...');
      await chrome.offscreen.closeDocument();
      logger.info('Offscreen document closed.');
    } catch (error) {
      logger.error('Failed to close offscreen keep-alive document:', error);
    }
  }

  /**
   * Closes a document left behind by a worker that died with a task running. Called on startup, because that is the
   * one moment we know no task of ours is in flight.
   */
  public async sweepOrphan(): Promise<void> {
    if (await this.isOpen()) {
      logger.info('Closing an offscreen document left by an earlier service worker.');
      await this.stopKeepAlive();
    }
  }
}

export const keepAliveManager = KeepAliveManager.getInstance();

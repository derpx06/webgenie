/**
 * CDPBridge — Phase 1 Chromium API Integration
 *
 * Provides a typed, reusable wrapper around chrome.debugger for
 * sending CDP commands to a tab without Puppeteer overhead.
 *
 * STATUS: Ready for integration — not yet wired into the main agent pipeline.
 * To integrate: replace/augment page.ts getCDPSession() calls with this class.
 *
 * Capabilities unlocked:
 *   - Accessibility.getFullAXTree  (Phase 2 — semantic DOM)
 *   - Input.dispatchMouseEvent     (Phase 3 — OS-level clicks)
 *   - Input.insertText             (Phase 3 — reliable typing)
 *   - DOM.getBoxModel              (Phase 2 — element coordinates)
 *   - Network.*                    (Phase 4 — request interception)
 */

import { createLogger } from '@src/background/log';

const logger = createLogger('CDPBridge');

export class CDPBridge {
  /** Set of tabIds we have attached the debugger to */
  private attachedTabs = new Set<number>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async attach(tabId: number): Promise<void> {
    if (this.attachedTabs.has(tabId)) return;
    await new Promise<void>((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          // Already attached by another caller (e.g. Puppeteer) — that's fine
          const msg = chrome.runtime.lastError.message ?? '';
          if (msg.includes('already attached')) {
            logger.info(`[CDPBridge] Tab ${tabId} already attached — reusing session`);
            this.attachedTabs.add(tabId);
            resolve();
          } else {
            reject(new Error(msg));
          }
        } else {
          logger.info(`[CDPBridge] Attached to tab ${tabId}`);
          this.attachedTabs.add(tabId);
          resolve();
        }
      });
    });
  }

  async detach(tabId: number): Promise<void> {
    if (!this.attachedTabs.has(tabId)) return;
    await new Promise<void>((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        this.attachedTabs.delete(tabId);
        logger.info(`[CDPBridge] Detached from tab ${tabId}`);
        resolve();
      });
    });
  }

  isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  // ── Command Sending ───────────────────────────────────────────────────────

  /**
   * Send a typed CDP command to a tab.
   * Automatically attaches the debugger if not already attached.
   */
  async send<T = unknown>(tabId: number, method: string, params: object = {}): Promise<T> {
    await this.attach(tabId);
    return new Promise<T>((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message ?? `CDP error: ${method}`;
          logger.error(`[CDPBridge] Command failed — ${method}:`, err);
          reject(new Error(err));
        } else {
          resolve(result as T);
        }
      });
    });
  }

  // ── Domain: Accessibility ─────────────────────────────────────────────────

  /**
   * Fetch the full semantic accessibility tree for a tab.
   * Pierces Shadow DOM and resolves ARIA roles automatically.
   * Produces ~10x fewer tokens than raw DOM serialization.
   */
  async getFullAXTree(tabId: number): Promise<AXNode[]> {
    await this.send(tabId, 'Accessibility.enable');
    const result = await this.send<{ nodes: AXNode[] }>(tabId, 'Accessibility.getFullAXTree');
    logger.debug(`[CDPBridge] AXTree fetched — ${result.nodes.length} nodes for tab ${tabId}`);
    return result.nodes;
  }

  // ── Domain: DOM ───────────────────────────────────────────────────────────

  /**
   * Get the bounding box of a DOM node by its backendNodeId.
   * Returns center coordinates for click targeting.
   */
  async getBoxModel(tabId: number, backendNodeId: number): Promise<BoxModel | null> {
    try {
      const result = await this.send<{ model: RawBoxModel }>(tabId, 'DOM.getBoxModel', { backendNodeId });
      const c = result.model.content;
      // content is [x1,y1, x2,y2, x3,y3, x4,y4] (quad)
      return {
        x: (c[0] + c[4]) / 2,
        y: (c[1] + c[5]) / 2,
        width: Math.abs(c[2] - c[0]),
        height: Math.abs(c[5] - c[1]),
        left: c[0],
        top: c[1],
      };
    } catch {
      // Element may be off-screen or display:none
      return null;
    }
  }

  // ── Domain: Input ─────────────────────────────────────────────────────────

  /**
   * Synthesize a real OS-level mouse click at exact pixel coordinates.
   * Bypasses SPA event interception that breaks JS .click().
   */
  async cdpClick(tabId: number, x: number, y: number): Promise<void> {
    logger.debug(`[CDPBridge] CDP click at (${x}, ${y}) on tab ${tabId}`);
    // Move
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    // Press
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    // Release
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  /**
   * Type text into the currently focused element using CDP Input.insertText.
   * More reliable than character-by-character key simulation for most fields.
   */
  async cdpInsertText(tabId: number, text: string): Promise<void> {
    logger.debug(`[CDPBridge] CDP insertText on tab ${tabId}: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`);
    await this.send(tabId, 'Input.insertText', { text });
  }

  /**
   * Dispatch a key event (e.g. Enter, Escape, Tab) via CDP.
   */
  async cdpKeyPress(tabId: number, key: string): Promise<void> {
    logger.debug(`[CDPBridge] CDP key "${key}" on tab ${tabId}`);
    await this.send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key, windowsVirtualKeyCode: KEY_CODES[key] ?? 0 });
    await this.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: KEY_CODES[key] ?? 0 });
  }

  // ── Domain: Runtime ──────────────────────────────────────────────────

  /**
   * Evaluate a JS expression in the page context via CDP Runtime.
   * Supports async expressions, user gestures, any execution context.
   */
  async evaluate<T = unknown>(tabId: number, expression: string, returnByValue = true): Promise<T | null> {
    try {
      const result = await this.send<{
        result: { value?: T; type: string };
        exceptionDetails?: { text: string };
      }>(tabId, 'Runtime.evaluate', { expression, returnByValue, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) {
        logger.error(`[CDPBridge] Runtime.evaluate exception: ${result.exceptionDetails.text}`);
        return null;
      }
      return result.result.value as T ?? null;
    } catch (err) {
      logger.error('[CDPBridge] Runtime.evaluate failed:', err);
      return null;
    }
  }

  // ── Domain: Page ────────────────────────────────────────────────────────

  /**
   * Capture a full-page screenshot (beyond viewport) via CDP Page.captureScreenshot.
   * Returns base64-encoded image. More powerful than chrome.tabs.captureVisibleTab.
   */
  async captureFullPageScreenshot(tabId: number, format: 'jpeg' | 'png' = 'jpeg', quality = 80): Promise<string | null> {
    try {
      const result = await this.send<{ data: string }>(tabId, 'Page.captureScreenshot', {
        format, quality: format === 'jpeg' ? quality : undefined,
        captureBeyondViewport: true, fromSurface: true,
      });
      logger.debug(`[CDPBridge] Full-page screenshot (${result.data.length} chars base64)`);
      return result.data;
    } catch (err) {
      logger.error('[CDPBridge] Page.captureScreenshot failed:', err);
      return null;
    }
  }

  /** Capture a clipped region (coordinates in page space, beyond viewport). */
  async captureClippedScreenshot(
    tabId: number,
    clip: { x: number; y: number; width: number; height: number; scale?: number },
    format: 'jpeg' | 'png' = 'jpeg',
  ): Promise<string | null> {
    try {
      const result = await this.send<{ data: string }>(tabId, 'Page.captureScreenshot', {
        format, clip: { ...clip, scale: clip.scale ?? 1 }, captureBeyondViewport: true,
      });
      return result.data;
    } catch (err) {
      logger.error('[CDPBridge] Clipped screenshot failed:', err);
      return null;
    }
  }

  /** Get the full frame tree (main frame + iframes with metadata). */
  async getPageFrameTree(tabId: number): Promise<unknown> {
    return this.send(tabId, 'Page.getFrameTree');
  }

  // ── Domain: DOM Utilities ───────────────────────────────────────────────

  /** Query the DOM for nodes matching a CSS selector via CDP DOM.querySelectorAll. */
  async searchDOM(tabId: number, selector: string): Promise<number[]> {
    try {
      await this.send(tabId, 'DOM.enable');
      const { root } = await this.send<{ root: { nodeId: number } }>(tabId, 'DOM.getDocument', { depth: 0 });
      const result = await this.send<{ nodeIds: number[] }>(tabId, 'DOM.querySelectorAll', { nodeId: root.nodeId, selector });
      logger.debug(`[CDPBridge] querySelectorAll "${selector}" → ${result.nodeIds.length} nodes`);
      return result.nodeIds;
    } catch (err) {
      logger.error('[CDPBridge] DOM.querySelectorAll failed:', err);
      return [];
    }
  }

  /** Directly set a DOM attribute on a nodeId (bypasses JS event handlers). */
  async setDOMAttribute(tabId: number, nodeId: number, name: string, value: string): Promise<void> {
    await this.send(tabId, 'DOM.setAttributeValue', { nodeId, name, value });
    logger.debug(`[CDPBridge] setAttributeValue [${nodeId}] ${name}="${value}"`);
  }

  /** Scroll an element into the viewport by its backendNodeId. */
  async scrollIntoView(tabId: number, backendNodeId: number): Promise<void> {
    await this.send(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId });
  }

  // ── Domain: Emulation ───────────────────────────────────────────────────

  /** Override geolocation. latitude/longitude in decimal degrees, accuracy in meters. */
  async overrideGeolocation(tabId: number, latitude: number, longitude: number, accuracy = 10): Promise<void> {
    logger.info(`[CDPBridge] Geolocation override → (${latitude}, ${longitude}) ±${accuracy}m`);
    await this.send(tabId, 'Emulation.setGeolocationOverride', { latitude, longitude, accuracy });
  }

  async clearGeolocationOverride(tabId: number): Promise<void> {
    await this.send(tabId, 'Emulation.clearGeolocationOverride');
  }

  /** Override timezone. timezoneId is an IANA string e.g. 'America/New_York'. */
  async overrideTimezone(tabId: number, timezoneId: string): Promise<void> {
    logger.info(`[CDPBridge] Timezone override → ${timezoneId}`);
    await this.send(tabId, 'Emulation.setTimezoneOverride', { timezoneId });
  }

  /** Emulate a mobile device (viewport + UA + scale). */
  async emulateMobileDevice(
    tabId: number,
    width = 390, height = 844,
    userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    deviceScaleFactor = 3,
  ): Promise<void> {
    await this.send(tabId, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: true });
    await this.send(tabId, 'Emulation.setUserAgentOverride', { userAgent });
    logger.info(`[CDPBridge] Mobile emulation: ${width}×${height}`);
  }

  async clearDeviceEmulation(tabId: number): Promise<void> {
    await this.send(tabId, 'Emulation.clearDeviceMetricsOverride');
  }

  // ── Domain: Storage ────────────────────────────────────────────────────────

  /** Clear all storage for an origin (cookies, localStorage, IndexedDB, sessionStorage). */
  async clearOriginStorage(tabId: number, origin: string, storageTypes = 'cookies,local_storage,indexeddb,session_storage'): Promise<void> {
    logger.info(`[CDPBridge] Clearing storage: ${origin} [${storageTypes}]`);
    await this.send(tabId, 'Storage.clearDataForOrigin', { origin, storageTypes });
  }

  // ── Domain: Security ────────────────────────────────────────────────────

  /** Bypass SSL certificate errors. WARNING: only use for trusted internal sites. */
  async bypassSSLErrors(tabId: number, ignore = true): Promise<void> {
    logger.warning(`[CDPBridge] SSL bypass: ${ignore} on tab ${tabId}`);
    await this.send(tabId, 'Security.setIgnoreCertificateErrors', { ignore });
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: string };
  disabled?: { type: string; value: boolean };
  focused?: { type: string; value: boolean };
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
}

export interface BoxModel {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
}

interface RawBoxModel {
  content: number[];
  padding: number[];
  border: number[];
  margin: number[];
  width: number;
  height: number;
}

/** Common virtual key codes for CDP Input.dispatchKeyEvent */
const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Backspace: 8,
  Delete: 46,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Space: 32,
};

/** Singleton instance — share across the extension */
export const cdpBridge = new CDPBridge();

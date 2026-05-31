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

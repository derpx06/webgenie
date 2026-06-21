/**
 * Tab Event Bridge
 *
 * The SINGLE source of truth for all Chrome tab lifecycle event listeners.
 *
 * Design principles:
 * - Registers all chrome.tabs.* listeners exactly ONCE (singleton).
 * - Debounces noisy `onUpdated` events (50ms window) to prevent storms.
 * - Normalizes raw Chrome events into typed `TabEvent` objects.
 * - Dispatches events to internal subscribers via a simple callback map.
 * - `dispose()` cleanly removes ALL listeners — no dangling refs.
 *
 * Usage:
 *   const bridge = TabEventBridge.getInstance();
 *   const unsub = bridge.subscribe('tab_updated', handler);
 *   // later:
 *   unsub();
 *   bridge.dispose(); // on extension unload
 */

import type { IBrowserAdapter } from '../../adapters/IBrowserAdapter';
import { ChromeBrowserAdapter } from '../../adapters/ChromeBrowserAdapter';
import { createLogger } from '../../log';

const logger = createLogger('EventBridge');

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type TabEventType =
  | 'tab_created'
  | 'tab_updated'
  | 'tab_removed'
  | 'tab_activated'
  | 'tab_moved'
  | 'window_focus_changed';

export interface TabCreatedEvent { type: 'tab_created'; tab: chrome.tabs.Tab }
export interface TabUpdatedEvent { type: 'tab_updated'; tabId: number; changeInfo: chrome.tabs.TabChangeInfo; tab: chrome.tabs.Tab }
export interface TabRemovedEvent { type: 'tab_removed'; tabId: number; removeInfo: chrome.tabs.TabRemoveInfo }
export interface TabActivatedEvent { type: 'tab_activated'; activeInfo: chrome.tabs.TabActiveInfo }
export interface TabMovedEvent { type: 'tab_moved'; tabId: number; moveInfo: chrome.tabs.TabMoveInfo }
export interface WindowFocusChangedEvent { type: 'window_focus_changed'; windowId: number }

export type TabEvent =
  | TabCreatedEvent
  | TabUpdatedEvent
  | TabRemovedEvent
  | TabActivatedEvent
  | TabMovedEvent
  | WindowFocusChangedEvent;

type TabEventHandler<T extends TabEvent = TabEvent> = (event: T) => void;

// ---------------------------------------------------------------------------
// Subscriber registry
// ---------------------------------------------------------------------------

type SubscriberMap = {
  [K in TabEventType]: Set<TabEventHandler>;
};

function createEmptySubscriberMap(): SubscriberMap {
  return {
    tab_created: new Set(),
    tab_updated: new Set(),
    tab_removed: new Set(),
    tab_activated: new Set(),
    tab_moved: new Set(),
    window_focus_changed: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Debounce helper (avoids importing lodash — keeps bundle lean)
// ---------------------------------------------------------------------------

function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

// ---------------------------------------------------------------------------
// TabEventBridge singleton
// ---------------------------------------------------------------------------

export class TabEventBridge {
  private static _instance: TabEventBridge | null = null;

  private _subscribers: SubscriberMap = createEmptySubscriberMap();
  private _disposed = false;
  private readonly _adapter: IBrowserAdapter;

  // Bound Chrome listener references — needed to removeListener cleanly
  private readonly _onCreated: (tab: chrome.tabs.Tab) => void;
  private readonly _onUpdated: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
  private readonly _onRemoved: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void;
  private readonly _onActivated: (activeInfo: chrome.tabs.TabActiveInfo) => void;
  private readonly _onMoved: (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => void;
  private readonly _onWindowFocusChanged: (windowId: number) => void;

  private constructor(adapter?: IBrowserAdapter) {
    this._adapter = adapter || new ChromeBrowserAdapter();

    // Debounce onUpdated at 50ms to prevent tab-update storms.
    // Status transitions (loading → complete) fire many times per navigation.
    const debouncedUpdate = debounce(
      (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
        this._dispatch<TabUpdatedEvent>('tab_updated', { type: 'tab_updated', tabId, changeInfo, tab });
      },
      50,
    );

    this._onCreated = (tab) => {
      this._dispatch<TabCreatedEvent>('tab_created', { type: 'tab_created', tab });
    };

    this._onUpdated = (tabId, changeInfo, tab) => {
      // Always immediately dispatch status=complete (important for page-load gating)
      if (changeInfo.status === 'complete') {
        this._dispatch<TabUpdatedEvent>('tab_updated', { type: 'tab_updated', tabId, changeInfo, tab });
      } else {
        debouncedUpdate(tabId, changeInfo, tab);
      }
    };

    this._onRemoved = (tabId, removeInfo) => {
      this._dispatch<TabRemovedEvent>('tab_removed', { type: 'tab_removed', tabId, removeInfo });
    };

    this._onActivated = (activeInfo) => {
      this._dispatch<TabActivatedEvent>('tab_activated', { type: 'tab_activated', activeInfo });
    };

    this._onMoved = (tabId, moveInfo) => {
      this._dispatch<TabMovedEvent>('tab_moved', { type: 'tab_moved', tabId, moveInfo });
    };

    this._onWindowFocusChanged = (windowId) => {
      // For now, assuming WINDOW_ID_NONE = -1 which is Chrome's default
      if (windowId !== -1) {
        this._dispatch<WindowFocusChangedEvent>('window_focus_changed', { type: 'window_focus_changed', windowId });
      }
    };

    // Register all listeners exactly once
    this._adapter.addTabCreatedListener(this._onCreated);
    this._adapter.addTabUpdatedListener(this._onUpdated);
    this._adapter.addTabRemovedListener(this._onRemoved);
    this._adapter.addTabActivatedListener(this._onActivated);
    this._adapter.addTabMovedListener(this._onMoved);
    this._adapter.addWindowFocusChangedListener(this._onWindowFocusChanged);

    logger.info('TabEventBridge: listeners registered');
  }

  /** Get or create the singleton instance. */
  static getInstance(adapter?: IBrowserAdapter): TabEventBridge {
    if (!TabEventBridge._instance) {
      TabEventBridge._instance = new TabEventBridge(adapter);
    }
    return TabEventBridge._instance;
  }

  /**
   * Subscribe to a tab event type.
   * @returns Unsubscribe function — call it to stop receiving events.
   */
  subscribe<T extends TabEvent = TabEvent>(
    eventType: TabEventType,
    handler: TabEventHandler<T>,
  ): () => void {
    if (this._disposed) {
      logger.warning('TabEventBridge: subscribe called after dispose — ignored');
      return () => {};
    }
    // Cast: handler<T> is assignable to handler<TabEvent> at the call site
    (this._subscribers[eventType] as Set<TabEventHandler>).add(handler as TabEventHandler);

    return () => {
      (this._subscribers[eventType] as Set<TabEventHandler>).delete(handler as TabEventHandler);
    };
  }

  /**
   * Dispatch an event to all registered subscribers.
   * Errors in individual handlers are caught and logged to prevent cascade failures.
   */
  private _dispatch<T extends TabEvent>(eventType: TabEventType, event: T): void {
    if (this._disposed) return;
    const handlers = this._subscribers[eventType] as Set<TabEventHandler<T>>;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        logger.error(`TabEventBridge: handler error for ${eventType}:`, err);
      }
    }
  }

  /**
   * Remove all listeners and clear all subscribers.
   * Call on extension unload or when the background service worker is being torn down.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._adapter.removeTabCreatedListener(this._onCreated);
    this._adapter.removeTabUpdatedListener(this._onUpdated);
    this._adapter.removeTabRemovedListener(this._onRemoved);
    this._adapter.removeTabActivatedListener(this._onActivated);
    this._adapter.removeTabMovedListener(this._onMoved);
    this._adapter.removeWindowFocusChangedListener(this._onWindowFocusChanged);

    for (const key of Object.keys(this._subscribers) as TabEventType[]) {
      this._subscribers[key].clear();
    }

    TabEventBridge._instance = null;
    logger.info('TabEventBridge: disposed');
  }
}

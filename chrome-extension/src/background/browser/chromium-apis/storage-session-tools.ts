/**
 * StorageSessionTools — chrome.storage.session API integration toolkit
 *
 * Provides ephemeral, session-scoped agent memory that:
 *   - Survives service worker restarts (unlike in-memory JS variables)
 *   - Clears automatically when the browser closes (unlike storage.local)
 *   - Has up to 10MB capacity
 *   - Is faster than storage.local (no disk I/O)
 *
 * Perfect for storing agent state between steps:
 *   - Task history / memory pyramid
 *   - Selector cache (which selectors worked on which domains)
 *   - Failure registry (which elements have been blocked)
 *   - Agent scratchpad / working notes
 *
 * Permissions required: "storage" ✅ (already in manifest)
 *
 * STATUS: Standalone tool — not yet wired into the agent pipeline.
 */

import { createLogger } from '@src/background/log';

const logger = createLogger('StorageSessionTools');

// ── Core Get/Set/Remove ───────────────────────────────────────────────────────

/**
 * Store a value in session storage under a typed key.
 * Value must be JSON-serializable.
 */
export async function sessionSet<T>(key: string, value: T): Promise<void> {
  logger.debug(`[StorageSession] set "${key}"`);
  await chrome.storage.session.set({ [key]: value });
}

/**
 * Retrieve a value from session storage.
 * Returns undefined if the key does not exist.
 */
export async function sessionGet<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.session.get(key);
  return result[key] as T | undefined;
}

/**
 * Retrieve a value with a fallback default if not set.
 */
export async function sessionGetOrDefault<T>(key: string, defaultValue: T): Promise<T> {
  const result = await chrome.storage.session.get(key);
  return (result[key] as T) ?? defaultValue;
}

/**
 * Remove one or more keys from session storage.
 */
export async function sessionRemove(keys: string | string[]): Promise<void> {
  logger.debug(`[StorageSession] remove "${Array.isArray(keys) ? keys.join(', ') : keys}"`);
  await chrome.storage.session.remove(keys);
}

/**
 * Clear all session storage.
 */
export async function sessionClear(): Promise<void> {
  logger.info('[StorageSession] Clearing all session storage');
  await chrome.storage.session.clear();
}

/**
 * Get all keys currently stored in session storage.
 */
export async function sessionGetAllKeys(): Promise<string[]> {
  const all = await chrome.storage.session.get(null);
  return Object.keys(all);
}

// ── Agent Memory Namespaced Helpers ───────────────────────────────────────────

/**
 * Create a namespaced session store for a specific agent task.
 * Prevents key collisions between concurrent tasks.
 *
 * @example
 * const store = createTaskStore('task_abc123');
 * await store.set('currentUrl', 'https://example.com');
 * await store.set('failedSelectors', ['button#submit', 'input.email']);
 * const url = await store.get<string>('currentUrl');
 */
export function createTaskStore(taskId: string) {
  const prefix = `task:${taskId}:`;

  return {
    async set<T>(key: string, value: T): Promise<void> {
      await sessionSet(`${prefix}${key}`, value);
    },

    async get<T>(key: string): Promise<T | undefined> {
      return sessionGet<T>(`${prefix}${key}`);
    },

    async getOrDefault<T>(key: string, defaultValue: T): Promise<T> {
      return sessionGetOrDefault<T>(`${prefix}${key}`, defaultValue);
    },

    async remove(key: string): Promise<void> {
      await sessionRemove(`${prefix}${key}`);
    },

    async clear(): Promise<void> {
      const all = await chrome.storage.session.get(null);
      const keys = Object.keys(all).filter(k => k.startsWith(prefix));
      if (keys.length) await chrome.storage.session.remove(keys);
      logger.info(`[StorageSession] Cleared task store for ${taskId} (${keys.length} keys)`);
    },
  };
}

// ── Selector Cache ────────────────────────────────────────────────────────────

const SELECTOR_CACHE_KEY = 'agent:selectorCache';

interface SelectorCacheEntry {
  selector: string;
  domain: string;
  successCount: number;
  failCount: number;
  lastSeen: number;
}

/**
 * Record that a selector worked successfully on a domain.
 * Builds a cross-session (within browser session) selector reliability cache.
 */
export async function recordSelectorSuccess(domain: string, selector: string): Promise<void> {
  const cache = await sessionGetOrDefault<Record<string, SelectorCacheEntry>>(SELECTOR_CACHE_KEY, {});
  const key = `${domain}::${selector}`;
  const entry = cache[key] ?? { selector, domain, successCount: 0, failCount: 0, lastSeen: 0 };
  entry.successCount++;
  entry.lastSeen = Date.now();
  cache[key] = entry;
  await sessionSet(SELECTOR_CACHE_KEY, cache);
}

/**
 * Record that a selector failed on a domain.
 */
export async function recordSelectorFailure(domain: string, selector: string): Promise<void> {
  const cache = await sessionGetOrDefault<Record<string, SelectorCacheEntry>>(SELECTOR_CACHE_KEY, {});
  const key = `${domain}::${selector}`;
  const entry = cache[key] ?? { selector, domain, successCount: 0, failCount: 0, lastSeen: 0 };
  entry.failCount++;
  entry.lastSeen = Date.now();
  cache[key] = entry;
  await sessionSet(SELECTOR_CACHE_KEY, cache);
}

/**
 * Get reliability score for a selector on a domain (0–1, higher = more reliable).
 * Returns 0.5 (neutral) if the selector has never been seen.
 */
export async function getSelectorReliability(domain: string, selector: string): Promise<number> {
  const cache = await sessionGetOrDefault<Record<string, SelectorCacheEntry>>(SELECTOR_CACHE_KEY, {});
  const entry = cache[`${domain}::${selector}`];
  if (!entry) return 0.5;
  const total = entry.successCount + entry.failCount;
  if (total === 0) return 0.5;
  return entry.successCount / total;
}

// ── Agent Scratchpad ──────────────────────────────────────────────────────────

const SCRATCHPAD_KEY = 'agent:scratchpad';

/**
 * Write a note to the agent's in-memory scratchpad.
 * Survives service worker restarts — lost when browser closes.
 */
export async function writeScratchpad(taskId: string, note: string): Promise<void> {
  const pad = await sessionGetOrDefault<Record<string, string[]>>(SCRATCHPAD_KEY, {});
  if (!pad[taskId]) pad[taskId] = [];
  pad[taskId].push(`[${new Date().toISOString()}] ${note}`);
  await sessionSet(SCRATCHPAD_KEY, pad);
}

/**
 * Read all scratchpad notes for a task.
 */
export async function readScratchpad(taskId: string): Promise<string[]> {
  const pad = await sessionGetOrDefault<Record<string, string[]>>(SCRATCHPAD_KEY, {});
  return pad[taskId] ?? [];
}

/**
 * Clear scratchpad for a task.
 */
export async function clearScratchpad(taskId: string): Promise<void> {
  const pad = await sessionGetOrDefault<Record<string, string[]>>(SCRATCHPAD_KEY, {});
  delete pad[taskId];
  await sessionSet(SCRATCHPAD_KEY, pad);
}

// ── Access Level ──────────────────────────────────────────────────────────────

/**
 * Allow content scripts to read/write session storage.
 * Call this from the service worker if content scripts need session data.
 * Default is TRUSTED_CONTEXTS only (service worker + extension pages).
 */
export async function allowContentScriptAccess(): Promise<void> {
  await chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
  });
  logger.info('[StorageSession] Content scripts now have session storage access');
}

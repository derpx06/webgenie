/**
 * Tab Reuse Engine
 *
 * Before the agent opens a new tab, consult this engine to see if an
 * existing tab can be reused. This prevents:
 *   - Duplicate tabs for the same URL
 *   - Tab explosions during research tasks
 *   - AI losing context by abandoning useful existing sessions
 *
 * Matching priority (highest to lowest):
 *   1. Exact URL match within the same task
 *   2. Same domain, same taskId
 *   3. Same domain, IDLE/COMPLETE state (recyclable)
 *
 * The engine respects tab state — it will never suggest a PRIMARY_ACTIVE
 * tab as reusable (that would interrupt the current operation).
 */

import { createLogger } from '../../log';
import type { TabRegistry } from '../tab-registry/registry';
import { TabState } from '@extension/storage';
import type { TabRecord } from '@extension/storage';

const logger = createLogger('TabReuseEngine');

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip hash fragments and trailing slashes for comparison
    return `${u.protocol}//${u.hostname}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// ReuseCandidate
// ---------------------------------------------------------------------------

export interface ReuseCandidate {
  tabId: number;
  record: TabRecord;
  matchType: 'exact_url' | 'same_domain_same_task' | 'same_domain_recyclable';
  score: number; // 0–1 confidence
}

// ---------------------------------------------------------------------------
// TabReuseEngine
// ---------------------------------------------------------------------------

const REUSABLE_STATES: Set<TabState> = new Set([
  TabState.IDLE,
  TabState.COMPLETE,
  TabState.WAITING,
]);

/** States that should NEVER be reused (actively being used or in error). */
const NON_REUSABLE_STATES: Set<TabState> = new Set([
  TabState.PRIMARY_ACTIVE,
  TabState.BACKGROUND_ACTIVE,
  TabState.ERROR,
]);

export class TabReuseEngine {
  private readonly _registry: TabRegistry;

  constructor(registry: TabRegistry) {
    this._registry = registry;
  }

  /**
   * Find the best reusable tab for navigating to `url` in the context of `taskId`.
   *
   * @param url - The URL the agent wants to open
   * @param taskId - The current task session ID
   * @returns The best reuse candidate, or null if no suitable tab exists
   */
  findReusable(url: string, taskId: string): ReuseCandidate | null {
    const normalizedUrl = normalizeUrl(url);
    const targetDomain = extractDomain(url);
    const allTabs = this._registry.getAll();

    const candidates: ReuseCandidate[] = [];

    for (const record of allTabs) {
      // Never reuse tabs that are currently actively used
      if (NON_REUSABLE_STATES.has(record.state)) continue;

      const tabNorm = normalizeUrl(record.url);
      const tabDomain = extractDomain(record.url);

      // Priority 1: Exact URL, same task
      if (tabNorm === normalizedUrl && record.taskId === taskId) {
        candidates.push({
          tabId: record.tabId,
          record,
          matchType: 'exact_url',
          score: 1.0,
        });
        continue;
      }

      // Priority 2: Exact URL, any task (still very good — same page state)
      if (tabNorm === normalizedUrl && REUSABLE_STATES.has(record.state)) {
        candidates.push({
          tabId: record.tabId,
          record,
          matchType: 'exact_url',
          score: 0.9,
        });
        continue;
      }

      // Priority 3: Same domain, same task
      if (tabDomain === targetDomain && tabDomain !== '' && record.taskId === taskId) {
        candidates.push({
          tabId: record.tabId,
          record,
          matchType: 'same_domain_same_task',
          score: 0.7,
        });
        continue;
      }

      // Priority 4: Same domain, idle/complete (recyclable)
      if (tabDomain === targetDomain && tabDomain !== '' && REUSABLE_STATES.has(record.state)) {
        candidates.push({
          tabId: record.tabId,
          record,
          matchType: 'same_domain_recyclable',
          score: 0.5,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Sort by score descending, then by most recently updated (prefer fresh tabs)
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.record.updatedAt - a.record.updatedAt;
    });

    const best = candidates[0];
    logger.info(
      `TabReuseEngine: found reusable tab ${best.tabId} for ${url} ` +
      `(type=${best.matchType}, score=${best.score})`
    );
    return best;
  }

  /**
   * Check if a URL would be a duplicate of any currently active tab.
   * Used to prevent redundant navigation actions.
   */
  isDuplicate(url: string): boolean {
    const normalizedUrl = normalizeUrl(url);
    return this._registry.getAll().some(
      r => normalizeUrl(r.url) === normalizedUrl && r.state === TabState.PRIMARY_ACTIVE
    );
  }
}

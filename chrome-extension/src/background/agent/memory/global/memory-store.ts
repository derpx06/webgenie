import { createLogger } from '../../../log';
import type { SelectorAnchor, EpisodicNote, DomainRecord } from './types';

const logger = createLogger('MemoryStore');

// ─── Scoring Utilities ────────────────────────────────────────────────────────

/**
 * Extracts content-bearing keywords from an intent string.
 * Strips stop words and short tokens to keep only meaningful terms.
 */
export function extractKeywords(text: string): Set<string> {
  const STOP = new Set([
    'a','an','the','and','or','of','in','on','to','for','with',
    'this','that','is','it','be','do','go','get','set','use',
    'click','button','link','input','select','open','close','find',
    'please','then','now','next','back','up','down',
  ]);
  return new Set(
    text.toLowerCase()
      .split(/[\W_]+/)
      .filter(w => w.length > 2 && !STOP.has(w)),
  );
}

/**
 * Keyword intersection similarity score: |A ∩ B| / |A ∪ B|.
 * Returns 0–1. Returns 0 when no shared keywords (intent mismatch).
 */
export function intentSimilarity(a: string, b: string): number {
  const kwA = extractKeywords(a);
  const kwB = extractKeywords(b);
  if (kwA.size === 0 || kwB.size === 0) return 0;
  let intersection = 0;
  for (const kw of kwA) if (kwB.has(kw)) intersection++;
  const union = new Set([...kwA, ...kwB]).size;
  return intersection / union;
}

/**
 * Time-decay factor: recent notes score 1.0, notes from >30 days ago score 0.5.
 * Uses an exponential decay with 15-day half-life.
 */
export function timeDecayFactor(timestamp: number): number {
  const daysSince = (Date.now() - timestamp) / 86400000;
  return Math.max(0.5, Math.exp(-daysSince / 21.7)); // half-life ≈ 15 days
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const KEYS = {
  SELECTORS: 'wg_mem:selectors',
  EPISODES:  'wg_mem:episodes',
  DOMAINS:   'wg_mem:domains',
} as const;

// ─── Capacity Limits ─────────────────────────────────────────────────────────

const MAX_SELECTORS = 2000;  // ~400KB at avg 200 bytes/entry
const MAX_EPISODES  = 200;   // ~100KB at avg 500 bytes/entry

// ─────────────────────────────────────────────────────────────────────────────

export class WebGenieMemoryStore {

  // ── Selector Anchor Store ──────────────────────────────────────────────────

  /**
   * Records a verified successful element interaction.
   * Scoped to domain + pagePath + layoutHash so stale anchors from
   * layout changes or different pages are never surfaced.
   *
   * Eviction strategy: remove lowest-rated anchors first (not naive FIFO),
   * so high-value, high-successRating anchors survive longest.
   */
  static async learnSelector(
    domain: string,
    pagePath: string,
    layoutHash: string,
    intent: string,
    selector: string,
    xpath: string,
  ): Promise<void> {
    try {
      const data = await chrome.storage.local.get(KEYS.SELECTORS);
      const cache: SelectorAnchor[] = data[KEYS.SELECTORS] || [];

      const intentKey = intent.toLowerCase().trim();
      const idx = cache.findIndex(
        e => e.domain === domain &&
             e.pagePath === pagePath &&
             e.layoutHash === layoutHash &&
             e.intentKey === intentKey &&
             e.selector === selector,
      );

      if (idx > -1) {
        cache[idx].successRating += 1;
        cache[idx].lastUsedTimestamp = Date.now();
      } else {
        cache.push({
          domain,
          pagePath,
          layoutHash,
          intentKey,
          selector,
          xpath,
          successRating: 1,
          lastUsedTimestamp: Date.now(),
        });
      }

      // Smart LRU eviction: lowest rating + oldest timestamp evicted first
      if (cache.length > MAX_SELECTORS) {
        cache.sort(
          (a, b) => a.successRating - b.successRating ||
                    a.lastUsedTimestamp - b.lastUsedTimestamp,
        );
        cache.splice(0, cache.length - MAX_SELECTORS);
      }

      await chrome.storage.local.set({ [KEYS.SELECTORS]: cache });
      logger.info(
        `Learned selector | intent="${intentKey}" domain="${domain}" path="${pagePath}" ` +
        `rating=${idx > -1 ? cache.find(e => e.selector === selector)?.successRating : 1}`,
      );
    } catch (err) {
      logger.error('learnSelector failed:', err);
    }
  }

  /**
   * Recalls proven anchors for this domain + pagePath + layoutHash.
   *
   * Threshold: successRating >= 2 (proven twice, not a fluke).
   * Returns top-10 by rating desc to cap prompt injection size.
   * Returns empty array when layout fingerprint has changed (stale = silent drop).
   */
  static async recallSelectors(
    domain: string,
    pagePath: string,
    layoutHash: string,
  ): Promise<SelectorAnchor[]> {
    try {
      const data = await chrome.storage.local.get(KEYS.SELECTORS);
      const cache: SelectorAnchor[] = data[KEYS.SELECTORS] || [];
      return cache
        .filter(
          e => e.domain === domain &&
               e.pagePath === pagePath &&
               e.layoutHash === layoutHash &&
               e.successRating >= 2,
        )
        .sort((a, b) => b.successRating - a.successRating)
        .slice(0, 10);
    } catch (err) {
      logger.error('recallSelectors failed:', err);
      return [];
    }
  }

  // ── Episodic Note Store ────────────────────────────────────────────────────

  /**
   * Creates or updates an episodic note for a completed task.
   * Returns the note's UUID for subsequent A-MEM linking.
   *
   * Eviction: removes lowest-successCount notes first (not FIFO),
   * so frequently-successful knowledge is never lost.
   */
  static async saveEpisodicNote(
    domain: string,
    pagePath: string,
    intent: string,
    outcomeSteps: string,
  ): Promise<string> {
    try {
      const data = await chrome.storage.local.get(KEYS.EPISODES);
      const episodes: EpisodicNote[] = data[KEYS.EPISODES] || [];

      const cleanIntent = intent.toLowerCase().trim().slice(0, 200);
      const idx = episodes.findIndex(
        e => e.domain === domain && e.pagePath === pagePath && e.intent === cleanIntent,
      );

      let noteId: string;

      if (idx > -1) {
        episodes[idx].successCount += 1;
        episodes[idx].outcomeSteps = outcomeSteps;
        episodes[idx].timestamp = Date.now();
        noteId = episodes[idx].id;
      } else {
        noteId = crypto.randomUUID();
        episodes.push({
          id: noteId,
          domain,
          pagePath,
          intent: cleanIntent,
          outcomeSteps,
          successCount: 1,
          linkedNoteIds: [],
          timestamp: Date.now(),
        });
      }

      // Smart eviction: remove lowest successCount first
      if (episodes.length > MAX_EPISODES) {
        episodes.sort(
          (a, b) => a.successCount - b.successCount || a.timestamp - b.timestamp,
        );
        episodes.splice(0, episodes.length - MAX_EPISODES);
      }

      await chrome.storage.local.set({ [KEYS.EPISODES]: episodes });
      logger.info(`Saved episodic note id="${noteId}" intent="${cleanIntent}" domain="${domain}" path="${pagePath}"`);
      return noteId;
    } catch (err) {
      logger.error('saveEpisodicNote failed:', err);
      return '';
    }
  }

  /**
   * Links episodic notes together bidirectionally (A-MEM Zettelkasten).
   * Both the source note and each related note get each other's ID,
   * building an undirected knowledge graph for multi-hop reasoning.
   */
  static async linkEpisodicNotes(noteId: string, relatedIds: string[]): Promise<void> {
    if (!noteId || relatedIds.length === 0) return;
    try {
      const data = await chrome.storage.local.get(KEYS.EPISODES);
      const episodes: EpisodicNote[] = data[KEYS.EPISODES] || [];

      for (const episode of episodes) {
        if (episode.id === noteId) {
          for (const rid of relatedIds) {
            if (!episode.linkedNoteIds.includes(rid)) {
              episode.linkedNoteIds.push(rid);
            }
          }
        }
        if (relatedIds.includes(episode.id)) {
          if (!episode.linkedNoteIds.includes(noteId)) {
            episode.linkedNoteIds.push(noteId);
          }
        }
      }

      await chrome.storage.local.set({ [KEYS.EPISODES]: episodes });
      logger.info(`Linked note "${noteId}" to ${relatedIds.length} related notes`);
    } catch (err) {
      logger.error('linkEpisodicNotes failed:', err);
    }
  }

  /**
   * Recalls the top-N most successful episodic notes for a domain.
   * Prefers pagePath-scoped results; falls back to domain-wide if none found.
   * Sorted by successCount desc so the most proven knowledge comes first.
   */
  static async recallEpisodicNotes(
    domain: string,
    topN = 2,
    pagePath?: string,
  ): Promise<EpisodicNote[]> {
    try {
      const data = await chrome.storage.local.get(KEYS.EPISODES);
      const episodes: EpisodicNote[] = data[KEYS.EPISODES] || [];
      return episodes
        .filter(e => {
          if (e.domain !== domain) return false;
          if (pagePath) return e.pagePath === pagePath;
          return true;
        })
        .sort((a, b) => b.successCount - a.successCount || b.timestamp - a.timestamp)
        .slice(0, topN);
    } catch (err) {
      logger.error('recallEpisodicNotes failed:', err);
      return [];
    }
  }

  /**
   * Intent-matched episodic recall with composite scoring.
   *
   * Score = successCount × timeDecay(timestamp) × (1 + intentSimilarity(current, note))
   *
   * This surfaces notes that are both frequently-proven AND semantically related
   * to the current goal, replacing naive domain-wide recall.
   */
  static async recallByIntent(
    domain: string,
    currentIntent: string,
    topN = 2,
    pagePath?: string,
  ): Promise<EpisodicNote[]> {
    try {
      const data = await chrome.storage.local.get(KEYS.EPISODES);
      const episodes: EpisodicNote[] = data[KEYS.EPISODES] || [];

      const candidates = episodes.filter(e => {
        if (e.domain !== domain) return false;
        if (pagePath) return e.pagePath === pagePath;
        return true;
      });

      if (candidates.length === 0) return [];

      const scored = candidates.map(note => {
        const decay = timeDecayFactor(note.timestamp);
        const sim = intentSimilarity(currentIntent, note.intent);
        return { note, score: note.successCount * decay * (1 + sim) };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topN).map(s => s.note);
    } catch (err) {
      logger.error('recallByIntent failed:', err);
      return [];
    }
  }

  // ── Domain KV Store ────────────────────────────────────────────────────────

  /**
   * Saves or updates per-domain cross-session intelligence.
   * `totalSuccessfulTasks` is always incremented (never overwritten).
   */
  static async saveDomainRecord(
    domain: string,
    update: Partial<Omit<DomainRecord, 'domain' | 'totalSuccessfulTasks'>>,
    incrementTasks = false,
  ): Promise<void> {
    try {
      const data = await chrome.storage.local.get(KEYS.DOMAINS);
      const domains: DomainRecord[] = data[KEYS.DOMAINS] || [];

      const idx = domains.findIndex(d => d.domain === domain);
      if (idx > -1) {
        Object.assign(domains[idx], update, { lastVisited: Date.now() });
        if (incrementTasks) domains[idx].totalSuccessfulTasks += 1;
      } else {
        domains.push({
          domain,
          lastVisited: Date.now(),
          layoutFingerprint: update.layoutFingerprint || '',
          knownPanels: update.knownPanels || [],
          totalSuccessfulTasks: incrementTasks ? 1 : 0,
        });
      }

      await chrome.storage.local.set({ [KEYS.DOMAINS]: domains });
    } catch (err) {
      logger.error('saveDomainRecord failed:', err);
    }
  }

  /**
   * Retrieves the domain intelligence record for a domain.
   * Returns null if this domain has never been seen before.
   */
  static async recallDomainRecord(domain: string): Promise<DomainRecord | null> {
    try {
      const data = await chrome.storage.local.get(KEYS.DOMAINS);
      const domains: DomainRecord[] = data[KEYS.DOMAINS] || [];
      return domains.find(d => d.domain === domain) || null;
    } catch (err) {
      logger.error('recallDomainRecord failed:', err);
      return null;
    }
  }
}

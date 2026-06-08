import { createLogger } from '../../../log';
import type { DOMState } from '../../../browser/dom/views';
import { WebGenieMemoryStore, intentSimilarity, timeDecayFactor } from './memory-store';

const logger = createLogger('ContextRouter');

export class ContextRouter {

  // ── Layout Fingerprinting ──────────────────────────────────────────────────

  /**
   * Generates a stable layout fingerprint from DOM branch path hashes + URL path.
   *
   * Including the URL path in the fingerprint is critical for page-path scoping:
   * mail.google.com/compose and mail.google.com/inbox produce DIFFERENT fingerprints
   * even if they share some DOM structure, preventing cross-page cache pollution.
   * Research ref: goated_memory_architecture.md §Risk 5.
   */
  static async computeLayoutFingerprint(state: DOMState, url?: string): Promise<string> {
    const hashes: string[] = [];
    for (const element of state.selectorMap.values()) {
      try {
        const h = await element.hash();
        if (h.branchPathHash) {
          hashes.push(h.branchPathHash);
        }
      } catch {
        // Skip individual element hash errors
      }
    }
    hashes.sort();

    // Seed the hash with the URL path so identical DOM on different pages
    // produces different fingerprints (page-path isolation)
    let hashVal = 0;
    if (url) {
      try {
        const path = new URL(url).pathname + new URL(url).hash;
        for (let i = 0; i < path.length; i++) {
          hashVal = (hashVal << 5) - hashVal + path.charCodeAt(i);
          hashVal = hashVal & hashVal;
        }
      } catch { /* ignore malformed URLs */ }
    }

    const hashStr = hashes.join(',');
    for (let i = 0; i < hashStr.length; i++) {
      const char = hashStr.charCodeAt(i);
      hashVal = (hashVal << 5) - hashVal + char;
      hashVal = hashVal & hashVal;
    }
    return `layout_${Math.abs(hashVal).toString(36)}`;
  }

  /**
   * Extracts the URL page-path key (pathname + hash, capped at 100 chars).
   * Used to scope selector anchors and episodic notes to the exact sub-page.
   */
  static getPagePath(url: string): string {
    try {
      const u = new URL(url);
      return (u.pathname + u.hash).slice(0, 100);
    } catch {
      return '/';
    }
  }

  // ── Domain Session Priming ─────────────────────────────────────────────────

  /**
   * Generates a domain briefing block for known domains.
   *
   * On the first step of a task on a known domain, injects this as an INIT
   * message so the Navigator LLM immediately knows the site context, reducing
   * wasted orientation steps.
   *
   * Research ref: browser_agent_research_pt3.md §Dream Agent — Domain KV Store.
   */
  static async primeDomainContext(domain: string): Promise<string> {
    const record = await WebGenieMemoryStore.recallDomainRecord(domain);
    if (!record) return '';

    const daysSince = Math.round((Date.now() - record.lastVisited) / 86400000);
    const timeLabel = daysSince === 0 ? 'today' : `${daysSince}d ago`;
    const panels = record.knownPanels.length > 0
      ? `Known UI panels: ${record.knownPanels.join(', ')}.`
      : '';

    return (
      `[Domain Intelligence] You have successfully completed ${record.totalSuccessfulTasks} ` +
      `task(s) on ${domain} (last visit: ${timeLabel}). ` +
      `${panels} Use this knowledge to orient yourself faster.\n`
    );
  }

  // ── Selector Hint Injection (JIT) ─────────────────────────────────────────

  /**
   * Recalls proven selector anchors for this domain + pagePath + layoutHash
   * and formats them as actionable 💡 FAST PATH hints for the Navigator LLM.
   *
   * Format upgraded from informational to directive:
   *   "💡 FAST PATH: To [intent], use xpath `...` (proven Nx, last used Xd ago)"
   *
   * This tells the LLM to use these FIRST before scanning the DOM —
   * matching Stagehand's ActCache "fast path / slow path" pattern.
   *
   * Returns empty string when no proven anchors exist (zero degradation).
   * Research ref: goated_memory_architecture.md §Component 5,
   *               browser_agent_research_pt3.md §6 (Cache as Procedural Memory).
   */
  static async getSelectorHints(
    domain: string,
    pagePath: string,
    layoutHash: string,
  ): Promise<string> {
    const anchors = await WebGenieMemoryStore.recallSelectors(domain, pagePath, layoutHash);
    if (anchors.length === 0) return '';

    let hints = '[Selector Memory — FAST PATH hints, try these FIRST before DOM scanning]:\n';
    for (const anchor of anchors) {
      const daysSince = Math.round((Date.now() - anchor.lastUsedTimestamp) / 86400000);
      const timeLabel = daysSince === 0 ? 'today' : `${daysSince}d ago`;
      hints +=
        `💡 FAST PATH: To "${anchor.intentKey}", ` +
        `use xpath \`${anchor.xpath}\` ` +
        `(selector: \`${anchor.selector}\`, proven ${anchor.successRating}x, last: ${timeLabel})\n`;
    }
    return hints + '\n';
  }

  // ── Episodic Context Injection (JIT) ──────────────────────────────────────

  /**
   * Retrieves top-2 intent-matched past sessions and formats them as a
   * concise context block the Navigator LLM can use to orient itself faster.
   *
   * Uses intent-matched recall (recallByIntent) instead of naive domain-wide
   * recall — only surfaces past sessions that share keywords with the current
   * goal. Prevents "noisy recall" where unrelated sessions pollute context.
   *
   * Strategy:
   * 1. Try pagePath-scoped + intent-matched (tightest relevance)
   * 2. Fall back to domain-wide intent-matched
   * 3. Return empty string if domain is completely new (zero degradation)
   *
   * Research ref: A-MEM §3.2 relevance scoring, SOTA 2025/2026 spreading activation.
   */
  static async getEpisodicContext(
    domain: string,
    currentIntent?: string,
    pagePath?: string,
  ): Promise<string> {
    const intent = currentIntent || '';

    // Try page-path scoped with intent matching first
    let notes = await WebGenieMemoryStore.recallByIntent(domain, intent, 2, pagePath);
    // Fall back to domain-wide intent-matched
    if (notes.length === 0) {
      notes = await WebGenieMemoryStore.recallByIntent(domain, intent, 2);
    }
    if (notes.length === 0) return '';

    let context = '[Past Sessions — proven routes for this domain, follow these if page structure matches]:\n';
    for (const note of notes) {
      const daysSince = Math.round((Date.now() - note.timestamp) / 86400000);
      const timeLabel = daysSince === 0 ? 'today' : `${daysSince}d ago`;
      // Show intent-similarity to help LLM judge relevance
      const sim = intent ? intentSimilarity(intent, note.intent) : 0;
      const relevanceLabel = sim > 0.5 ? '🔥 high match' : sim > 0 ? 'partial match' : 'domain context';
      context +=
        `- [${relevanceLabel}] Task: "${note.intent}" | succeeded ${note.successCount}x | ${timeLabel}\n` +
        `  Route: ${note.outcomeSteps}\n`;
    }
    return context + '\n';
  }

  // ── Post-Task Consolidation ────────────────────────────────────────────────

  /**
   * Full A-MEM consolidation after a task completes successfully.
   *
   * Pipeline:
   * 1. Save episodic note (pagePath-scoped, compressed outcome summary)
   * 2. Link to related past notes from same domain (A-MEM Zettelkasten graph)
   * 3. Update domain KV record with latest fingerprint + increment task count
   *
   * This is the "learning" step that makes the agent smarter after every task.
   * Research ref: goated_memory_architecture.md §Component 2, memory_implementation_phases.md §Phase 5.
   */
  static async consolidateAfterTask(
    domain: string,
    pagePath: string,
    layoutHash: string,
    taskGoal: string,
    finalAnswer: string,
    stepCount: number,
  ): Promise<void> {
    try {
      // Build a compressed 3-line outcome summary
      const outcomeSteps =
        `Completed in ${stepCount} steps. ` +
        `Goal: "${taskGoal.slice(0, 120)}". ` +
        `Result: ${(finalAnswer || 'done').slice(0, 150)}`;

      // 1. Save / update the episodic note
      const noteId = await WebGenieMemoryStore.saveEpisodicNote(
        domain,
        pagePath,
        taskGoal,
        outcomeSteps,
      );

      // 2. A-MEM: link to existing notes from the same domain (Zettelkasten graph)
      if (noteId) {
        const existingNotes = await WebGenieMemoryStore.recallEpisodicNotes(domain, 5);
        const relatedIds = existingNotes
          .filter(n => n.id !== noteId)
          .filter(n => intentSimilarity(taskGoal, n.intent) > 0) // only link related notes
          .map(n => n.id);
        if (relatedIds.length > 0) {
          await WebGenieMemoryStore.linkEpisodicNotes(noteId, relatedIds);
          logger.info(`A-MEM: linked note "${noteId}" to ${relatedIds.length} related notes`);
        }
      }

      // 3. Update domain KV record
      await WebGenieMemoryStore.saveDomainRecord(
        domain,
        { layoutFingerprint: layoutHash },
        /* incrementTasks= */ true,
      );

      logger.info(
        `Consolidation complete | domain="${domain}" path="${pagePath}" ` +
        `goal="${taskGoal.slice(0, 50)}" steps=${stepCount}`,
      );
    } catch (err) {
      logger.error('consolidateAfterTask failed:', err);
    }
  }

  // ── DOM Attention Masking ──────────────────────────────────────────────────

  /**
   * Masks elements in the DOMState tree based on keywords from the active goal.
   * Keeps at least 25 elements as a safety floor (no contextual starvation).
   * Research ref: goated_memory_architecture.md §Component 3, §Risk 1.
   */
  static applyAttentionMask(state: DOMState, goal: string | undefined): void {
    if (!goal || goal.trim() === '') return;

    const interactiveElements = Array.from(state.selectorMap.values());
    if (interactiveElements.length <= 25) {
      logger.info(`DOM has ${interactiveElements.length} elements ≤ 25. Skipping mask.`);
      return;
    }

    const stopWords = new Set([
      'and', 'the', 'for', 'with', 'this', 'that', 'your',
      'please', 'click', 'button', 'link', 'input', 'select',
    ]);
    const keywords = goal
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    if (keywords.length === 0) {
      logger.info('No keywords extracted from goal. Skipping mask.');
      return;
    }

    logger.info(`DOM attention mask | keywords: [${keywords.join(', ')}]`);

    const scoredElements = interactiveElements.map(el => {
      let score = 0;
      const attrText = Object.entries(el.attributes)
        .map(([k, v]) => `${k} ${v}`)
        .join(' ')
        .toLowerCase();
      const tagName = (el.tagName || '').toLowerCase();
      const nodeText = el.getAllTextTillNextClickableElement().toLowerCase();

      for (const kw of keywords) {
        if (tagName.includes(kw))  score += 0.5;
        if (attrText.includes(kw)) score += 1.0;
        if (nodeText.includes(kw)) score += 1.0;
      }
      return { element: el, score };
    });

    const relevantCount = scoredElements.filter(se => se.score > 0).length;
    if (relevantCount < 15) {
      logger.info(`Only ${relevantCount} elements scored > 0 (< 15 threshold). Keeping full DOM.`);
      return;
    }

    scoredElements.sort((a, b) => b.score - a.score);

    const keepSet = new Set<number>();
    for (let i = 0; i < Math.min(25, scoredElements.length); i++) {
      const idx = scoredElements[i].element.highlightIndex;
      if (idx !== null) keepSet.add(idx);
    }
    for (let i = 25; i < scoredElements.length; i++) {
      const idx = scoredElements[i].element.highlightIndex;
      if (scoredElements[i].score > 0 && idx !== null) keepSet.add(idx);
    }

    let maskedCount = 0;
    for (const el of interactiveElements) {
      if (el.highlightIndex !== null && !keepSet.has(el.highlightIndex)) {
        el.highlightIndex = null;
        maskedCount++;
      }
    }

    logger.info(`Attention mask complete: masked ${maskedCount}/${interactiveElements.length} elements.`);
  }
}

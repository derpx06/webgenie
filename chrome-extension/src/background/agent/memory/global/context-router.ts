import { createLogger } from '../../../log';
import { WebGenieMemoryStore, intentSimilarity } from './memory-store';

const logger = createLogger('ContextRouter');

/** Masks tokens that carry personal or task-specific values: anything with a digit or an @.
 * ponytail: names without digits stay; drop episodic text entirely if they leak too. */
export const withoutValues = (text: string): string => text.replace(/\S*[\d@]\S*/g, '…');

export class ContextRouter {

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
      // A past task's answer and its values (phone numbers, addresses, emails, amounts) belong to that task; shown
      // here they were reused as if the user had given them. Keep only what the route was.
      const route = note.outcomeSteps.replace(/\s*Result:[\s\S]*$/, '');
      context +=
        `- [${relevanceLabel}] Task: "${withoutValues(note.intent)}" | succeeded ${note.successCount}x | ${timeLabel}\n` +
        `  Route: ${withoutValues(route)}\n`;
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
}

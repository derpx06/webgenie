/**
 * SelectorHealer — Fuzzy Semantic Element Recovery
 *
 * Provides zero-cost (no LLM), sub-millisecond element recovery when exact
 * selector matching fails after SPA re-renders or DOM mutations.
 *
 * Strategy: Priority-ranked attribute scoring based on stability:
 *   1. data-testid / data-cy / data-test  — intentionally developer-exposed
 *   2. aria-label / aria-description       — semantic, rarely changes
 *   3. placeholder / id / name             — stable but can be dynamic
 *   4. Exact textContent match             — reliable for short labels
 *   5. Fuzzy role + textContent prefix     — last resort
 *
 * Used by:
 *   - page.ts → clickElementNode() Tier 2 recovery
 *   - history/service.ts → findHistoryElementInTree() Phase C recovery
 */

import type { DOMElementNode } from './views';
import type { DOMHistoryElement } from './history/view';

/** Result of a healing attempt, including score and diagnostic metadata. */
export interface HealCandidate {
  node: DOMElementNode;
  score: number;
  /** Human-readable list of attributes that contributed to the score. */
  matchedBy: string[];
}

// ── Scoring weights ──────────────────────────────────────────────────────────

const WEIGHTS = {
  tagName: 0.20,
  role: 0.20,
  dataTestId: 0.50,    // bonus: most stable
  dataCy: 0.50,
  dataTest: 0.50,
  ariaLabel: 0.35,
  ariaDescription: 0.25,
  placeholder: 0.20,
  id: 0.20,
  name: 0.15,
  exactText: 0.30,
  prefixText: 0.12,    // first 8 chars of textContent
} as const;

/**
 * Default minimum confidence threshold.
 * Scores below this are not considered safe heals.
 */
export const DEFAULT_HEAL_THRESHOLD = 0.75;

/**
 * Low-confidence threshold: healing is returned but logged as a WARNING.
 * Callers may choose to accept or reject these.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.50;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score all candidates in the current selectorMap against a target history element.
 * Returns the best match above the threshold, or null.
 *
 * @param target     - The historical element we are trying to re-locate.
 * @param candidates - The current live selectorMap from getState().
 * @param threshold  - Minimum score to be considered a valid heal (default 0.75).
 */
export function healElement(
  target: DOMHistoryElement,
  candidates: Map<number, DOMElementNode>,
  threshold = DEFAULT_HEAL_THRESHOLD,
): HealCandidate | null {
  let best: HealCandidate | null = null;

  for (const node of candidates.values()) {
    const result = scoreCandidate(target, node);
    if (result.score >= threshold) {
      if (!best || result.score > best.score) {
        best = result;
      }
    }
  }

  return best;
}

/**
 * Score a single candidate node against the target history element.
 * Exposed for unit testing and diagnostic logging.
 */
export function scoreCandidate(
  target: DOMHistoryElement,
  candidate: DOMElementNode,
): HealCandidate {
  let score = 0;
  const matchedBy: string[] = [];

  const tAttrs = target.attributes ?? {};
  const cAttrs = candidate.attributes ?? {};

  // ── Tag name ──────────────────────────────────────────────────────────────
  const tTag = target.tagName?.toLowerCase() ?? '';
  const cTag = candidate.tagName?.toLowerCase() ?? '';
  if (tTag && cTag && tTag === cTag) {
    score += WEIGHTS.tagName;
    matchedBy.push('tagName');
  }

  // ── ARIA role ─────────────────────────────────────────────────────────────
  const tRole = tAttrs['role'] ?? '';
  const cRole = cAttrs['role'] ?? '';
  if (tRole && cRole && tRole === cRole) {
    score += WEIGHTS.role;
    matchedBy.push('role');
  }

  // ── Stable test attributes (high-value bonus) ─────────────────────────────
  if (attrMatch(tAttrs, cAttrs, 'data-testid')) {
    score += WEIGHTS.dataTestId;
    matchedBy.push('data-testid');
  }
  if (attrMatch(tAttrs, cAttrs, 'data-cy')) {
    score += WEIGHTS.dataCy;
    matchedBy.push('data-cy');
  }
  if (attrMatch(tAttrs, cAttrs, 'data-test')) {
    score += WEIGHTS.dataTest;
    matchedBy.push('data-test');
  }

  // ── Accessibility attributes ──────────────────────────────────────────────
  if (attrMatch(tAttrs, cAttrs, 'aria-label')) {
    score += WEIGHTS.ariaLabel;
    matchedBy.push('aria-label');
  }
  if (attrMatch(tAttrs, cAttrs, 'aria-description')) {
    score += WEIGHTS.ariaDescription;
    matchedBy.push('aria-description');
  }
  if (attrMatch(tAttrs, cAttrs, 'placeholder')) {
    score += WEIGHTS.placeholder;
    matchedBy.push('placeholder');
  }

  // ── Identity attributes ───────────────────────────────────────────────────
  if (attrMatch(tAttrs, cAttrs, 'id')) {
    score += WEIGHTS.id;
    matchedBy.push('id');
  }
  if (attrMatch(tAttrs, cAttrs, 'name')) {
    score += WEIGHTS.name;
    matchedBy.push('name');
  }

  // ── Text content matching ─────────────────────────────────────────────────
  // We reconstruct target text from xpath label heuristic using tagName
  // The live candidate exposes text via getAllTextTillNextClickableElement()
  const candidateText = candidate.getAllTextTillNextClickableElement(2).trim();
  const targetAriaLabel = (tAttrs['aria-label'] ?? '').trim();

  // Exact text match against aria-label (common pattern for buttons)
  if (
    targetAriaLabel &&
    candidateText &&
    candidateText.length <= 80 &&
    candidateText.toLowerCase() === targetAriaLabel.toLowerCase()
  ) {
    score += WEIGHTS.exactText;
    matchedBy.push('exactText(ariaLabel≈text)');
  }

  // Prefix text match (≥8 chars reduces false positives)
  if (
    targetAriaLabel &&
    candidateText &&
    targetAriaLabel.length >= 8 &&
    candidateText.toLowerCase().startsWith(targetAriaLabel.substring(0, 8).toLowerCase())
  ) {
    score += WEIGHTS.prefixText;
    matchedBy.push('prefixText');
  }

  // Cap at 1.0 (multiple bonuses could exceed it)
  score = Math.min(score, 1.0);

  return { node: candidate, score, matchedBy };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function attrMatch(
  a: Record<string, string>,
  b: Record<string, string>,
  key: string,
): boolean {
  const av = (a[key] ?? '').trim();
  const bv = (b[key] ?? '').trim();
  return av.length > 0 && bv.length > 0 && av === bv;
}

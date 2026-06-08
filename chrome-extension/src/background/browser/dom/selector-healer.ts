import { DOMElementNode } from './views';
import { DOMHistoryElement } from './history/view';

export interface HealCandidate {
  node: DOMElementNode;
  score: number;
  matchedBy: string[];
}

/**
 * Compare a target element (from history or previous observation) with a candidate DOMElementNode.
 * Returns a score between 0.0 and 1.0.
 */
export function calculateSimilarityScore(
  targetAttributes: Record<string, string>,
  targetTagName: string,
  candidate: DOMElementNode
): { score: number; matchedBy: string[] } {
  let score = 0;
  const matchedBy: string[] = [];

  const targetTag = (targetTagName || '').toLowerCase();
  const candidateTag = (candidate.tagName || '').toLowerCase();

  // 1. Tag name matching (15%)
  if (targetTag && candidateTag && targetTag === candidateTag) {
    score += 0.15;
    matchedBy.push('tagName');
  }

  // 2. Role matching (15%)
  const targetRole = targetAttributes['role'] || '';
  const candidateRole = candidate.attributes['role'] || '';
  if (targetRole && candidateRole && targetRole.toLowerCase() === candidateRole.toLowerCase()) {
    score += 0.15;
    matchedBy.push('role');
  }

  // 3. Stable developer test IDs (30%)
  const testIdKeys = ['data-testid', 'data-cy', 'data-test', 'data-qa'];
  let testIdMatched = false;
  for (const key of testIdKeys) {
    const targetVal = targetAttributes[key];
    const candidateVal = candidate.attributes[key];
    if (targetVal && candidateVal && targetVal === candidateVal) {
      score += 0.30;
      matchedBy.push(key);
      testIdMatched = true;
      break;
    }
  }

  // 4. ARIA label and placeholder / title / name semantic attributes (25%)
  const semanticKeys = ['aria-label', 'aria-description', 'placeholder', 'title', 'name'];
  for (const key of semanticKeys) {
    const targetVal = targetAttributes[key];
    const candidateVal = candidate.attributes[key];
    if (targetVal && candidateVal) {
      if (targetVal === candidateVal) {
        score += 0.15;
        matchedBy.push(key);
      } else if (
        targetVal.toLowerCase().includes(candidateVal.toLowerCase()) ||
        candidateVal.toLowerCase().includes(targetVal.toLowerCase())
      ) {
        score += 0.08;
        matchedBy.push(`${key}-fuzzy`);
      }
    }
  }

  // 5. Standard ID matching (15%)
  const targetId = targetAttributes['id'];
  const candidateId = candidate.attributes['id'];
  if (targetId && candidateId && targetId === candidateId) {
    // If it's not a dynamic looking ID (e.g. contains random numbers or generated hashes)
    const isDynamic = /(?:-\d+|\d{4,})/.test(targetId);
    if (!isDynamic) {
      score += 0.15;
      matchedBy.push('id');
    } else {
      score += 0.05;
      matchedBy.push('id-dynamic');
    }
  }

  // 6. Value, href or src matching (10%)
  const linkKeys = ['href', 'src', 'value'];
  for (const key of linkKeys) {
    const targetVal = targetAttributes[key];
    const candidateVal = candidate.attributes[key];
    if (targetVal && candidateVal && targetVal === candidateVal) {
      score += 0.10;
      matchedBy.push(key);
      break;
    }
  }

  return { score: Math.min(1.0, score), matchedBy };
}

/**
 * Searches the array of candidate DOMElementNodes to find the best match for the target element.
 */
export function healElement(
  target: DOMHistoryElement | DOMElementNode,
  candidates: DOMElementNode[],
  threshold = 0.60
): HealCandidate | null {
  const targetAttributes = target.attributes || {};
  const targetTagName = target.tagName || '';

  let bestCandidate: DOMElementNode | null = null;
  let bestScore = 0;
  let bestMatches: string[] = [];

  for (const candidate of candidates) {
    const { score, matchedBy } = calculateSimilarityScore(targetAttributes, targetTagName, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
      bestMatches = matchedBy;
    }
  }

  if (bestCandidate && bestScore >= threshold) {
    return {
      node: bestCandidate,
      score: bestScore,
      matchedBy: bestMatches,
    };
  }

  return null;
}

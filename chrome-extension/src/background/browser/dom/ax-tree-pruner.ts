/**
 * AXTreePruner — Token Reduction Layer (V2)
 *
 * Post-processes an AXTree-derived DOMState before it is serialized into the
 * LLM prompt. Target: ≤600 tokens per typical page vs 2,000–8,000 tokens with
 * raw DOM serialization.
 *
 * Rules applied bottom-up in a single tree walk:
 *   1. Hidden node removal    — non-visible nodes with no interactive descendants
 *   2. Container collapsing   — marks single-child non-interactive wrappers
 *   3. Text truncation        — aria-label / placeholder / title capped at 80 chars
 *   4. Deduplication          — siblings with identical role + aria-label de-duped
 *   5. Semantic relevance     — filters off-screen nodes by user goal keywords
 */

import { DOMElementNode, DOMTextNode, type DOMBaseNode, type DOMState } from './views';
import { createLogger } from '@src/background/log';

const logger = createLogger('AXTreePruner');

/** Roles that are purely presentational — safe to remove when they have no interactive descendants. */
const PRESENTATIONAL_ROLES = new Set([
  'none', 'presentation', 'generic', 'group',
  'separator', 'figure', 'region',
]);

/** Text-bearing attributes to truncate. */
const TEXT_ATTRS = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt', 'value'];
const MAX_TEXT_LENGTH = 80;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'this', 'that', 'is', 'it', 'be',
  'do', 'go', 'get', 'set', 'use', 'click', 'button', 'link', 'input', 'select', 'open', 'close',
  'find', 'please', 'then', 'now', 'next', 'back', 'up', 'down', 'from', 'to', 'at', 'by', 'show',
  'me', 'please', 'web', 'page', 'site', 'website', 'search', 'query', 'url'
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Prune an AXTree DOMState in-place and return it with a reduced node count.
 * Safe to call on snapshot-derived states too — rules degrade gracefully when
 * AX metadata is absent.
 */
export function pruneAXTree(state: DOMState, goal?: string): DOMState {
  const before = state.selectorMap.size;

  pruneNode(state.elementTree, goal);
  rebuildSelectorMap(state);

  logger.debug(`[AXTreePruner] ${before} → ${state.selectorMap.size} interactive nodes after pruning`);
  return state;
}

// ── Private ───────────────────────────────────────────────────────────────────

/**
 * Recursively prune a node bottom-up.
 * Returns true if the node should be kept, false if it should be discarded.
 */
function pruneNode(node: DOMElementNode, goal?: string): boolean {
  // Rule 3: Truncate text attributes before any other processing
  for (const attr of TEXT_ATTRS) {
    const val = node.attributes[attr];
    if (val && val.length > MAX_TEXT_LENGTH) {
      node.attributes[attr] = `${val.substring(0, MAX_TEXT_LENGTH)}…`;
    }
  }

  // Recurse into children first (bottom-up)
  const keptChildren: DOMElementNode['children'] = [];
  for (const child of node.children) {
    if (child instanceof DOMElementNode) {
      if (pruneNode(child, goal)) keptChildren.push(child);
      // child returning false → discarded
    } else if (child instanceof DOMTextNode) {
      if (child.text.trim().length > 0) keptChildren.push(child);
    }
  }
  node.children = keptChildren;

  // Rule 5: Goal-directed semantic pruning for off-screen interactive elements.
  // IMPORTANT: Only prune when pageCoordinates are resolved — if coordinates are
  // undefined it means getBoxModel failed (e.g. CSP restrictions on Google Search),
  // and isInViewport=false is the uninitialised default, NOT a confirmed off-screen signal.
  // Pruning in that case would remove ALL elements and produce the "EMPTY PAGE" error.
  if (node.highlightIndex !== null && !node.isInViewport && node.pageCoordinates && goal) {
    const keywords = getKeywords(goal);
    const score = calculateRelevance(node, keywords);
    if (score < 0.3) {
      if (!hasInteractiveDescendant(node)) {
        return false;
      }
    }
  }

  // Rule 1: Remove non-visible nodes that carry no interactive descendants
  if (!node.isVisible && node.highlightIndex === null) {
    if (!hasInteractiveDescendant(node)) return false;
  }

  // Rule 1b: Purely presentational role with no interactive descendants
  const role = (node.attributes['role'] ?? '').toLowerCase();
  if (PRESENTATIONAL_ROLES.has(role) && node.highlightIndex === null) {
    if (!hasInteractiveDescendant(node)) return false;
  }

  // Rule 2: Mark single-child non-interactive container as collapsible
  // (the LLM serializer can skip this wrapper level for cleaner output)
  if (
    node.highlightIndex === null &&
    node.children.length === 1 &&
    node.children[0] instanceof DOMElementNode
  ) {
    node.attributes['_collapsible'] = 'true';
  }

  // Rule 4: Deduplicate children with identical role + aria-label
  deduplicateSiblings(node);

  return true;
}

/** Returns true if any descendant has a highlightIndex (is interactive). */
function hasInteractiveDescendant(node: DOMElementNode): boolean {
  for (const child of node.children) {
    if (child instanceof DOMElementNode) {
      if (child.highlightIndex !== null) return true;
      if (hasInteractiveDescendant(child)) return true;
    }
  }
  return false;
}

/**
 * Remove duplicate siblings — same role + same aria-label + no unique interactive children.
 * Keeps the first occurrence only.
 */
function deduplicateSiblings(parent: DOMElementNode): void {
  const seen = new Set<string>();
  const deduped: DOMElementNode['children'] = [];

  for (const child of parent.children) {
    if (child instanceof DOMElementNode) {
      const role = child.attributes['role'] ?? child.tagName ?? '';
      const label = child.attributes['aria-label'] ?? '';

      if (role && label) {
        const key = `${role}::${label}`;
        if (seen.has(key) && !hasInteractiveDescendant(child)) {
          continue; // skip duplicate
        }
        seen.add(key);
      }
      deduped.push(child);
    } else {
      deduped.push(child);
    }
  }

  parent.children = deduped;
}

/**
 * Rebuild the selectorMap by walking the pruned tree.
 * Preserves existing highlight indices (no re-numbering — stability within a step).
 */
function rebuildSelectorMap(state: DOMState): void {
  const newMap = new Map<number, DOMElementNode>();

  function walk(node: DOMElementNode): void {
    if (node.highlightIndex !== null) {
      newMap.set(node.highlightIndex, node);
    }
    for (const child of node.children) {
      if (child instanceof DOMElementNode) walk(child);
    }
  }

  walk(state.elementTree);
  state.selectorMap = newMap;
}

function getKeywords(text: string): Set<string> {
  const words = text.toLowerCase().split(/[\W_]+/);
  return new Set(words.filter(w => w.length > 2 && !STOP_WORDS.has(w)));
}

function collectAllText(node: DOMElementNode): string {
  const textParts: string[] = [];
  function walk(n: DOMBaseNode) {
    if (n instanceof DOMTextNode) {
      textParts.push(n.text);
    } else if (n instanceof DOMElementNode) {
      for (const child of n.children) {
        walk(child);
      }
    }
  }
  walk(node);
  return textParts.join(' ');
}

function calculateRelevance(node: DOMElementNode, keywords: Set<string>): number {
  if (keywords.size === 0) return 1.0;

  let matchCount = 0;
  const innerText = collectAllText(node);
  let attrsText = '';
  for (const [key, val] of Object.entries(node.attributes)) {
    attrsText += ` ${key}="${val}"`;
  }

  const textContent = (
    (node.tagName ?? '') + ' ' +
    attrsText + ' ' +
    innerText
  ).toLowerCase();

  for (const keyword of keywords) {
    if (textContent.includes(keyword)) {
      matchCount++;
    }
  }

  return matchCount / keywords.size;
}

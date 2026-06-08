/**
 * AXTreePruner — Token Reduction Layer
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
 */

import { DOMElementNode, DOMTextNode, type DOMState } from './views';
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Prune an AXTree DOMState in-place and return it with a reduced node count.
 * Safe to call on snapshot-derived states too — rules degrade gracefully when
 * AX metadata is absent.
 */
export function pruneAXTree(state: DOMState): DOMState {
  const before = state.selectorMap.size;

  pruneNode(state.elementTree);
  rebuildSelectorMap(state);

  logger.debug(`[AXTreePruner] ${before} → ${state.selectorMap.size} interactive nodes after pruning`);
  return state;
}

// ── Private ───────────────────────────────────────────────────────────────────

/**
 * Recursively prune a node bottom-up.
 * Returns true if the node should be kept, false if it should be discarded.
 */
function pruneNode(node: DOMElementNode): boolean {
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
      if (pruneNode(child)) keptChildren.push(child);
      // child returning false → discarded
    } else if (child instanceof DOMTextNode) {
      if (child.text.trim().length > 0) keptChildren.push(child);
    }
  }
  node.children = keptChildren;

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

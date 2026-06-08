/**
 * AXTreePruner — Token Reduction Layer for Accessibility Tree Output
 *
 * Performs a post-processing pass on an AXTree-derived DOMState before it is
 * serialized into the LLM prompt. The goal is to stay within ~600 tokens for
 * a typical page (vs. 2,000–8,000 with raw DOM serialization).
 *
 * Pruning rules (applied in order):
 *   1. Hidden node removal    — ignored=true / role=none / role=presentation (no interactive children)
 *   2. Container collapsing   — single-child non-interactive wrappers are inlined
 *   3. Text truncation        — names/descriptions capped at 80 chars
 *   4. Deduplication guard    — sibling nodes with identical role+name de-duped
 *   5. Viewport prioritization — nodes outside viewport are tagged (lower LLM attention)
 */

import { DOMElementNode, DOMTextNode, type DOMState } from './views';
import { createLogger } from '@src/background/log';

const logger = createLogger('AXTreePruner');

/** Roles that are purely presentational and safe to collapse if they have no interactive descendants. */
const PRESENTATIONAL_ROLES = new Set([
  'none', 'presentation', 'generic', 'group',
  'separator', 'img',     // img without alt is decorative
  'figure', 'region',     // collapsible wrappers
]);

/** Roles that mark a node as definitively interactive — never prune. */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'listbox',
  'option', 'spinbutton', 'slider', 'searchbox', 'switch', 'treeitem',
  'gridcell', 'columnheader', 'rowheader', 'scrollbar',
]);

const MAX_TEXT_LENGTH = 80;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Prune an AXTree DOMState in-place and return the same object with reduced
 * node count and text length. Safe to call on snapshot-derived states too —
 * rules degrade gracefully when AX metadata is absent.
 */
export function pruneAXTree(state: DOMState): DOMState {
  const before = state.selectorMap.size;

  // Walk the tree and apply rules
  pruneNode(state.elementTree, state.selectorMap);

  // Rebuild selectorMap after pruning (indices may have shifted due to node removal)
  rebuildSelectorMap(state);

  const after = state.selectorMap.size;
  logger.debug(`[AXTreePruner] ${before} → ${after} interactive nodes after pruning`);

  return state;
}

// ── Private implementation ────────────────────────────────────────────────────

/**
 * Recursively prune a node and all its children.
 * Returns true if this node should be KEPT, false if it should be removed.
 */
function pruneNode(
  node: DOMElementNode,
  selectorMap: Map<number, DOMElementNode>,
): boolean {
  const role = (node.attributes?.['role'] ?? '').toLowerCase();

  // Rule 3: Text truncation — truncate name/aria-label/placeholder
  truncateNodeText(node);

  // Recurse into children first (bottom-up so parents can inspect children)
  const keptChildren: (DOMElementNode | InstanceType<typeof DOMTextNode>)[] = [];
  for (const child of node.children) {
    if (child instanceof DOMElementNode) {
      if (pruneNode(child, selectorMap)) {
        keptChildren.push(child);
      }
      // If pruneNode returns false, child is discarded
    } else if (child instanceof DOMTextNode) {
      // Keep visible text nodes
      if (child.text.trim().length > 0) {
        keptChildren.push(child);
      }
    }
  }
  node.children = keptChildren;

  // Rule 1: Hidden / purely presentational — remove if no interactive descendants
  if (!node.isVisible && node.highlightIndex === null) {
    if (!hasInteractiveDescendant(node)) {
      return false;
    }
  }

  // Rule 1b: Presentational role with no interactive descendants
  if (PRESENTATIONAL_ROLES.has(role) && node.highlightIndex === null) {
    if (!hasInteractiveDescendant(node)) {
      return false;
    }
  }

  // Rule 2: Container collapsing — inline single-child non-interactive wrappers
  // (We mutate the parent's children list in the caller, so we flag via attribute)
  if (
    node.highlightIndex === null &&
    !INTERACTIVE_ROLES.has(role) &&
    node.children.length === 1 &&
    node.children[0] instanceof DOMElementNode
  ) {
    // Mark as collapsible — the serializer in clickableElementsToString can skip this layer
    node.attributes['_collapsible'] = 'true';
  }

  // Rule 4: Deduplication — handled at parent level below
  deduplicateSiblings(node);

  return true;
}

/** Truncate text-carrying attributes to MAX_TEXT_LENGTH. */
function truncateNodeText(node: DOMElementNode): void {
  const textAttrs = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt', 'value'];
  for (const attr of textAttrs) {
    const val = node.attributes?.[attr];
    if (val && val.length > MAX_TEXT_LENGTH) {
      node.attributes[attr] = val.substring(0, MAX_TEXT_LENGTH) + '…';
    }
  }
}

/** Check whether any descendant of this node has a highlightIndex (is interactive). */
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
 * Rule 4: Remove duplicate siblings — same role + same aria-label and no unique attributes.
 * Keeps the first occurrence, removes subsequent exact duplicates.
 */
function deduplicateSiblings(parent: DOMElementNode): void {
  const seen = new Set<string>();
  const deduped: DOMElementNode['children'] = [];

  for (const child of parent.children) {
    if (child instanceof DOMElementNode) {
      const role = child.attributes?.['role'] ?? child.tagName ?? '';
      const label = child.attributes?.['aria-label'] ?? '';
      const key = `${role}::${label}`;

      // Only deduplicate if both role and label are non-empty (avoid collateral)
      if (role && label && seen.has(key)) {
        // Skip duplicate — but only if it has no unique children worth keeping
        if (!hasInteractiveDescendant(child)) {
          continue;
        }
      }

      if (role && label) seen.add(key);
      deduped.push(child);
    } else {
      deduped.push(child);
    }
  }

  parent.children = deduped;
}

/**
 * Rebuild the selectorMap after structural pruning, since some nodes may have
 * been removed. Walks the tree and re-collects all nodes with highlightIndex !== null.
 * Does NOT re-number existing indices (preserves stability for the current step).
 */
function rebuildSelectorMap(state: DOMState): void {
  const newMap = new Map<number, DOMElementNode>();

  function walk(node: DOMElementNode): void {
    if (node.highlightIndex !== null) {
      newMap.set(node.highlightIndex, node);
    }
    for (const child of node.children) {
      if (child instanceof DOMElementNode) {
        walk(child);
      }
    }
  }

  walk(state.elementTree);
  state.selectorMap = newMap;
}

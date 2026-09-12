import { DOMElementNode, DOMTextNode, type DOMState } from './views';

/**
 * Shrinks an accessibility-derived tree before it is serialized: drops non-interactive nodes left with
 * no text or elements, marks single-child wrappers collapsible, and renumbers interactive nodes 0..n-1
 * in document order. Interactive nodes are never removed, and text is never truncated (typed values
 * must read back in full).
 */
export function pruneAXTree(state: DOMState): DOMState {
  pruneChildren(state.elementTree);

  const selectorMap = new Map<number, DOMElementNode>();
  const index = (node: DOMElementNode): void => {
    if (node.highlightIndex !== null) {
      node.highlightIndex = selectorMap.size;
      selectorMap.set(node.highlightIndex, node);
    }
    for (const child of node.children) {
      if (child instanceof DOMElementNode) index(child);
    }
  };
  index(state.elementTree);
  state.selectorMap = selectorMap;
  return state;
}

function pruneChildren(node: DOMElementNode): void {
  node.children = node.children.filter(child => {
    if (child instanceof DOMTextNode) return child.text.trim().length > 0;
    if (!(child instanceof DOMElementNode)) return false;
    pruneChildren(child);
    return child.highlightIndex !== null || child.children.length > 0;
  });
  if (node.highlightIndex === null && node.children.length === 1 && node.children[0] instanceof DOMElementNode) {
    node.attributes['_collapsible'] = 'true';
  }
}

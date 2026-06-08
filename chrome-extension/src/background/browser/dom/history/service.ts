import { DOMElementNode } from '../views';
import { DOMHistoryElement, HashedDomElement } from './view';

/**
 * Convert a DOM element to a history element
 */
export function convertDomElementToHistoryElement(domElement: DOMElementNode): DOMHistoryElement {
  const parentBranchPath = _getParentBranchPath(domElement);
  const cssSelector = domElement.getEnhancedCssSelector();
  return new DOMHistoryElement(
    domElement.tagName ?? '', // Provide empty string as fallback
    domElement.xpath ?? '', // Provide empty string as fallback
    domElement.highlightIndex ?? null,
    parentBranchPath,
    domElement.attributes,
    domElement.shadowRoot,
    cssSelector,
    domElement.pageCoordinates ?? null,
    domElement.viewportCoordinates ?? null,
    domElement.viewportInfo ?? null,
  );
}

import { healElement } from '../selector-healer';

/**
 * Find a history element in the DOM tree using a cascading match strategy
 */
export async function findHistoryElementInTree(
  domHistoryElement: DOMHistoryElement,
  tree: DOMElementNode,
): Promise<DOMElementNode | null> {
  // ── Phase A: Strict hash match ──────────────────────────────────────────────
  const hashedDomHistoryElement = await hashDomHistoryElement(domHistoryElement);

  const processNodeStrict = async (node: DOMElementNode): Promise<DOMElementNode | null> => {
    if (node.highlightIndex != null) {
      const hashedNode = await hashDomElement(node);
      if (
        hashedNode.branchPathHash === hashedDomHistoryElement.branchPathHash &&
        hashedNode.attributesHash === hashedDomHistoryElement.attributesHash &&
        hashedNode.xpathHash === hashedDomHistoryElement.xpathHash
      ) {
        return node;
      }
    }
    for (const child of node.children) {
      if (child instanceof DOMElementNode) {
        const result = await processNodeStrict(child);
        if (result !== null) {
          return result;
        }
      }
    }
    return null;
  };

  const strictResult = await processNodeStrict(tree);
  if (strictResult !== null) {
    return strictResult;
  }

  // ── Phase B: Attribute-only match (ignores XPath/branchPath drift) ───────────
  const processNodeAttributeOnly = async (node: DOMElementNode): Promise<DOMElementNode | null> => {
    if (node.highlightIndex != null) {
      const hashedNode = await hashDomElement(node);
      if (
        hashedNode.attributesHash === hashedDomHistoryElement.attributesHash &&
        (node.tagName || '').toLowerCase() === (domHistoryElement.tagName || '').toLowerCase()
      ) {
        return node;
      }
    }
    for (const child of node.children) {
      if (child instanceof DOMElementNode) {
        const result = await processNodeAttributeOnly(child);
        if (result !== null) {
          return result;
        }
      }
    }
    return null;
  };

  const attrResult = await processNodeAttributeOnly(tree);
  if (attrResult !== null) {
    return attrResult;
  }

  // ── Phase C: SelectorHealer semantic scoring ─────────────────────────────────
  const interactiveNodes: DOMElementNode[] = [];
  const collectInteractive = (node: DOMElementNode) => {
    if (node.highlightIndex != null) {
      interactiveNodes.push(node);
    }
    for (const child of node.children) {
      if (child instanceof DOMElementNode) {
        collectInteractive(child);
      }
    }
  };
  collectInteractive(tree);

  const healed = healElement(domHistoryElement, interactiveNodes, 0.60);
  if (healed) {
    return healed.node;
  }

  // ── Phase D: Failure ─────────────────────────────────────────────────────────
  return null;
}

/**
 * Hash a DOM history element
 */
async function hashDomHistoryElement(domHistoryElement: DOMHistoryElement): Promise<HashedDomElement> {
  const [branchPathHash, attributesHash, xpathHash] = await Promise.all([
    _parentBranchPathHash(domHistoryElement.entireParentBranchPath),
    _attributesHash(domHistoryElement.attributes),
    _xpathHash(domHistoryElement.xpath ?? ''),
  ]);
  return new HashedDomElement(branchPathHash, attributesHash, xpathHash);
}

/**
 * Hash a DOM element
 */
export async function hashDomElement(domElement: DOMElementNode): Promise<HashedDomElement> {
  const parentBranchPath = _getParentBranchPath(domElement);
  const [branchPathHash, attributesHash, xpathHash] = await Promise.all([
    _parentBranchPathHash(parentBranchPath),
    _attributesHash(domElement.attributes),
    _xpathHash(domElement.xpath ?? ''),
  ]);
  return new HashedDomElement(branchPathHash, attributesHash, xpathHash);
}

/**
 * Get the branch path from parent elements
 */
export function _getParentBranchPath(domElement: DOMElementNode): string[] {
  const parents: DOMElementNode[] = [];
  let currentElement: DOMElementNode = domElement;

  while (currentElement.parent != null) {
    parents.push(currentElement);
    currentElement = currentElement.parent;
  }

  parents.reverse();
  return parents.map(parent => parent.tagName ?? '');
}

/**
 * Create a hash from the parent branch path
 */
async function _parentBranchPathHash(parentBranchPath: string[]): Promise<string> {
  if (parentBranchPath.length === 0) return '';
  return _createSHA256Hash(parentBranchPath.join('/'));
}

/**
 * Create a hash from the element attributes
 */
async function _attributesHash(attributes: Record<string, string>): Promise<string> {
  const attributesString = Object.entries(attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join('');
  return _createSHA256Hash(attributesString);
}

/**
 * Create a hash from the element xpath
 */
async function _xpathHash(xpath: string): Promise<string> {
  return _createSHA256Hash(xpath);
}

/**
 * Create a SHA-256 hash from a string using Web Crypto API
 */
async function _createSHA256Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HistoryTreeProcessor namespace to keep same pattern as in python
 */
export const HistoryTreeProcessor = {
  convertDomElementToHistoryElement,
  findHistoryElementInTree,
  hashDomElement,
  _getParentBranchPath,
  _parentBranchPathHash,
  _attributesHash,
  _xpathHash,
};

import type { BrowserState } from '../../browser/views';
import { DOMElementNode, DOMTextNode } from '../../browser/dom/views';
import type { BrowserObservation, TargetFingerprint } from './types';

function stableHash(value: unknown): string {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function shortTextHash(text: string): string | undefined {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed ? stableHash(trimmed.slice(0, 200)) : undefined;
}

function nodeText(node: DOMElementNode, maxDepth = 2): string {
  const parts: string[] = [];
  const visit = (current: unknown, depth: number) => {
    if (depth > maxDepth) return;
    if (current instanceof DOMTextNode) {
      parts.push(current.text);
      return;
    }
    if (current instanceof DOMElementNode) {
      for (const child of current.children) visit(child, depth + 1);
    }
  };
  visit(node, 0);
  return parts.join(' ');
}

/** Each text node's text, in document order. */
function textFragments(root: DOMElementNode | undefined): string[] {
  const parts: string[] = [];
  const stack: unknown[] = root ? [root] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node instanceof DOMTextNode) {
      parts.push(node.text);
    } else if (node instanceof DOMElementNode) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
  }
  return parts;
}

/** All text in the tree, in document order. */
function pageText(root: DOMElementNode | undefined): string {
  return textFragments(root).join(' ');
}

/** A node's identity across reads of the same page: its frame and backend node id. */
export function elementKey(node: DOMElementNode): string | null {
  return node.backendNodeId === undefined ? null : `${node.frameKey ?? ''}:${node.backendNodeId}`;
}

/**
 * Interactive elements in `after` that `before` did not have: a menu that opened, suggestions, a dialog's buttons. Empty
 * without an earlier read or when `after` is another page (a new address or tab makes everything new).
 */
export function newElements(before: BrowserState | undefined, after: BrowserState): DOMElementNode[] {
  if (!before || before === after || before.url !== after.url || before.tabId !== after.tabId) return [];
  const known = new Set([...before.selectorMap.values()].map(elementKey));
  return [...after.selectorMap.values()].filter(node => {
    const key = elementKey(node);
    return key !== null && !known.has(key);
  });
}

/** All text of a page read, in document order. */
export function visibleText(state: BrowserState): string {
  return pageText(state.elementTree);
}

/**
 * Short text that is on the page after an action but was not before (an error, a confirmation, a status), at most
 * five pieces. Kept in the action's result, so a message that the next action removes is not lost.
 */
export function appearedText(before: BrowserState, after: BrowserState): string[] {
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const seen = new Set(textFragments(before.elementTree).map(clean));
  const appeared: string[] = [];
  for (const text of textFragments(after.elementTree).map(clean)) {
    if (text.length < 3 || text.length > 200 || seen.has(text) || appeared.includes(text)) continue;
    appeared.push(text);
    if (appeared.length === 5) break;
  }
  return appeared;
}

const STATE_ATTRIBUTES = ['value', 'checked', 'aria-checked', 'aria-expanded', 'aria-selected', 'aria-pressed'];

function rectHash(node: DOMElementNode): string | undefined {
  const coords = node.viewportCoordinates ?? node.pageCoordinates;
  if (!coords) return undefined;
  return stableHash(coords);
}

export function targetFingerprintForElement(
  index: number,
  element: DOMElementNode,
  tabId: number | null,
  actionType = 'unknown',
): TargetFingerprint {
  const textFallback = nodeText(element).slice(0, 120) || undefined;
  const accessibleName =
    element.attributes['aria-label'] ??
    element.attributes.title ??
    element.attributes.placeholder ??
    textFallback;

  return {
    index,
    actionType,
    tabId: tabId ?? undefined,
    backendNodeId: element.backendNodeId,
    xpath: element.xpath ?? undefined,
    cssSelector: element.getEnhancedCssSelector?.() || undefined,
    role: element.attributes.role,
    accessibleName,
    tagName: element.tagName ?? undefined,
    textHash: shortTextHash(`${accessibleName ?? ''} ${nodeText(element)}`),
    rectHash: rectHash(element),
  };
}

export function createBrowserObservation(state: BrowserState, capturedAt = Date.now()): BrowserObservation {
  const tabId = typeof state.tabId === 'number' ? state.tabId : null;
  const entries = Array.from(state.selectorMap.entries());
  const targets = entries.map(([index, element]) => targetFingerprintForElement(index, element, tabId));

  const compactTargets = targets.map((target, i) => ({
    i: target.index,
    b: target.backendNodeId,
    x: target.xpath,
    r: target.role,
    n: target.accessibleName,
    t: target.tagName,
    h: target.textHash,
    q: target.rectHash,
    s: STATE_ATTRIBUTES.map(name => entries[i][1].attributes[name] ?? '').join('|'),
  }));
  const documentFingerprint = stableHash({
    url: state.url,
    title: state.title,
    count: targets.length,
    structure: compactTargets.map(target => [target.i, target.b, target.x, target.t]),
  });
  const text = stableHash(pageText(state.elementTree));
  const layoutFingerprint = stableHash({
    scrollY: state.scrollY,
    scrollHeight: state.scrollHeight,
    visualViewportHeight: state.visualViewportHeight,
    targets: compactTargets,
    // Text-only updates (a counter, a status message) are page changes too.
    text,
  });
  // The same page content scrolled elsewhere: element positions (q) and scroll values are left out.
  const contentFingerprint = stableHash({
    url: state.url,
    title: state.title,
    targets: compactTargets.map(({ i, b, x, r, n, t, h, s }) => ({ i, b, x, r, n, t, h, s })),
    text,
  });

  return {
    id: `obs_${tabId ?? 'none'}_${documentFingerprint}_${layoutFingerprint}_${capturedAt.toString(36)}`,
    tabId,
    url: state.url,
    title: state.title,
    capturedAt,
    documentFingerprint,
    layoutFingerprint,
    contentFingerprint,
    targets,
  };
}

export function ensureBrowserObservation(state: BrowserState): BrowserObservation {
  if (state.observation) return state.observation;
  const observation = createBrowserObservation(state);
  state.observation = observation;
  return observation;
}

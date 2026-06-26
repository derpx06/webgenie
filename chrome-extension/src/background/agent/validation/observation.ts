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
  const targets = Array.from(state.selectorMap.entries()).map(([index, element]) =>
    targetFingerprintForElement(index, element, tabId),
  );

  const compactTargets = targets.map(target => ({
    i: target.index,
    b: target.backendNodeId,
    x: target.xpath,
    r: target.role,
    n: target.accessibleName,
    t: target.tagName,
    h: target.textHash,
    q: target.rectHash,
  }));
  const documentFingerprint = stableHash({
    url: state.url,
    title: state.title,
    count: targets.length,
    structure: compactTargets.map(target => [target.i, target.b, target.x, target.t]),
  });
  const layoutFingerprint = stableHash({
    scrollY: state.scrollY,
    scrollHeight: state.scrollHeight,
    visualViewportHeight: state.visualViewportHeight,
    targets: compactTargets,
  });

  return {
    id: `obs_${tabId ?? 'none'}_${documentFingerprint}_${layoutFingerprint}_${capturedAt.toString(36)}`,
    tabId,
    url: state.url,
    title: state.title,
    capturedAt,
    documentFingerprint,
    layoutFingerprint,
    targets,
  };
}

export function ensureBrowserObservation(state: BrowserState): BrowserObservation {
  if (state.observation) return state.observation;
  const observation = createBrowserObservation(state);
  state.observation = observation;
  return observation;
}

export function fingerprintFailureKey(target: TargetFingerprint | null | undefined, url: string): string {
  if (!target) return `${url}|target:unknown`;
  const stablePart =
    target.backendNodeId != null ? `backend:${target.backendNodeId}` :
      target.xpath ? `xpath:${target.xpath}` :
        target.cssSelector ? `css:${target.cssSelector}` :
          `idx:${target.index}`;
  const namePart = target.accessibleName ? `|name:${stableHash(target.accessibleName)}` : '';
  const actionPart = target.actionType ? `|action:${target.actionType}` : '';
  return `${url}|${stablePart}${namePart}${actionPart}`;
}

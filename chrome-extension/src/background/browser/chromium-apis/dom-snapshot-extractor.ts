/**
 * DOMSnapshotExtractor — Advanced Native DOM Extraction using DOMSnapshot.captureSnapshot
 *
 * This provides a high-reliability DOM extraction tool that:
 *   - Runs entirely in the browser context via chrome.debugger CDP (no script injection!)
 *   - Circumvents page Content Security Policy (CSP) headers that block content scripts
 *   - Resolves all iframes, shadow trees, and nested elements natively
 *   - Captures exact layout coordinates (bounding boxes) for click targets
 *   - Inspects computed styles natively to filter out hidden elements
 *
 * STATUS: Standalone tool — not yet wired into the agent pipeline.
 */

import { DOMElementNode, DOMTextNode, type DOMState } from '../dom/views';
import { createLogger } from '@src/background/log';
import { cdpBridge } from './cdp-bridge';

const logger = createLogger('DOMSnapshotExtractor');

// Computed styles to request for visibility filtering
const COMPUTED_STYLES = [
  'display',
  'visibility',
  'opacity',
  'transform',
  'width',
  'height'
];

interface CDPDocument {
  documentURL: number;
  title: number;
  nodes: {
    nodeName: number[];
    nodeType: number[];
    attributes?: number[][];
    textValue?: number[];
    inputValue?: number[];
    inputChecked?: number[];
    optionSelected?: number[];
    contentDocumentIndex?: number[];
    parentIndex?: number[];
  };
  layout: {
    nodeIndex: number[];
    styles?: number[][];
    bounds: number[][]; // [x, y, w, h] for each layout node
  };
}

interface CDPSnapshotResponse {
  documents: CDPDocument[];
  strings: string[];
}

/**
 * Retrieve the page DOMState natively using CDP DOMSnapshot.captureSnapshot.
 * Filters for visible, interactive elements and numbers them.
 */
export async function getDOMStateViaSnapshot(
  tabId: number,
  viewportWidth = 1280,
  viewportHeight = 800
): Promise<DOMState> {
  logger.info(`[DOMSnapshot] Capturing native DOM snapshot for tab ${tabId}`);

  try {
    const rawData = await cdpBridge.send<CDPSnapshotResponse>(tabId, 'DOMSnapshot.captureSnapshot', {
      computedStyles: COMPUTED_STYLES,
      includeDOMRects: true
    });

    if (!rawData || !rawData.documents || rawData.documents.length === 0) {
      throw new Error('Received empty document list from DOMSnapshot');
    }

    return parseSnapshot(rawData, viewportWidth, viewportHeight);
  } catch (err) {
    logger.error('[DOMSnapshot] Extraction failed, returning empty DOMState:', err);
    return buildEmptyDOMState();
  }
}

// ── Snapshot Parser ──────────────────────────────────────────────────────────

function parseSnapshot(
  snapshot: CDPSnapshotResponse,
  viewportWidth: number,
  viewportHeight: number
): DOMState {
  const { documents, strings } = snapshot;
  const selectorMap = new Map<number, DOMElementNode>();
  let highlightCounter = 0;

  // Map to resolve strings by index safely
  const getString = (idx: number): string => strings[idx] ?? '';

  // Root document is always index 0
  const rootDoc = documents[0];
  const totalNodes = rootDoc.nodes.nodeName.length;

  // Build a mapping of nodeIndex to layout bounds and styles
  const nodeLayoutMap = new Map<number, { bounds: number[]; styles: Record<string, string> }>();
  if (rootDoc.layout) {
    const { nodeIndex, bounds, styles } = rootDoc.layout;
    for (let i = 0; i < nodeIndex.length; i++) {
      const nIdx = nodeIndex[i];
      const b = bounds[i] ?? [0, 0, 0, 0];
      
      const computedStyles: Record<string, string> = {};
      if (styles && styles[i]) {
        const styleVals = styles[i];
        for (let sIdx = 0; sIdx < COMPUTED_STYLES.length; sIdx++) {
          const valStrIdx = styleVals[sIdx];
          if (valStrIdx !== undefined && valStrIdx !== -1) {
            computedStyles[COMPUTED_STYLES[sIdx]] = getString(valStrIdx);
          }
        }
      }

      nodeLayoutMap.set(nIdx, { bounds: b, styles: computedStyles });
    }
  }

  // Pre-calculate parents to build tree hierarchy
  const parentMap = new Map<number, number>();
  if (rootDoc.nodes.parentIndex) {
    const parents = rootDoc.nodes.parentIndex;
    for (let i = 0; i < parents.length; i++) {
      parentMap.set(i, parents[i]);
    }
  }

  // Temporary list to map node index to instantiated DOMBaseNodes
  const instNodes: (DOMElementNode | DOMTextNode | null)[] = new Array(totalNodes).fill(null);

  // First pass: Instantiate elements and read attributes
  for (let i = 0; i < totalNodes; i++) {
    const nodeType = rootDoc.nodes.nodeType[i];
    const rawName = getString(rootDoc.nodes.nodeName[i]);

    // Handle Text Nodes
    if (nodeType === 3) {
      const textValIdx = rootDoc.nodes.textValue?.[i];
      const text = textValIdx !== undefined && textValIdx !== -1 ? getString(textValIdx).trim() : '';
      if (text) {
        instNodes[i] = new DOMTextNode(text, true);
      }
      continue;
    }

    // Handle Element Nodes
    if (nodeType === 1) {
      const tagName = rawName.toLowerCase();

      // Read attributes
      const attributes: Record<string, string> = {};
      const attrs = rootDoc.nodes.attributes?.[i] ?? [];
      for (let aIdx = 0; aIdx < attrs.length; aIdx += 2) {
        const key = getString(attrs[aIdx]);
        const val = getString(attrs[aIdx + 1]);
        attributes[key] = val;
      }

      // Check input elements values & state
      if (rootDoc.nodes.inputValue?.[i] !== undefined) {
        const valIdx = rootDoc.nodes.inputValue[i];
        if (valIdx !== -1) {
          attributes['value'] = getString(valIdx);
        }
      }
      if (rootDoc.nodes.inputChecked?.[i]) {
        attributes['checked'] = 'true';
      }
      if (rootDoc.nodes.optionSelected?.[i]) {
        attributes['selected'] = 'true';
      }

      // Resolve layout bounds and visibility
      const layoutData = nodeLayoutMap.get(i);
      const bounds = layoutData?.bounds ?? [0, 0, 0, 0];
      const styles = layoutData?.styles ?? {};

      const [x, y, width, height] = bounds;

      // Visibility criteria
      const isVisible =
        styles.display !== 'none' &&
        styles.visibility !== 'hidden' &&
        styles.opacity !== '0' &&
        width > 0 &&
        height > 0;

      const inViewport =
        x < viewportWidth &&
        y < viewportHeight &&
        x + width > 0 &&
        y + height > 0;

      const isInteractive = isElementInteractive(tagName, attributes);

      let highlightIndex: number | null = null;
      if (isVisible && isInteractive) {
        highlightIndex = highlightCounter;
        highlightCounter++;
      }

      const elementNode = new DOMElementNode({
        tagName,
        xpath: null, // Computed on demand/fallback
        attributes,
        children: [],
        isVisible,
        isInteractive,
        isTopElement: i === 0,
        isInViewport: inViewport,
        highlightIndex,
        viewportCoordinates: { x: Math.round(x + width / 2), y: Math.round(y + height / 2) },
        pageCoordinates: { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }
      });

      if (highlightIndex !== null) {
        selectorMap.set(highlightIndex, elementNode);
      }

      instNodes[i] = elementNode;
    }
  }

  // Second pass: Build parent-child hierarchy
  let rootElement: DOMElementNode | null = null;

  for (let i = 0; i < totalNodes; i++) {
    const node = instNodes[i];
    if (!node) continue;

    const parentIdx = parentMap.get(i);
    if (parentIdx === undefined || parentIdx === -1) {
      if (node instanceof DOMElementNode && !rootElement) {
        rootElement = node;
      }
      continue;
    }

    const parentNode = instNodes[parentIdx];
    if (parentNode && parentNode instanceof DOMElementNode) {
      node.parent = parentNode;
      parentNode.children.push(node);
    }
  }

  // Fallback to empty if no root element resolved
  if (!rootElement) {
    return buildEmptyDOMState();
  }

  logger.info(`[DOMSnapshot] Successfully built DOM tree with ${highlightCounter} interactive elements`);
  return { elementTree: rootElement, selectorMap };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isElementInteractive(tagName: string, attributes: Record<string, string>): boolean {
  const interactiveTags = new Set(['button', 'a', 'input', 'select', 'textarea', 'option']);
  if (interactiveTags.has(tagName)) return true;

  // Custom roles
  const role = attributes.role ?? '';
  const interactiveRoles = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'combobox']);
  if (interactiveRoles.has(role)) return true;

  // Event handlers / attributes
  if (attributes.onclick || attributes.cursor === 'pointer' || attributes['data-clickable'] === 'true') {
    return true;
  }

  return false;
}

function buildEmptyDOMState(): DOMState {
  const elementTree = new DOMElementNode({
    tagName: 'body',
    xpath: '',
    attributes: {},
    children: [],
    isVisible: false,
    isInteractive: false,
    isTopElement: false,
    isInViewport: false,
    highlightIndex: null,
    shadowRoot: false,
    parent: null
  });
  return { elementTree, selectorMap: new Map() };
}

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

import { DOMElementNode, DOMTextNode, type DOMState, type DOMBaseNode } from '../dom/views';
import type { CoordinateSet } from '../dom/history/view';
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
  scrollOffsetX?: number;
  scrollOffsetY?: number;
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
    bounds: number[][]; // [x, y, w, h] relative to parent document frame
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

  // Resolve string table indexes safely
  const getString = (idx: number): string => strings[idx] ?? '';

  // Get scroll offsets of root document (index 0)
  const rootDoc = documents[0];
  const rootScrollX = rootDoc.scrollOffsetX ?? 0;
  const rootScrollY = rootDoc.scrollOffsetY ?? 0;

  // Recursive document parser to build DOMBaseNode tree piercing frames
  function parseDocument(
    docIndex: number,
    parentOffsetPageX: number,
    parentOffsetPageY: number
  ): DOMElementNode | null {
    const doc = documents[docIndex];
    if (!doc) return null;

    const totalNodes = doc.nodes.nodeName.length;

    // Map nodeIndex to layout bounds and computed styles
    const nodeLayoutMap = new Map<number, { bounds: number[]; styles: Record<string, string> }>();
    if (doc.layout) {
      const { nodeIndex, bounds, styles } = doc.layout;
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

    // Pre-calculate parent relationships inside this document
    const parentMap = new Map<number, number>();
    if (doc.nodes.parentIndex) {
      const parents = doc.nodes.parentIndex;
      for (let i = 0; i < parents.length; i++) {
        parentMap.set(i, parents[i]);
      }
    }

    // Instantiated nodes inside this document
    const docNodes: (DOMElementNode | DOMTextNode | null)[] = new Array(totalNodes).fill(null);

    // 1. Create nodes
    for (let i = 0; i < totalNodes; i++) {
      const nodeType = doc.nodes.nodeType[i];
      const rawName = getString(doc.nodes.nodeName[i]);

      // Text Node
      if (nodeType === 3) {
        const textValIdx = doc.nodes.textValue?.[i];
        const text = textValIdx !== undefined && textValIdx !== -1 ? getString(textValIdx).trim() : '';
        if (text) {
          docNodes[i] = new DOMTextNode(text, true);
        }
        continue;
      }

      // Element Node
      if (nodeType === 1) {
        const tagName = rawName.toLowerCase();

        // Read attributes
        const attributes: Record<string, string> = {};
        const attrs = doc.nodes.attributes?.[i] ?? [];
        for (let aIdx = 0; aIdx < attrs.length; aIdx += 2) {
          const key = getString(attrs[aIdx]);
          const val = getString(attrs[aIdx + 1]);
          attributes[key] = val;
        }

        // Input field values & options
        if (doc.nodes.inputValue?.[i] !== undefined) {
          const valIdx = doc.nodes.inputValue[i];
          if (valIdx !== -1) {
            attributes['value'] = getString(valIdx);
          }
        }
        if (doc.nodes.inputChecked?.[i]) {
          attributes['checked'] = 'true';
        }
        if (doc.nodes.optionSelected?.[i]) {
          attributes['selected'] = 'true';
        }

        // Layout bounds (relative to parent frame document)
        const layoutData = nodeLayoutMap.get(i);
        const bounds = layoutData?.bounds ?? [0, 0, 0, 0];
        const styles = layoutData?.styles ?? {};

        const [rx, ry, width, height] = bounds;

        // Read dimensions
        attributes['computedWidth'] = String(Math.round(width));
        attributes['computedHeight'] = String(Math.round(height));

        // Calculate absolute page coordinates (recursive)
        const pageX = Math.round(parentOffsetPageX + rx + width / 2);
        const pageY = Math.round(parentOffsetPageY + ry + height / 2);

        // Viewport coordinates
        const viewportX = Math.round(pageX - rootScrollX);
        const viewportY = Math.round(pageY - rootScrollY);

        // Visibility criteria
        const isVisible =
          styles.display !== 'none' &&
          styles.visibility !== 'hidden' &&
          styles.opacity !== '0' &&
          width > 0 &&
          height > 0;

        const inViewport =
          viewportX < viewportWidth &&
          viewportY < viewportHeight &&
          viewportX + width > 0 &&
          viewportY + height > 0;

        const isInteractive = isElementInteractive(tagName, attributes);

        let highlightIndex: number | null = null;
        if (isVisible && isInteractive) {
          highlightIndex = highlightCounter;
          highlightCounter++;
        }

        const pageLeft = Math.round(parentOffsetPageX + rx);
        const pageTop = Math.round(parentOffsetPageY + ry);
        const pageCoords: CoordinateSet = {
          topLeft:     { x: pageLeft,         y: pageTop          },
          topRight:    { x: pageLeft + width, y: pageTop          },
          bottomLeft:  { x: pageLeft,         y: pageTop + height },
          bottomRight: { x: pageLeft + width, y: pageTop + height },
          center:      { x: pageX,            y: pageY            },
          width,
          height,
        };

        const viewportLeft = Math.round(pageLeft - rootScrollX);
        const viewportTop = Math.round(pageTop - rootScrollY);
        const viewportCoords: CoordinateSet = {
          topLeft:     { x: viewportLeft,         y: viewportTop          },
          topRight:    { x: viewportLeft + width, y: viewportTop          },
          bottomLeft:  { x: viewportLeft,         y: viewportTop + height },
          bottomRight: { x: viewportLeft + width, y: viewportTop + height },
          center:      { x: viewportX,            y: viewportY            },
          width,
          height,
        };

        const elementNode = new DOMElementNode({
          tagName,
          xpath: null,
          attributes,
          children: [],
          isVisible,
          isInteractive,
          isTopElement: docIndex === 0 && i === 0,
          isInViewport: inViewport,
          highlightIndex,
          viewportCoordinates: viewportCoords,
          pageCoordinates: pageCoords
        });

        if (highlightIndex !== null) {
          selectorMap.set(highlightIndex, elementNode);
        }

        docNodes[i] = elementNode;
      }
    }

    // 2. Stitch children and handle subdocuments (iframes / shadow roots)
    let docRoot: DOMElementNode | null = null;

    for (let i = 0; i < totalNodes; i++) {
      const node = docNodes[i];
      if (!node) continue;

      const parentIdx = parentMap.get(i);
      if (parentIdx === undefined || parentIdx === -1) {
        if (node instanceof DOMElementNode && !docRoot) {
          docRoot = node;
        }
        continue;
      }

      const parentNode = docNodes[parentIdx];
      if (parentNode && parentNode instanceof DOMElementNode) {
        node.parent = parentNode;
        parentNode.children.push(node);
      }
    }

    // 3. Recursively parse and stitch subdocuments (cross-origin frames / shadow roots)
    for (let i = 0; i < totalNodes; i++) {
      const node = docNodes[i];
      if (node && node instanceof DOMElementNode) {
        const subDocIndex = doc.nodes.contentDocumentIndex?.[i];
        if (subDocIndex !== undefined && subDocIndex !== -1) {
          // Calculate absolute coordinates offset for child frame
          const layoutData = nodeLayoutMap.get(i);
          const bounds = layoutData?.bounds ?? [0, 0, 0, 0];
          const [rx, ry] = bounds;

          const childOffsetPageX = parentOffsetPageX + rx;
          const childOffsetPageY = parentOffsetPageY + ry;

          const subDocRoot = parseDocument(subDocIndex, childOffsetPageX, childOffsetPageY);
          if (subDocRoot) {
            subDocRoot.parent = node;
            node.children.push(subDocRoot);
          }
        }
      }
    }

    return docRoot;
  }

  // Parse starting at root document (index 0)
  const rootElement = parseDocument(0, 0, 0);

  if (!rootElement) {
    return buildEmptyDOMState();
  }

  // 4. Assign XPath values deterministically to all elements
  assignXPaths(rootElement, '');

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

  // Click handlers
  if (attributes.onclick || attributes.cursor === 'pointer' || attributes['data-clickable'] === 'true') {
    return true;
  }

  return false;
}

function assignXPaths(node: DOMBaseNode, parentXPath: string) {
  if (node instanceof DOMElementNode) {
    const tag = node.tagName || 'div';
    const siblings = node.parent ? node.parent.children : [];
    let sameTagCount = 0;
    let myIndex = 1;

    for (const sibling of siblings) {
      if (sibling instanceof DOMElementNode && sibling.tagName === tag) {
        sameTagCount++;
        if (sibling === node) {
          myIndex = sameTagCount;
        }
      }
    }

    const currentXPath = parentXPath ? `${parentXPath}/${tag}[${myIndex}]` : `/${tag}[${myIndex}]`;
    node.xpath = currentXPath;

    for (const child of node.children) {
      assignXPaths(child, currentXPath);
    }
  }
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

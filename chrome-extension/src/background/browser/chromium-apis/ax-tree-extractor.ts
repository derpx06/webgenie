/**
 * AXTreeExtractor — Native CDP Accessibility Tree Extraction
 *
 * Two-layer perception pipeline:
 *   Layer 1: Accessibility.getFullAXTree  → semantic, role-indexed node list for LLM
 *   Layer 2: DOM.getBoxModel              → pixel-accurate bounding boxes for click dispatch
 *
 * Key properties:
 *   - Fully CSP-proof (no script injection)
 *   - Single round-trip for accessibility data
 *   - Disables Accessibility domain immediately after fetch to avoid browser overhead
 *   - Interactive nodes enriched with pageCoordinates (not sent to LLM, only used internally)
 *
 * Integration:
 *   Called by page.ts getClickableElements() when domPerceptionMode === 'axtree'
 */

import { DOMElementNode, DOMTextNode, type DOMState } from '../dom/views';
import { cdpBridge, type AXNode } from './cdp-bridge';
import { createLogger } from '@src/background/log';

const logger = createLogger('AXTreeExtractor');

// ── Interactive ARIA roles ────────────────────────────────────────────────────

/** Roles that receive a highlightIndex (sent to LLM as actionable elements). */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'listbox',
  'option', 'spinbutton', 'slider', 'searchbox', 'switch', 'treeitem',
  'gridcell', 'columnheader', 'rowheader', 'scrollbar',
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract page state using the CDP Accessibility tree as the primary source.
 *
 * Returns a DOMState where:
 *  - selectorMap contains ONLY interactive nodes (with highlightIndex)
 *  - elementTree represents the full semantic hierarchy
 *  - interactive nodes are enriched with pageCoordinates from DOM.getBoxModel (for click dispatch)
 *
 * The Accessibility domain is ALWAYS disabled in the finally block to avoid
 * persistent browser performance overhead.
 */
export async function getAXTreeState(
  tabId: number,
  viewportWidth = 1280,
  viewportHeight = 900,
): Promise<DOMState> {
  logger.info(`[AXTreeExtractor] Starting AXTree extraction for tab ${tabId}`);

  // ── Step 1: Fetch full AX tree ──────────────────────────────────────────
  let axNodes: AXNode[] = [];
  try {
    await cdpBridge.send(tabId, 'Accessibility.enable');
    const result = await cdpBridge.send<{ nodes: AXNode[] }>(
      tabId,
      'Accessibility.getFullAXTree',
    );
    axNodes = result.nodes ?? [];
    logger.debug(`[AXTreeExtractor] AXTree fetched — ${axNodes.length} raw nodes`);
  } finally {
    // CRITICAL: always disable to release browser accessibility tracking overhead
    try {
      await cdpBridge.send(tabId, 'Accessibility.disable');
    } catch {
      // Non-fatal: may already be disabled
    }
  }

  if (axNodes.length === 0) {
    logger.warning('[AXTreeExtractor] Empty AXTree — returning empty DOMState');
    return buildEmptyDOMState();
  }

  // ── Step 2: Build node map by nodeId ────────────────────────────────────
  const nodeMap = new Map<string, AXNode>();
  for (const node of axNodes) {
    nodeMap.set(node.nodeId, node);
  }

  // ── Step 3: Build DOMElementNode tree from flat AXNode array ────────────
  const selectorMap = new Map<number, DOMElementNode>();
  let highlightCounter = 0;

  // DOMElementNode instances keyed by AXNode nodeId
  const domNodeMap = new Map<string, DOMElementNode>();

  // First pass: create all DOMElementNode instances
  for (const axNode of axNodes) {
    if (axNode.ignored) continue;

    const role = axNode.role?.value ?? 'generic';
    const name = axNode.name?.value ?? '';
    const description = axNode.description?.value ?? '';
    const isDisabled = axNode.disabled?.value === true;

    // Build attributes from AX properties
    const attributes: Record<string, string> = {};
    if (role) attributes['role'] = role;
    if (name) attributes['aria-label'] = name;
    if (description) attributes['aria-description'] = description;
    if (isDisabled) attributes['aria-disabled'] = 'true';
    if (axNode.value?.value != null) attributes['value'] = String(axNode.value.value);

    // Enrich from AX properties array (checked, expanded, selected, etc.)
    for (const prop of axNode.properties ?? []) {
      if (prop.value?.value != null) {
        attributes[`aria-${prop.name}`] = String(prop.value.value);
      }
    }

    // Determine interactivity
    const isInteractive = INTERACTIVE_ROLES.has(role) && !isDisabled;

    // Assign highlight index only to interactive, non-disabled nodes
    let highlightIndex: number | null = null;
    if (isInteractive) {
      highlightIndex = highlightCounter++;
    }

    const domNode = new DOMElementNode({
      tagName: axNodeToTagName(role),
      xpath: null,
      attributes,
      children: [],
      isVisible: true,     // AXTree only contains visible nodes by default
      isInteractive,
      isTopElement: false,
      isInViewport: false, // will be set after coordinate enrichment
      shadowRoot: false,
      highlightIndex,
      parent: null,
    });

    domNodeMap.set(axNode.nodeId, domNode);

    if (highlightIndex !== null) {
      selectorMap.set(highlightIndex, domNode);
    }
  }

  // Second pass: stitch parent-child relationships using parentId links
  let rootNode: DOMElementNode | null = null;

  for (const axNode of axNodes) {
    if (axNode.ignored) continue;

    const domNode = domNodeMap.get(axNode.nodeId);
    if (!domNode) continue;

    const parentId = axNode.parentId;
    if (!parentId) {
      if (!rootNode) rootNode = domNode;
      continue;
    }

    const parentDom = domNodeMap.get(parentId);
    if (parentDom) {
      domNode.parent = parentDom;
      parentDom.children.push(domNode);
    }
  }

  if (!rootNode) {
    logger.warning('[AXTreeExtractor] Could not find root node — returning empty state');
    return buildEmptyDOMState();
  }

  logger.info(
    `[AXTreeExtractor] Built DOMState — ${highlightCounter} interactive nodes from ${axNodes.length} AX nodes`,
  );

  const baseState: DOMState = { elementTree: rootNode, selectorMap };

  // ── Step 4: Enrich interactive nodes with bounding boxes ─────────────────
  // Fetch coordinates only for interactive nodes via DOM.getBoxModel.
  // These drive click dispatch and are NOT serialized into the LLM prompt.
  try {
    await enrichWithBoundingBoxes(tabId, axNodes, domNodeMap, viewportWidth, viewportHeight);
  } catch (err) {
    // Non-fatal: degraded gracefully; clicks fall back to DOM locator
    logger.warning('[AXTreeExtractor] Bounding box enrichment failed (non-fatal):', err);
  }

  return baseState;
}

// ── Private: bounding box enrichment ─────────────────────────────────────────

/**
 * Fetch bounding boxes for interactive AXNodes using DOM.getBoxModel per backendDOMNodeId.
 * Updates the matching DOMElementNode's pageCoordinates and isInViewport in-place.
 * Runs as parallel CDP calls to minimize latency overhead.
 */
async function enrichWithBoundingBoxes(
  tabId: number,
  axNodes: AXNode[],
  domNodeMap: Map<string, DOMElementNode>,
  viewportWidth: number,
  viewportHeight: number,
): Promise<void> {
  const enrichTargets = axNodes.filter(n => {
    const dom = domNodeMap.get(n.nodeId);
    return dom?.isInteractive && n.backendDOMNodeId != null;
  });

  if (enrichTargets.length === 0) return;

  logger.debug(`[AXTreeExtractor] Enriching ${enrichTargets.length} interactive nodes with bounding boxes`);

  const results = await Promise.allSettled(
    enrichTargets.map(async axNode => {
      const backendNodeId = axNode.backendDOMNodeId!;
      const boxModel = await cdpBridge.getBoxModel(tabId, backendNodeId);
      if (!boxModel) return;

      const domNode = domNodeMap.get(axNode.nodeId);
      if (!domNode) return;

      domNode.pageCoordinates = {
        topLeft:     { x: boxModel.left,                  y: boxModel.top },
        topRight:    { x: boxModel.left + boxModel.width, y: boxModel.top },
        bottomLeft:  { x: boxModel.left,                  y: boxModel.top + boxModel.height },
        bottomRight: { x: boxModel.left + boxModel.width, y: boxModel.top + boxModel.height },
        center:      { x: boxModel.x,                     y: boxModel.y },
        width:       boxModel.width,
        height:      boxModel.height,
      };
      // viewportCoordinates approximated as page coords (scroll applied at click dispatch)
      domNode.viewportCoordinates = domNode.pageCoordinates;

      domNode.isInViewport =
        boxModel.x >= 0 &&
        boxModel.y >= 0 &&
        boxModel.x < viewportWidth &&
        boxModel.y < viewportHeight;
    }),
  );

  const failures = results.filter(r => r.status === 'rejected').length;
  if (failures > 0) {
    logger.debug(
      `[AXTreeExtractor] ${failures}/${enrichTargets.length} box model fetches failed (elements may be off-screen or detached)`,
    );
  }
}

// ── Private: utilities ────────────────────────────────────────────────────────

/**
 * Map an ARIA role to a representative HTML tag name for DOMElementNode compatibility.
 */
function axNodeToTagName(role: string): string {
  const roleToTag: Record<string, string> = {
    button: 'button', link: 'a', textbox: 'input', searchbox: 'input',
    checkbox: 'input', radio: 'input', combobox: 'select', listbox: 'select',
    option: 'option', spinbutton: 'input', slider: 'input', switch: 'input',
    menuitem: 'li', menuitemcheckbox: 'li', menuitemradio: 'li',
    tab: 'button', treeitem: 'li', gridcell: 'td', columnheader: 'th',
    rowheader: 'th', scrollbar: 'div', heading: 'h2', img: 'img',
    list: 'ul', listitem: 'li', table: 'table', row: 'tr',
    paragraph: 'p', generic: 'div', none: 'div', presentation: 'div',
  };
  return roleToTag[role] ?? 'div';
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
    parent: null,
  });
  return { elementTree, selectorMap: new Map() };
}

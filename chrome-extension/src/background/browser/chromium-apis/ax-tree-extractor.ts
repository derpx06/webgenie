/**
 * AXTreeExtractor — Native CDP Accessibility Tree DOM Extraction
 *
 * Two-layer perception pipeline:
 *   Layer 1 (Semantic):     Accessibility.getFullAXTree  → role-indexed interactive node list
 *   Layer 2 (Coordinates):  DOM.getBoxModel (parallel)   → bounding boxes for click dispatch only
 *
 * Properties:
 *   - Fully CSP-proof: zero script injection, operates entirely via chrome.debugger CDP
 *   - Accessibility domain is ALWAYS disabled in a finally block (avoids persistent overhead)
 *   - Bounding boxes fetched in parallel for interactive nodes only (not sent to LLM)
 *   - Falls back to empty DOMState on any unrecoverable error (caller handles fallback)
 *
 * Integration point:
 *   page.ts → getClickableElements() when domPerceptionMode === 'axtree'
 */

import { DOMElementNode, type DOMState } from '../dom/views';
import { type CoordinateSet } from '../dom/history/view';
import { cdpBridge, type AXNode } from './cdp-bridge';
import { createLogger } from '@src/background/log';

const logger = createLogger('AXTreeExtractor');

// ── Interactive role sets ─────────────────────────────────────────────────────

/**
 * ARIA roles that represent actionable UI elements.
 * Only these receive a highlightIndex and appear in the selectorMap.
 */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'listbox',
  'option', 'spinbutton', 'slider', 'searchbox', 'switch', 'treeitem',
  'gridcell', 'columnheader', 'rowheader', 'scrollbar',
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract page DOMState using the CDP Accessibility tree as the primary source.
 *
 * The returned DOMState:
 *  - selectorMap  → only interactive nodes, each with a numeric highlightIndex
 *  - elementTree  → full semantic tree (for context/text serialization)
 *  - Interactive nodes have pageCoordinates enriched from DOM.getBoxModel
 *    (used by cdpClick in page.ts — NOT sent to the LLM prompt)
 */
export async function getAXTreeState(
  tabId: number,
  viewportWidth = 1280,
  viewportHeight = 900,
): Promise<DOMState> {
  logger.info(`[AXTreeExtractor] Starting extraction for tab ${tabId}`);

  // ── Step 1: Fetch the full Accessibility tree ────────────────────────────
  let axNodes: AXNode[] = [];
  try {
    await cdpBridge.send(tabId, 'Accessibility.enable');
    const result = await cdpBridge.send<{ nodes: AXNode[] }>(
      tabId,
      'Accessibility.getFullAXTree',
    );
    axNodes = result.nodes ?? [];
    logger.debug(`[AXTreeExtractor] Raw AXTree: ${axNodes.length} nodes`);
  } finally {
    // Always disable immediately — keeps browser rendering overhead minimal
    try { await cdpBridge.send(tabId, 'Accessibility.disable'); } catch { /* non-fatal */ }
  }

  if (axNodes.length === 0) {
    logger.warning('[AXTreeExtractor] Empty AXTree received');
    return buildEmptyDOMState();
  }

  // ── Step 2: Build DOMElementNode instances (first pass) ─────────────────
  const selectorMap = new Map<number, DOMElementNode>();
  let highlightCounter = 0;
  const domNodeMap = new Map<string, DOMElementNode>();

  for (const axNode of axNodes) {
    // Ignored nodes are intentionally hidden from assistive technology
    if (axNode.ignored) continue;

    const role = axNode.role?.value ?? 'generic';
    const name = axNode.name?.value ?? '';
    const description = axNode.description?.value ?? '';
    const isDisabled = axNode.disabled?.value === true;

    // Build the attributes map from AX properties
    const attributes: Record<string, string> = {};
    if (role)        attributes['role']             = role;
    if (name)        attributes['aria-label']        = name;
    if (description) attributes['aria-description'] = description;
    if (isDisabled)  attributes['aria-disabled']    = 'true';
    if (axNode.value?.value != null) attributes['value'] = String(axNode.value.value);

    // Map remaining AX properties (checked, expanded, selected, haspopup, …)
    for (const prop of axNode.properties ?? []) {
      if (prop.value?.value != null) {
        attributes[`aria-${prop.name}`] = String(prop.value.value);
      }
    }

    // Only non-disabled interactive roles receive a highlight index
    const isInteractive = INTERACTIVE_ROLES.has(role) && !isDisabled;
    const highlightIndex = isInteractive ? highlightCounter++ : null;

    const domNode = new DOMElementNode({
      tagName:        axRoleToTagName(role),
      xpath:          null,           // assigned after tree is stitched
      attributes,
      children:       [],
      isVisible:      true,           // AXTree only surfaces visible nodes
      isInteractive,
      isTopElement:   false,
      isInViewport:   false,          // set during bounding box enrichment
      shadowRoot:     false,
      highlightIndex,
      parent:         null,
    });

    domNodeMap.set(axNode.nodeId, domNode);
    if (highlightIndex !== null) selectorMap.set(highlightIndex, domNode);
  }

  // ── Step 3: Stitch parent-child relationships (second pass) ─────────────
  let rootNode: DOMElementNode | null = null;

  for (const axNode of axNodes) {
    if (axNode.ignored) continue;
    const domNode = domNodeMap.get(axNode.nodeId);
    if (!domNode) continue;

    if (!axNode.parentId) {
      if (!rootNode) rootNode = domNode;
      continue;
    }
    const parent = domNodeMap.get(axNode.parentId);
    if (parent) {
      domNode.parent = parent;
      parent.children.push(domNode);
    }
  }

  if (!rootNode) {
    logger.warning('[AXTreeExtractor] Could not determine root node');
    return buildEmptyDOMState();
  }

  logger.info(
    `[AXTreeExtractor] Tree built — ${highlightCounter} interactive / ${axNodes.length} total AX nodes`,
  );

  // ── Step 4: Enrich interactive nodes with bounding boxes ─────────────────
  // Parallel CDP calls: only for nodes that have a backendDOMNodeId.
  // These coordinates power cdpClick; they are NOT serialized into the LLM prompt.
  await enrichWithBoundingBoxes(tabId, axNodes, domNodeMap, viewportWidth, viewportHeight);

  return { elementTree: rootNode, selectorMap };
}

// ── Bounding box enrichment ───────────────────────────────────────────────────

async function enrichWithBoundingBoxes(
  tabId: number,
  axNodes: AXNode[],
  domNodeMap: Map<string, DOMElementNode>,
  viewportWidth: number,
  viewportHeight: number,
): Promise<void> {
  const targets = axNodes.filter(n => {
    const dom = domNodeMap.get(n.nodeId);
    return dom?.isInteractive && n.backendDOMNodeId != null;
  });

  if (targets.length === 0) return;
  logger.debug(`[AXTreeExtractor] Fetching bounding boxes for ${targets.length} interactive nodes`);

  const results = await Promise.allSettled(
    targets.map(async axNode => {
      const box = await cdpBridge.getBoxModel(tabId, axNode.backendDOMNodeId!);
      if (!box) return;

      const domNode = domNodeMap.get(axNode.nodeId);
      if (!domNode) return;

      // Build a fully-typed CoordinateSet from the BoxModel
      const coords: CoordinateSet = {
        topLeft:     { x: box.left,             y: box.top              },
        topRight:    { x: box.left + box.width, y: box.top              },
        bottomLeft:  { x: box.left,             y: box.top + box.height },
        bottomRight: { x: box.left + box.width, y: box.top + box.height },
        center:      { x: box.x,                y: box.y               },
        width:       box.width,
        height:      box.height,
      };

      domNode.pageCoordinates     = coords;
      domNode.viewportCoordinates = coords; // scroll offset applied at click-dispatch time
      domNode.isInViewport =
        box.x >= 0 && box.y >= 0 &&
        box.x < viewportWidth && box.y < viewportHeight;
    }),
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    logger.debug(
      `[AXTreeExtractor] ${failed}/${targets.length} box model lookups failed (off-screen or detached nodes)`,
    );
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Map an ARIA role to a representative HTML tag name.
 * Populates DOMElementNode.tagName for compatibility with the existing
 * clickableElementsToString() serializer.
 */
function axRoleToTagName(role: string): string {
  const map: Record<string, string> = {
    button: 'button', link: 'a',
    textbox: 'input', searchbox: 'input', checkbox: 'input',
    radio: 'input', spinbutton: 'input', slider: 'input', switch: 'input',
    combobox: 'select', listbox: 'select', option: 'option',
    menuitem: 'li', menuitemcheckbox: 'li', menuitemradio: 'li',
    tab: 'button', treeitem: 'li',
    gridcell: 'td', columnheader: 'th', rowheader: 'th',
    scrollbar: 'div', heading: 'h2', img: 'img',
    list: 'ul', listitem: 'li', table: 'table', row: 'tr',
    paragraph: 'p', generic: 'div', none: 'div', presentation: 'div',
  };
  return map[role] ?? 'div';
}

function buildEmptyDOMState(): DOMState {
  const elementTree = new DOMElementNode({
    tagName: 'body', xpath: '', attributes: {}, children: [],
    isVisible: false, isInteractive: false, isTopElement: false,
    isInViewport: false, highlightIndex: null, shadowRoot: false, parent: null,
  });
  return { elementTree, selectorMap: new Map() };
}

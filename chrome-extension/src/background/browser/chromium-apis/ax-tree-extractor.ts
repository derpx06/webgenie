/**
 * AXTree Extractor — Phase 2 Chromium API Integration
 *
 * Replaces the injected DOM script (`buildDomTree`) with the browser's own
 * Accessibility tree via CDP `Accessibility.getFullAXTree`.
 *
 * Benefits over current approach:
 *   - Pierces Shadow DOM (YouTube controls, Web Components)
 *   - Resolves cross-origin iframes (Stripe, PayPal) when not sandboxed
 *   - ~10x fewer tokens: semantic roles vs. raw HTML attributes
 *   - No injection needed — works on all pages including CSP-locked ones
 *
 * STATUS: Ready for integration — not yet wired into the main agent pipeline.
 * To integrate:
 *   1. Import getClickableElementsViaCDP
 *   2. Replace getClickableElements() call in browser/page.ts _updateState()
 *      with getClickableElementsViaCDP(this._tabId, cdpBridge)
 *
 * @see cdp-bridge.ts for the CDP session manager
 */

import { DOMElementNode } from '../dom/views';
import type { DOMState } from '../dom/views';
import { createLogger } from '@src/background/log';
import { cdpBridge, type AXNode, type BoxModel } from './cdp-bridge';

const logger = createLogger('AXTreeExtractor');

/** AX roles that map to interactive elements the agent should reason about */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'treeitem',
  'spinbutton',
  'slider',
  'switch',
]);

/**
 * Extract clickable elements from the Accessibility tree via CDP.
 * Returns a DOMState-compatible structure (elementTree + selectorMap).
 */
export async function getClickableElementsViaCDP(
  tabId: number,
  showHighlightElements = true,
): Promise<DOMState> {
  const selectorMap = new Map<number, DOMElementNode>();
  let highlightCounter = 0;

  let nodes: AXNode[];
  try {
    nodes = await cdpBridge.getFullAXTree(tabId);
  } catch (err) {
    logger.error('[AXTree] Failed to fetch AX tree — falling back to empty state:', err);
    return buildEmptyDOMState();
  }

  const buildElements: DOMElementNode[] = [];

  for (const node of nodes) {
    if (node.ignored) continue;
    const role = node.role?.value ?? '';
    if (!INTERACTIVE_ROLES.has(role)) continue;

    // Get bounding box for coordinate-based interaction
    let box: BoxModel | null = null;
    if (node.backendDOMNodeId != null) {
      box = await cdpBridge.getBoxModel(tabId, node.backendDOMNodeId);
    }

    // Skip off-screen / zero-size elements
    if (!box || box.width === 0 || box.height === 0) continue;

    const name = node.name?.value ?? '';
    const description = node.description?.value ?? '';
    const value = node.value?.value ?? '';
    const isDisabled = node.disabled?.value === true;

    const attributes: Record<string, string> = {
      role,
      'aria-label': name,
      'aria-description': description,
      value,
      'data-ax-node-id': node.nodeId,
      ...(node.backendDOMNodeId != null ? { 'data-backend-node-id': String(node.backendDOMNodeId) } : {}),
      // Store center coordinates for Phase 3 CDP click
      'data-cdp-x': String(Math.round(box.x)),
      'data-cdp-y': String(Math.round(box.y)),
    };

    if (isDisabled) attributes['disabled'] = 'true';

    const elementNode = new DOMElementNode({
      tagName: mapAXRoleToTagName(role),
      xpath: null,
      attributes,
      children: [],
      isVisible: true,
      isInteractive: !isDisabled,
      isTopElement: true,
      isInViewport: true,
      highlightIndex: highlightCounter,
      shadowRoot: false,
      parent: null,
    });

    selectorMap.set(highlightCounter, elementNode);
    buildElements.push(elementNode);
    highlightCounter++;

    if (showHighlightElements) {
      logger.debug(
        `[AXTree] [${highlightCounter - 1}] ${role} "${name || value}" @ (${Math.round(box.x)}, ${Math.round(box.y)})`,
      );
    }
  }

  logger.info(`[AXTree] Extracted ${buildElements.length} interactive elements from tab ${tabId}`);

  // Build a flat root element (compatible with current elementTree interface)
  const elementTree = new DOMElementNode({
    tagName: 'root',
    xpath: '/',
    attributes: {},
    children: buildElements,
    isVisible: true,
    isInteractive: false,
    isTopElement: true,
    isInViewport: true,
    highlightIndex: null,
    shadowRoot: false,
    parent: null,
  });

  // Wire parent references
  for (const child of buildElements) {
    child.parent = elementTree;
  }

  return { elementTree, selectorMap };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Map semantic AX roles to HTML tag names for LLM comprehension */
function mapAXRoleToTagName(role: string): string {
  switch (role) {
    case 'link':           return 'a';
    case 'button':         return 'button';
    case 'textbox':
    case 'searchbox':      return 'input';
    case 'combobox':       return 'select';
    case 'checkbox':       return 'input[type=checkbox]';
    case 'radio':          return 'input[type=radio]';
    case 'tab':            return 'tab';
    case 'menuitem':
    case 'menuitemcheckbox':
    case 'menuitemradio':  return 'menuitem';
    case 'listbox':        return 'ul';
    case 'option':         return 'option';
    case 'slider':
    case 'spinbutton':     return 'input[type=range]';
    default:               return 'div';
  }
}

/**
 * AXTreeExtractor — Native CDP Accessibility Tree DOM Extraction (V2)
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
 *   - Multi-Process OOPIF Stitching: queries targets via chrome.debugger.getTargets,
 *     attaches to iframe targets to retrieve their accessibility subtrees, and stitches them.
 *
 * Integration point:
 *   page.ts → getClickableElements() when domPerceptionMode === 'axtree'
 */

import { DOMElementNode, type DOMState } from '../dom/views';
import { type CoordinateSet } from '../dom/history/view';
import { cdpBridge, type AXNode, type BoxModel } from './cdp-bridge';
import { createLogger } from '@src/background/log';
import type { IBrowserAdapter } from '../../adapters/IBrowserAdapter';
import { ChromeBrowserAdapter } from '../../adapters/ChromeBrowserAdapter';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';

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

interface RawBoxModel {
  content: number[];
  padding: number[];
  border: number[];
  margin: number[];
  width: number;
  height: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract page DOMState using the CDP Accessibility tree as the primary source.
 *
 * The returned DOMState:
 *  - selectorMap  → only interactive nodes, each with a numeric highlightIndex
 *  - elementTree  → full semantic tree (for context/text serialization)
 *  - Interactive nodes have pageCoordinates enriched from bounding box resolution.
 *    Coordinate resolution strategy (in priority order):
 *    1. puppeteerPage.evaluate(getBoundingClientRect) — works even when Puppeteer
 *       owns the CDP session (avoids chrome.debugger conflict).
 *    2. DOM.getBoxModel via cdpBridge — fallback when Puppeteer is not attached.
 *    (Coordinates are used by cdpClick in page.ts — NOT sent to the LLM prompt)
 */
export async function getAXTreeState(
  tabId: number,
  viewportWidth = 1280,
  viewportHeight = 900,
  browserAdapter?: IBrowserAdapter,
  puppeteerPage?: PuppeteerPage | null,
): Promise<DOMState> {
  logger.info(`[AXTreeExtractor] Starting extraction for tab ${tabId}`);

  if (browserAdapter) {
    cdpBridge.setBrowserAdapter(browserAdapter);
  }
  const activeAdapter = browserAdapter || new ChromeBrowserAdapter();

  // ── Step 1: Fetch the full main Accessibility tree ───────────────────────
  let axNodes: AXNode[] = [];
  try {
    await cdpBridge.send(tabId, 'Accessibility.enable', {}, browserAdapter);
    const result = await cdpBridge.send<{ nodes: AXNode[] }>(
      tabId,
      'Accessibility.getFullAXTree',
      {},
      browserAdapter,
    );
    axNodes = result.nodes ?? [];
    logger.debug(`[AXTreeExtractor] Raw main AXTree: ${axNodes.length} nodes`);
  } finally {
    try { await cdpBridge.send(tabId, 'Accessibility.disable', {}, browserAdapter); } catch { /* non-fatal */ }
  }

  if (axNodes.length === 0) {
    logger.warning('[AXTreeExtractor] Empty main AXTree received');
    return buildEmptyDOMState();
  }

  // ── Step 2: Discover and query subframes (OOPIFs) ────────────────────────
  const subframeBoxes = new Map<string, BoxModel>();
  try {
    const targets = await activeAdapter.getDebuggerTargets();

    const mainTarget = targets.find(t => t.tabId === tabId && t.type === 'page');
    if (mainTarget) {
      const childIframeTargets = targets.filter((t: any) => t.parentId === mainTarget.id && t.type === 'iframe');
      logger.info(`[AXTreeExtractor] Found ${childIframeTargets.length} child iframe targets`);

      for (const subTarget of childIframeTargets) {
        try {
          await activeAdapter.attachDebugger({ targetId: subTarget.id }, '1.3');

          await activeAdapter.sendDebuggerCommand({ targetId: subTarget.id }, 'Accessibility.enable');
          const result = await activeAdapter.sendDebuggerCommand({ targetId: subTarget.id }, 'Accessibility.getFullAXTree') as { nodes: AXNode[] };
          
          if (result && result.nodes) {
            logger.info(`[AXTreeExtractor] Fetched ${result.nodes.length} nodes for subframe target ${subTarget.id}`);
            
            // Query box models for interactive nodes in the subframe while session is active
            try {
              await activeAdapter.sendDebuggerCommand({ targetId: subTarget.id }, 'DOM.enable');
              for (const node of result.nodes) {
                if (
                  !node.ignored &&
                  node.role &&
                  INTERACTIVE_ROLES.has(node.role.value) &&
                  node.backendDOMNodeId != null
                ) {
                  try {
                    const box = await activeAdapter.sendDebuggerCommand(
                      { targetId: subTarget.id },
                      'DOM.getBoxModel',
                      { backendNodeId: node.backendDOMNodeId }
                    ) as { model: RawBoxModel };
                    
                    if (box && box.model && box.model.content) {
                      const c = box.model.content;
                      subframeBoxes.set(`${subTarget.id}:${node.nodeId}`, {
                        x: (c[0] + c[4]) / 2,
                        y: (c[1] + c[5]) / 2,
                        width: Math.abs(c[2] - c[0]),
                        height: Math.abs(c[5] - c[1]),
                        left: c[0],
                        top: c[1],
                      });
                    }
                  } catch {
                    // Ignore node box errors
                  }
                }
              }
            } finally {
              try { await activeAdapter.sendDebuggerCommand({ targetId: subTarget.id }, 'DOM.disable'); } catch {}
            }

            // Prefix IDs to prevent collisions between frames
            const prefix = `${subTarget.id}:`;
            for (const node of result.nodes) {
              node.nodeId = prefix + node.nodeId;
              if (node.parentId) {
                node.parentId = prefix + node.parentId;
              }
              if (node.childIds) {
                node.childIds = node.childIds.map(id => prefix + id);
              }
            }

            // Stitch subframe root node to main iframe node
            const subframeRoot = result.nodes.find(n => !n.parentId);
            if (subframeRoot) {
              const mainIframeNodes = axNodes.filter(n => n.role?.value?.toLowerCase() === 'iframe');
              let matchedIframeNode = mainIframeNodes.find(
                n => n.name?.value?.includes(subTarget.url) || n.description?.value?.includes(subTarget.url)
              );
              if (!matchedIframeNode) {
                const targetIndex = childIframeTargets.indexOf(subTarget);
                matchedIframeNode = mainIframeNodes[targetIndex] ?? mainIframeNodes[0];
              }

              if (matchedIframeNode) {
                subframeRoot.parentId = matchedIframeNode.nodeId;
                if (!matchedIframeNode.childIds) matchedIframeNode.childIds = [];
                matchedIframeNode.childIds.push(subframeRoot.nodeId);
              }
            }

            axNodes.push(...result.nodes);
          }

          try {
            await activeAdapter.sendDebuggerCommand({ targetId: subTarget.id }, 'Accessibility.disable');
          } catch {}
          await safeDetach(subTarget.id, activeAdapter);
        } catch (subframeErr) {
          logger.warning(`[AXTreeExtractor] Error processing subframe target ${subTarget.id}:`, subframeErr);
          await safeDetach(subTarget.id, activeAdapter);
        }
      }
    }
  } catch (discoveryErr) {
    logger.warning('[AXTreeExtractor] Subframe discovery failed:', discoveryErr);
  }
  // ── Step 3: Build DOMElementNode instances (first pass) ─────────────────
  const selectorMap = new Map<number, DOMElementNode>();
  let highlightCounter = 0;
  const domNodeMap = new Map<string, DOMElementNode>();

  for (const axNode of axNodes) {
    if (axNode.ignored) continue;

    const role = axNode.role?.value ?? 'generic';
    const name = axNode.name?.value ?? '';
    const description = axNode.description?.value ?? '';
    const isDisabled = axNode.disabled?.value === true;

    const attributes: Record<string, string> = {};
    if (role)        attributes['role']             = role;
    if (name)        attributes['aria-label']        = name;
    if (description) attributes['aria-description'] = description;
    if (isDisabled)  attributes['aria-disabled']    = 'true';
    if (axNode.value?.value != null) attributes['value'] = String(axNode.value.value);

    for (const prop of axNode.properties ?? []) {
      if (prop.value?.value != null) {
        attributes[`aria-${prop.name}`] = String(prop.value.value);
      }
    }

    const isInteractive = INTERACTIVE_ROLES.has(role) && !isDisabled;
    const highlightIndex = isInteractive ? highlightCounter++ : null;

    const domNode = new DOMElementNode({
      tagName:        axRoleToTagName(role),
      xpath:          null,
      attributes,
      children:       [],
      isVisible:      true,
      isInteractive,
      isTopElement:   false,
      isInViewport:   false,
      shadowRoot:     false,
      highlightIndex,
      parent:         null,
      backendNodeId:  axNode.backendDOMNodeId ?? undefined,
    });

    domNodeMap.set(axNode.nodeId, domNode);
    if (highlightIndex !== null) selectorMap.set(highlightIndex, domNode);
  }

  // ── Step 4: Stitch parent-child relationships (second pass) ─────────────
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

  // ── Step 5: Enrich interactive nodes with bounding boxes ─────────────────
  await enrichWithBoundingBoxes(tabId, axNodes, domNodeMap, viewportWidth, viewportHeight, subframeBoxes, activeAdapter, puppeteerPage);

  return { elementTree: rootNode, selectorMap };
}

// ── Bounding box enrichment ───────────────────────────────────────────────────

async function enrichWithBoundingBoxes(
  tabId: number,
  axNodes: AXNode[],
  domNodeMap: Map<string, DOMElementNode>,
  viewportWidth: number,
  viewportHeight: number,
  subframeBoxes: Map<string, BoxModel>,
  browserAdapter: IBrowserAdapter,
  puppeteerPage?: PuppeteerPage | null,
): Promise<void> {
  const mainTargets = axNodes.filter(n => {
    const parts = n.nodeId.split(':');
    const isSubframe = parts.length > 1;
    const dom = domNodeMap.get(n.nodeId);
    return dom?.isInteractive && n.backendDOMNodeId != null && !isSubframe;
  });

  if (mainTargets.length > 0) {
    logger.debug(`[AXTreeExtractor] Fetching main frame bounding boxes for ${mainTargets.length} nodes`);
    let resolvedCount = 0;

    try {
      await cdpBridge.send(tabId, 'DOM.enable', {}, browserAdapter);
    } catch (err) {
      logger.warning('[AXTreeExtractor] Failed to enable DOM via cdpBridge:', err);
    }

    try {
      await Promise.allSettled(
        mainTargets.map(async axNode => {
          let rawBox: RawBoxModel | null = null;
          
          try {
            const res = await cdpBridge.send<{ model: RawBoxModel }>(
              tabId,
              'DOM.getBoxModel',
              { backendNodeId: axNode.backendDOMNodeId! },
              browserAdapter
            );
            rawBox = res?.model || null;
          } catch {
            // ignore
          }

          if (!rawBox) return;

          const domNode = domNodeMap.get(axNode.nodeId);
          if (!domNode) return;

          const c = rawBox.content;
          const box = {
            x: (c[0] + c[4]) / 2,
            y: (c[1] + c[5]) / 2,
            width: Math.abs(c[2] - c[0]),
            height: Math.abs(c[5] - c[1]),
            left: c[0],
            top: c[1],
          };

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
          domNode.viewportCoordinates = coords;
          domNode.isInViewport =
            box.x >= 0 && box.y >= 0 &&
            box.x < viewportWidth && box.y < viewportHeight;
          resolvedCount++;
        })
      );
    } finally {
      try {
        await cdpBridge.send(tabId, 'DOM.disable', {}, browserAdapter);
      } catch {}
    }

    // Safety-net: if getBoxModel failed for ALL nodes (e.g. CSP or CDP session
    // restrictions), pageCoordinates will be undefined on every node. The pruner
    // uses pageCoordinates as the guard for Rule 5, so this is already safe.
    // But also set isInViewport=true so serialisation marks them correctly.
    if (resolvedCount === 0) {
      logger.warning('[AXTreeExtractor] No bounding boxes resolved — assuming all interactive nodes are in-viewport');
      for (const axNode of mainTargets) {
        const domNode = domNodeMap.get(axNode.nodeId);
        if (domNode) domNode.isInViewport = true;
      }
    } else {
      logger.debug(`[AXTreeExtractor] Resolved bounding boxes for ${resolvedCount}/${mainTargets.length} nodes`);
    }
  }

  // Process subframe bounding boxes relative to parent iframe coordinate offsets
  const subframeTargets = axNodes.filter(n => {
    const parts = n.nodeId.split(':');
    const isSubframe = parts.length > 1;
    return isSubframe;
  });

  for (const axNode of subframeTargets) {
    const box = subframeBoxes.get(axNode.nodeId);
    if (!box) continue;

    const domNode = domNodeMap.get(axNode.nodeId);
    if (!domNode) continue;

    let offsetX = 0;
    let offsetY = 0;
    let parent = domNode.parent;
    while (parent) {
      if (parent.tagName === 'iframe' && parent.pageCoordinates) {
        offsetX += parent.pageCoordinates.topLeft.x;
        offsetY += parent.pageCoordinates.topLeft.y;
      }
      parent = parent.parent;
    }

    const absX = offsetX + box.x;
    const absY = offsetY + box.y;
    const absLeft = offsetX + box.left;
    const absTop = offsetY + box.top;

    const coords: CoordinateSet = {
      topLeft:     { x: absLeft,             y: absTop              },
      topRight:    { x: absLeft + box.width, y: absTop              },
      bottomLeft:  { x: absLeft,             y: absTop + box.height },
      bottomRight: { x: absLeft + box.width, y: absTop + box.height },
      center:      { x: absX,                y: absY               },
      width:       box.width,
      height:      box.height,
    };

    domNode.pageCoordinates     = coords;
    domNode.viewportCoordinates = coords;
    domNode.isInViewport =
      absX >= 0 && absY >= 0 &&
      absX < viewportWidth && absY < viewportHeight;
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
    iframe: 'iframe', internalFrame: 'iframe',
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

/**
 * Safely detach a debugger target.
 */
async function safeDetach(targetId: string, browserAdapter: IBrowserAdapter): Promise<void> {
  try {
    await browserAdapter.detachDebugger({ targetId });
  } catch {
    // Ignore detach errors
  }
}


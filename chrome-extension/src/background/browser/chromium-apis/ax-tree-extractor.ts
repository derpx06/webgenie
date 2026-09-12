/**
 * Page perception from the accessibility tree, read per frame through puppeteer's CDP sessions.
 *
 * - Accessibility.getFullAXTree for every frame through that frame's session: same-process frames share the
 *   page session, cross-site (out-of-process) iframes have their own.
 * - One DOMSnapshot.captureSnapshot per session gives every node's layout box, real tag name and a few attributes.
 * - Each child frame's tree is stitched under its owner <iframe> (DOM.getFrameOwner).
 *
 * buildDomState and documentLayout are pure so the tree rules are testable without a browser.
 */
import type { CDPSession } from 'puppeteer-core/lib/esm/puppeteer/api/CDPSession.js';
import type { Frame } from 'puppeteer-core/lib/esm/puppeteer/api/Frame.js';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import type { CoordinateSet } from '../dom/history/view';
import { DOMElementNode, DOMTextNode, type DOMState } from '../dom/views';
import { createLogger } from '@src/background/log';

const logger = createLogger('AXTreeExtractor');

const FRAME_TIMEOUT_MS = 3000;

export interface AXValue {
  type?: string;
  value?: unknown;
}

export interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: AXValue;
  name?: AXValue;
  description?: AXValue;
  value?: AXValue;
  properties?: Array<{ name: string; value?: AXValue }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

export interface NodeLayout {
  tagName: string;
  attributes: Record<string, string>;
  /** The page attached a click listener (or it is a natively clickable element). */
  clickable?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Layout of one document, in that document's coordinates (CSS pixels). */
export interface DocumentLayout {
  scrollX: number;
  scrollY: number;
  nodes: Map<number, NodeLayout>;
}

export interface FrameTree {
  key: string;
  parentKey?: string;
  /** backendNodeId of the <iframe> element in the parent frame that holds this frame. */
  hostBackendNodeId?: number;
  nodes: AXNode[];
  layout?: DocumentLayout;
  frame?: Frame;
}

export interface SnapshotDocument {
  frameId: number;
  nodes: { nodeName?: number[]; backendNodeId?: number[]; attributes?: number[][]; isClickable?: { index: number[] } };
  layout: { nodeIndex: number[]; bounds: number[][] };
  scrollOffsetX?: number;
  scrollOffsetY?: number;
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'slider',
  'spinbutton',
  'switch',
  'treeitem',
  'DisclosureTriangle',
  'date',
  'dateTime',
  'inputTime',
  'colorWell',
]);

/** Roles that carry nothing for the model: text boxes duplicate their StaticText, markers and scrollbars are chrome. */
const SKIPPED_ROLES = new Set(['InlineTextBox', 'LineBreak', 'ListMarker', 'scrollbar']);

/** Non-interactive roles whose accessible name is not page text. */
const UNNAMED_ROLES = new Set(['RootWebArea', 'WebArea', 'generic', 'none', 'presentation']);

/** Properties that stay meaningful when false (a state the model may need to change). */
const STATE_PROPERTIES = new Set(['checked', 'expanded', 'selected', 'pressed']);

/** Properties used only to decide interactivity. */
const INTERNAL_PROPERTIES = new Set(['focusable', 'focused', 'editable', 'settable', 'root', 'hiddenRoot']);

/** DOM attributes the accessibility tree does not expose but the model needs (a password or date field). */
const SNAPSHOT_ATTRIBUTES = new Set(['type', 'name', 'placeholder', 'draggable']);

const ROLE_TAGS: Record<string, string> = {
  button: 'button',
  link: 'a',
  textbox: 'input',
  searchbox: 'input',
  checkbox: 'input',
  radio: 'input',
  slider: 'input',
  spinbutton: 'input',
  switch: 'input',
  option: 'option',
  menuitem: 'li',
  menuitemcheckbox: 'li',
  menuitemradio: 'li',
  treeitem: 'li',
  heading: 'h2',
  paragraph: 'p',
  image: 'img',
  img: 'img',
  list: 'ul',
  listitem: 'li',
  table: 'table',
  row: 'tr',
  cell: 'td',
  gridcell: 'td',
  columnheader: 'th',
  rowheader: 'th',
  Iframe: 'iframe',
  dialog: 'dialog',
  navigation: 'nav',
  main: 'main',
  form: 'form',
};

/**
 * Maps each backendNodeId with a layout box to its box, tag name and selected attributes. Snapshot boxes and
 * scroll offsets are in device pixels; `scale` (device pixels per CSS pixel) converts them to CSS pixels.
 */
export function documentLayout(doc: SnapshotDocument, strings: string[], scale = 1): DocumentLayout {
  const nodes = new Map<number, NodeLayout>();
  const nodeName = doc.nodes.nodeName ?? [];
  const backendNodeId = doc.nodes.backendNodeId ?? [];
  const attributes = doc.nodes.attributes ?? [];
  const clickable = new Set(doc.nodes.isClickable?.index ?? []);
  doc.layout.nodeIndex.forEach((nodeIndex, i) => {
    const id = backendNodeId[nodeIndex];
    const bounds = doc.layout.bounds[i];
    // A node can own several layout objects (line boxes); the first is its own box.
    if (id === undefined || !bounds || nodes.has(id)) return;
    const selected: Record<string, string> = {};
    const pairs = attributes[nodeIndex] ?? [];
    for (let j = 0; j + 1 < pairs.length; j += 2) {
      const name = strings[pairs[j]];
      if (SNAPSHOT_ATTRIBUTES.has(name)) selected[name] = strings[pairs[j + 1]] ?? '';
    }
    nodes.set(id, {
      tagName: (strings[nodeName[nodeIndex]] ?? '').toLowerCase(),
      attributes: selected,
      clickable: clickable.has(nodeIndex),
      x: bounds[0] / scale,
      y: bounds[1] / scale,
      width: bounds[2] / scale,
      height: bounds[3] / scale,
    });
  });
  return { scrollX: (doc.scrollOffsetX ?? 0) / scale, scrollY: (doc.scrollOffsetY ?? 0) / scale, nodes };
}

function coordinates(x: number, y: number, width: number, height: number): CoordinateSet {
  return {
    topLeft: { x, y },
    topRight: { x: x + width, y },
    bottomLeft: { x, y: y + height },
    bottomRight: { x: x + width, y: y + height },
    center: { x: x + width / 2, y: y + height / 2 },
    width,
    height,
  };
}

function propertyMap(node: AXNode): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const property of node.properties ?? []) props[property.name] = property.value?.value;
  return props;
}

function nodeAttributes(role: string, name: string, node: AXNode, props: Record<string, unknown>, layout?: NodeLayout) {
  const attributes: Record<string, string> = { ...layout?.attributes };
  if (role) attributes.role = role;
  if (name) attributes['aria-label'] = name;
  const description = String(node.description?.value ?? '').trim();
  if (description) attributes['aria-description'] = description;
  if (node.value?.value !== undefined && node.value.value !== null) attributes.value = String(node.value.value);
  for (const [property, value] of Object.entries(props)) {
    if (INTERNAL_PROPERTIES.has(property) || value === undefined || value === null || value === '') continue;
    // Relations (labelledby, controls, ...) point at other nodes; they are not values.
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    if (property === 'url') {
      attributes.href = String(value);
      continue;
    }
    if ((value === false || value === 'false') && !STATE_PROPERTIES.has(property)) continue;
    attributes[`aria-${property.toLowerCase()}`] = String(value);
  }
  return attributes;
}

/**
 * Builds the element tree and selector map from per-frame accessibility trees.
 * Ignored nodes create nothing and their children attach to the nearest kept ancestor, so text under
 * ignored wrappers (html, body, most divs) stays in the tree. Interactive nodes are indexed 0..n-1 in
 * document order across frames.
 */
export function buildDomState(frames: FrameTree[], viewport: { width: number; height: number } | null): DOMState {
  const elementTree = new DOMElementNode({
    tagName: 'body',
    xpath: '',
    attributes: {},
    children: [],
    isVisible: true,
    isTopElement: true,
  });
  const selectorMap = new Map<number, DOMElementNode>();
  const keys = new Set(frames.map(frame => frame.key));
  const attached = new Set<string>();
  const main = frames.find(frame => !frame.parentKey || !keys.has(frame.parentKey));
  // Highlights are drawn in the main document, which scrolls with the page.
  const pageScrollX = main?.layout?.scrollX ?? 0;
  const pageScrollY = main?.layout?.scrollY ?? 0;

  const visitFrame = (tree: FrameTree, parent: DOMElementNode, offset: { x: number; y: number }): void => {
    attached.add(tree.key);
    const nodesById = new Map(tree.nodes.map(node => [node.nodeId, node]));
    const childFrames = frames.filter(frame => frame.parentKey === tree.key && frame.hostBackendNodeId !== undefined);
    const visited = new Set<string>();
    const scrollX = tree.layout?.scrollX ?? 0;
    const scrollY = tree.layout?.scrollY ?? 0;

    /** Returns whether the subtree produced any text. */
    const visit = (node: AXNode, into: DOMElementNode, insideControl: boolean): boolean => {
      if (visited.has(node.nodeId)) return false;
      visited.add(node.nodeId);
      const role = String(node.role?.value ?? '');
      if (SKIPPED_ROLES.has(role)) return false;
      const name = String(node.name?.value ?? '').trim();

      if (role === 'StaticText') {
        if (!name) return false;
        into.children.push(new DOMTextNode(name, true, into));
        return true;
      }

      const layout = node.backendDOMNodeId !== undefined ? tree.layout?.nodes.get(node.backendDOMNodeId) : undefined;
      const rect = layout && {
        x: offset.x + layout.x - scrollX,
        y: offset.y + layout.y - scrollY,
        width: layout.width,
        height: layout.height,
      };

      const visitChildren = (target: DOMElementNode, childrenInsideControl: boolean): boolean => {
        let text = false;
        for (const id of node.childIds ?? []) {
          const child = nodesById.get(id);
          if (child && visit(child, target, childrenInsideControl)) text = true;
        }
        for (const childFrame of childFrames) {
          if (childFrame.hostBackendNodeId === node.backendDOMNodeId && !attached.has(childFrame.key)) {
            visitFrame(childFrame, target, rect ? { x: rect.x, y: rect.y } : offset);
            text = true;
          }
        }
        return text;
      };

      if (node.ignored) return visitChildren(into, insideControl);

      const props = propertyMap(node);
      const interactive =
        INTERACTIVE_ROLES.has(role) ||
        (Boolean(props.editable) && props.focusable === true) ||
        (role === 'gridcell' && props.focusable === true);
      // Elements the page itself made pointer targets — a script click listener, draggable="true", an image —
      // get an index too, unless a control already surrounds them or they are page-sized wrappers.
      const pointerCandidate =
        !interactive &&
        !insideControl &&
        Boolean(layout && rect) &&
        (layout?.attributes.draggable === 'true' || Boolean(layout?.clickable) || role === 'image' || role === 'img') &&
        rect!.width >= 8 &&
        rect!.height >= 8 &&
        (!viewport || rect!.width * rect!.height <= 0.5 * viewport.width * viewport.height);
      const coords = rect && coordinates(rect.x, rect.y, rect.width, rect.height);
      const pageCoords = rect && coordinates(rect.x + pageScrollX, rect.y + pageScrollY, rect.width, rect.height);
      const element = new DOMElementNode({
        tagName: layout?.tagName || ROLE_TAGS[role] || 'div',
        xpath: null,
        attributes: nodeAttributes(role, name, node, props, layout),
        children: [],
        isVisible: true,
        isInteractive: interactive,
        isTopElement: true,
        // Without a layout box the position is unknown; never mark such an element offscreen.
        isInViewport:
          !rect || !viewport ||
          (rect.x + rect.width > 0 && rect.y + rect.height > 0 && rect.x < viewport.width && rect.y < viewport.height),
        highlightIndex: interactive ? selectorMap.size : null,
        viewportCoordinates: coords,
        pageCoordinates: pageCoords,
        parent: into,
        backendNodeId: node.backendDOMNodeId,
        frame: tree.frame,
        frameKey: tree.key,
      });
      if (interactive) selectorMap.set(selectorMap.size, element);
      into.children.push(element);

      const indexedBefore = selectorMap.size;
      const hasText = visitChildren(element, insideControl || interactive);
      // Only a leaf-most target: a clickable card that contains a real button keeps the button as the target.
      if (pointerCandidate && selectorMap.size === indexedBefore) {
        element.isInteractive = true;
        element.highlightIndex = selectorMap.size;
        selectorMap.set(selectorMap.size, element);
      }
      // A named image, region or heading without text children shows its name as text; for interactive
      // nodes the name stays an attribute.
      if (!interactive && name && !hasText && !UNNAMED_ROLES.has(role)) {
        element.children.unshift(new DOMTextNode(name, true, element));
        return true;
      }
      return hasText;
    };

    const root = tree.nodes.find(node => !node.parentId || !nodesById.has(node.parentId));
    if (root) visit(root, parent, false);
  };

  if (main) visitFrame(main, elementTree, { x: 0, y: 0 });
  // Frames whose owner element was not found still belong to the page.
  for (const frame of frames) {
    if (!attached.has(frame.key)) visitFrame(frame, elementTree, { x: 0, y: 0 });
  }
  return { elementTree, selectorMap };
}

// ponytail: frame.client and frame._id are puppeteer internals (pinned 24.31.0); replace with a public
// per-frame session API if puppeteer adds one.
type FrameInternals = { client: CDPSession; _id: string };
const internals = (frame: Frame) => frame as unknown as FrameInternals;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readFrame(frame: Frame): Promise<FrameTree | null> {
  const { client, _id: key } = internals(frame);
  const parent = frame.parentFrame();
  try {
    const [tree, hostBackendNodeId] = await Promise.all([
      withTimeout(client.send('Accessibility.getFullAXTree', { frameId: key }), FRAME_TIMEOUT_MS),
      parent
        ? withTimeout(internals(parent).client.send('DOM.getFrameOwner', { frameId: key }), FRAME_TIMEOUT_MS).then(
          owner => owner.backendNodeId,
          () => undefined,
        )
        : undefined,
    ]);
    return {
      key,
      parentKey: parent ? internals(parent)._id : undefined,
      hostBackendNodeId,
      nodes: tree.nodes as unknown as AXNode[],
      frame,
    };
  } catch (error) {
    logger.warning(`Skipping frame ${frame.url()}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function readLayouts(sessions: CDPSession[], scale: number): Promise<Map<string, DocumentLayout>> {
  const layouts = new Map<string, DocumentLayout>();
  await Promise.all(
    sessions.map(async client => {
      try {
        const snapshot = await withTimeout(client.send('DOMSnapshot.captureSnapshot', { computedStyles: [] }), FRAME_TIMEOUT_MS);
        for (const doc of snapshot.documents) {
          layouts.set(snapshot.strings[doc.frameId], documentLayout(doc as unknown as SnapshotDocument, snapshot.strings, scale));
        }
      } catch (error) {
        logger.warning(`Layout snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return layouts;
}

/** Reads every attached frame of the page into one DOMState. */
export async function getAXTreeState(page: PuppeteerPage): Promise<DOMState> {
  const frames = page.frames().filter(frame => !frame.detached);
  const mainClient = internals(page.mainFrame()).client;
  const metrics = await withTimeout(mainClient.send('Page.getLayoutMetrics'), FRAME_TIMEOUT_MS).catch(() => null);
  const viewport = metrics && { width: metrics.cssVisualViewport.clientWidth, height: metrics.cssVisualViewport.clientHeight };
  // Device pixels per CSS pixel (display scaling, zoom): layout snapshots report device pixels.
  const ratio = metrics ? metrics.visualViewport.clientWidth / metrics.cssVisualViewport.clientWidth : 1;
  const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const [trees, layouts] = await Promise.all([
    Promise.all(frames.map(readFrame)),
    readLayouts([...new Set(frames.map(frame => internals(frame).client))], scale),
  ]);
  const available = trees.filter((tree): tree is FrameTree => tree !== null);
  for (const tree of available) tree.layout = layouts.get(tree.key);
  const state = buildDomState(available, viewport);
  logger.info(`${state.selectorMap.size} interactive elements from ${available.length}/${frames.length} frames`);
  return state;
}

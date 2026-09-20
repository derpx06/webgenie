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
/** A second, longer try for a main document too large to read in FRAME_TIMEOUT_MS. */
const LARGE_PAGE_TIMEOUT_MS = 12000;

interface AXValue {
  type?: string;
  value?: unknown;
}

export interface AXNode {
  nodeId: string;
  ignored?: boolean;
  ignoredReasons?: Array<{ name: string; value?: AXValue }>;
  role?: AXValue;
  name?: AXValue;
  description?: AXValue;
  value?: AXValue;
  properties?: Array<{ name: string; value?: AXValue }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

interface NodeLayout {
  tagName: string;
  attributes: Record<string, string>;
  /** The page attached a click listener (or it is a natively clickable element). */
  clickable?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius in CSS pixels, so the overlay can glow in the element's own shape. */
  radius?: number;
  /** A scroll container's hidden content, in screens of its own visible height; the outermost one only. */
  scroll?: { above: number; below: number };
}

/** Layout of one document, in that document's coordinates (CSS pixels). */
export interface DocumentLayout {
  scrollX: number;
  scrollY: number;
  nodes: Map<number, NodeLayout>;
}

/** Overflow settings that scroll rather than cut the content off. */
const SCROLLING_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

/** The root scrollers are the page itself, which `scroll` moves without an index. */
const ROOT_TAGS = new Set(['html', 'body']);

export interface FrameTree {
  key: string;
  /** The frame's document URL; links to the same site are shown as paths. */
  url?: string;
  parentKey?: string;
  /** backendNodeId of the <iframe> element in the parent frame that holds this frame. */
  hostBackendNodeId?: number;
  nodes: AXNode[];
  layout?: DocumentLayout;
  /** backendNodeIds of elements with their own pointer listeners (click, right-click, press, hover, drag). */
  pointerListeners?: Set<number>;
  frame?: Frame;
}

export interface SnapshotDocument {
  frameId: number;
  nodes: {
    nodeName?: number[];
    backendNodeId?: number[];
    attributes?: number[][];
    parentIndex?: number[];
    isClickable?: { index: number[] };
    inputChecked?: { index: number[] };
  };
  layout: {
    nodeIndex: number[];
    bounds: number[][];
    styles?: number[][];
    /** Visible box of a scroll container, and the box its content scrolls in (includeDOMRects). */
    clientRects?: number[][];
    scrollRects?: number[][];
  };
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
  // Roles Chrome has no ARIA name for are reported as its internal name (a date input, a color well).
  'DisclosureTriangle',
  'Date',
  'DateTime',
  'InputTime',
  'ColorWell',
]);

/** Native date and time inputs: the value they take, which is never what their segments show. */
const DATE_FORMATS: Record<string, string> = {
  date: 'YYYY-MM-DD',
  time: 'HH:MM',
  'datetime-local': 'YYYY-MM-DDTHH:MM',
  month: 'YYYY-MM',
  week: 'YYYY-Www',
};

/** Chrome's internal roles for the same inputs, for a field the layout snapshot did not reach. */
const DATE_ROLES = new Set(['Date', 'DateTime', 'InputTime']);

/** Listener types that make an element a pointer target for the user. */
const POINTER_EVENTS = new Set([
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'mouseover',
  'mouseenter',
  'pointerover',
  'pointerenter',
  'dragstart',
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

/** Computed styles asked of every layout node, in this order. */
const SNAPSHOT_STYLES = ['border-top-left-radius', 'overflow-x', 'overflow-y'] as const;
const STYLE = { radius: 0, overflowX: 1, overflowY: 2 };

/**
 * A CSS length as the snapshot reports it, in CSS pixels; a percentage resolves against the element's shorter side,
 * which is how a rounded corner is measured. Anything else (calc, a keyword, empty) is no radius at all.
 */
export function parseRadius(value: string | undefined, width: number, height: number): number | undefined {
  if (!value) return undefined;
  const match = /^([\d.]+)(px|%)$/.exec(value.trim());
  if (!match) return undefined;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return undefined;
  const pixels = match[2] === '%' ? (size / 100) * Math.min(width, height) : size;
  // A pill is drawn with a huge radius; cap it at half the box so the overlay never draws a bigger curve than the element.
  return Math.min(pixels, Math.min(width, height) / 2);
}

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
  Date: 'input',
  DateTime: 'input',
  InputTime: 'input',
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
  const scrollers = scrollContainers(doc, strings);
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
    const width = bounds[2] / scale;
    const height = bounds[3] / scale;
    nodes.set(id, {
      tagName: (strings[nodeName[nodeIndex]] ?? '').toLowerCase(),
      attributes: selected,
      clickable: clickable.has(nodeIndex),
      x: bounds[0] / scale,
      y: bounds[1] / scale,
      width,
      height,
      radius: parseRadius(strings[doc.layout.styles?.[i]?.[STYLE.radius] ?? -1], width, height),
      scroll: scrollers.get(nodeIndex),
    });
  });
  labelHiddenChoices(doc, strings, nodes);
  return { scrollX: (doc.scrollOffsetX ?? 0) / scale, scrollY: (doc.scrollOffsetY ?? 0) / scale, nodes };
}

/**
 * Elements whose content scrolls inside them, with how much of it sits outside their visible box (in screens of that
 * box). A page's own scrollbar is not one of them, and neither is a scroller inside another: the outermost one is the
 * handle `scroll {index}` needs, and nested ones only lengthen the list.
 */
function scrollContainers(doc: SnapshotDocument, strings: string[]): Map<number, { above: number; below: number }> {
  const found = new Map<number, { above: number; below: number }>();
  const { clientRects, scrollRects, styles, nodeIndex } = doc.layout;
  if (!clientRects || !scrollRects || !styles) return found;
  const parents = doc.nodes.parentIndex ?? [];
  const nodeName = doc.nodes.nodeName ?? [];
  const scrolling = new Set<number>();
  nodeIndex.forEach((node, i) => {
    const client = clientRects[i];
    const scroll = scrollRects[i];
    const overflow = strings[styles[i]?.[STYLE.overflowY] ?? -1];
    if (!client || !scroll || !SCROLLING_OVERFLOW.has(overflow)) return;
    if (ROOT_TAGS.has((strings[nodeName[node]] ?? '').toLowerCase())) return;
    const height = client[3];
    if (height <= 0 || scroll[3] <= height + 1) return;
    scrolling.add(node);
    // The node list is in document order, so an enclosing scroller has already been seen.
    for (let parent = parents[node]; parent !== undefined && parent >= 0; parent = parents[parent]) {
      if (scrolling.has(parent)) return;
    }
    const screens = (pixels: number) => Math.round((pixels / height) * 10) / 10;
    const above = screens(scroll[1]);
    const below = screens(scroll[3] - scroll[1] - height);
    if (above > 0 || below > 0) found.set(node, { above, below });
  });
  return found;
}

/**
 * A custom-styled checkbox or radio hides its input (no box) and draws its label, which is what gets clicked: the label
 * carries the input's state as checked="true|false", so the models can tell whether a filter took effect.
 */
function labelHiddenChoices(doc: SnapshotDocument, strings: string[], nodes: Map<number, NodeLayout>): void {
  const nodeName = doc.nodes.nodeName ?? [];
  const backendNodeId = doc.nodes.backendNodeId ?? [];
  const parents = doc.nodes.parentIndex ?? [];
  const checked = new Set(doc.nodes.inputChecked?.index ?? []);
  const tag = (i: number) => (strings[nodeName[i]] ?? '').toUpperCase();
  const attribute = (i: number, wanted: string) => {
    const pairs = doc.nodes.attributes?.[i] ?? [];
    for (let j = 0; j + 1 < pairs.length; j += 2) if (strings[pairs[j]] === wanted) return strings[pairs[j + 1]];
    return undefined;
  };
  const labelFor = new Map<string, number>();
  nodeName.forEach((_, i) => {
    const target = tag(i) === 'LABEL' ? attribute(i, 'for') : undefined;
    if (target) labelFor.set(target, i);
  });
  nodeName.forEach((_, i) => {
    if (tag(i) !== 'INPUT') return;
    const type = attribute(i, 'type')?.toLowerCase();
    if (type !== 'checkbox' && type !== 'radio') return;
    const box = nodes.get(backendNodeId[i]);
    if (box && box.width > 0 && box.height > 0) return;
    const id = attribute(i, 'id');
    let label = id ? labelFor.get(id) : undefined;
    for (let p = parents[i]; label === undefined && p !== undefined && p >= 0; p = parents[p]) {
      if (tag(p) === 'LABEL') label = p;
    }
    const labelBox = label !== undefined ? nodes.get(backendNodeId[label]) : undefined;
    if (labelBox) labelBox.attributes.checked = String(checked.has(i));
  });
}

/** What a scroller's line says about the content outside it, e.g. "1 screen above, 2.5 screens below". */
function scrollNote({ above, below }: { above: number; below: number }): string {
  const screens = (value: number, where: string) => (value > 0 ? `${value} ${value === 1 ? 'screen' : 'screens'} ${where}` : '');
  return [screens(above, 'above'), screens(below, 'below')].filter(Boolean).join(', ');
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

/** A same-site link as its path (shorter, and never cut mid-URL by the attribute limit); other links in full. */
function linkAddress(href: string, frameUrl?: string): string {
  try {
    const link = new URL(href);
    return frameUrl && new URL(frameUrl).origin === link.origin ? `${link.pathname}${link.search}${link.hash}` : href;
  } catch {
    return href;
  }
}

/** A native select with at most this many options lists their names; a longer one shows its option count. */
const MAX_LISTED_OPTIONS = 10;

/** The options under a native select's accessibility node, in order. */
function selectOptions(select: AXNode, nodesById: Map<string, AXNode>): Array<{ name: string; selected: boolean }> {
  const options: Array<{ name: string; selected: boolean }> = [];
  const seen = new Set<string>();
  const walk = (node: AXNode) => {
    for (const id of node.childIds ?? []) {
      const child = nodesById.get(id);
      if (!child || seen.has(id)) continue;
      seen.add(id);
      const role = String(child.role?.value ?? '');
      if (role === 'option' || role === 'MenuListOption') {
        options.push({ name: String(child.name?.value ?? '').trim(), selected: propertyMap(child).selected === true });
      } else {
        walk(child);
      }
    }
  };
  walk(select);
  return options;
}

/** "Skip to content" / "Skip navigation": a link to a fragment of the page it is on. */
export function isSkipLink(name: string, href: string, frameUrl?: string): boolean {
  if (!/^skip (to\b|navigation\b)/i.test(name.trim())) return false;
  try {
    const link = new URL(href);
    return Boolean(link.hash) && Boolean(frameUrl) && new URL(frameUrl!).href.split('#')[0] === link.href.split('#')[0];
  } catch {
    return false;
  }
}

function nodeAttributes(role: string, name: string, node: AXNode, props: Record<string, unknown>, layout?: NodeLayout, frameUrl?: string) {
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
      attributes.href = linkAddress(String(value), frameUrl);
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
      // aria-hidden content is not for reading (decoration, the agent's own status overlay, content inert behind a modal).
      const hiddenByAria = Boolean(node.ignoredReasons?.some(reason => reason.name === 'ariaHiddenElement' || reason.name === 'ariaHiddenSubtree'));

      if (role === 'StaticText') {
        if (!name || hiddenByAria) return false;
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

      // The page made this element a pointer target: a listener of its own, a native click action, draggable=true.
      const listenerTarget = node.backendDOMNodeId !== undefined && Boolean(tree.pointerListeners?.has(node.backendDOMNodeId));
      const pageTarget =
        !hiddenByAria && Boolean(layout) && (layout?.attributes.draggable === 'true' || Boolean(layout?.clickable) || listenerTarget);

      // A panel the page scrolls on its own: without a line of its own there is no index for `scroll {index}`, and a
      // live run scrolled the page eleven times for content that sat in one. Only the outermost one is listed.
      const scroller = !hiddenByAria && !insideControl && layout?.scroll !== undefined;

      // An ignored node creates nothing, unless the page made it a pointer target (an empty div with a handler).
      if (node.ignored && !pageTarget && !scroller) return visitChildren(into, insideControl);

      const props = propertyMap(node);
      // A keyboard skip link only moves focus within the page; listed, it was clicked as if it led somewhere.
      if (role === 'link' && isSkipLink(name, String(props.url ?? ''), tree.url)) return false;
      const interactive =
        INTERACTIVE_ROLES.has(role) ||
        (Boolean(props.editable) && props.focusable === true) ||
        (role === 'gridcell' && props.focusable === true);
      // Elements the page itself made pointer targets — a script click listener, a native click action, draggable="true" —
      // get an index too, unless a control already surrounds them or they are page-sized wrappers. So does a named image of
      // some size: hovering one can reveal content (a profile card with CSS-only hover, C5). Unnamed decorative images get
      // none, since indexing every picture only lengthens the element list.
      const namedImage = (role === 'image' || role === 'img') && Boolean(name) && Boolean(rect && rect.width >= 24 && rect.height >= 24);
      const pointerCandidate =
        !interactive &&
        !insideControl &&
        Boolean(layout && rect) &&
        (pageTarget || namedImage) &&
        rect!.width >= 8 &&
        rect!.height >= 8 &&
        (!viewport || rect!.width * rect!.height <= 0.5 * viewport.width * viewport.height);
      // A scroller that is not a control of its own is listed only so it can be scrolled: its line carries no text.
      const scrollOnly = scroller && !interactive;
      const coords = rect && coordinates(rect.x, rect.y, rect.width, rect.height);
      const pageCoords = rect && coordinates(rect.x + pageScrollX, rect.y + pageScrollY, rect.width, rect.height);
      const element = new DOMElementNode({
        tagName: layout?.tagName || ROLE_TAGS[role] || 'div',
        xpath: null,
        attributes: nodeAttributes(role, name, node, props, layout, tree.url),
        children: [],
        isVisible: true,
        isInteractive: interactive,
        isTopElement: true,
        // Without a layout box the position is unknown; never mark such an element offscreen.
        isInViewport:
          !rect || !viewport ||
          (rect.x + rect.width > 0 && rect.y + rect.height > 0 && rect.x < viewport.width && rect.y < viewport.height),
        highlightIndex: interactive || scrollOnly ? selectorMap.size : null,
        scrollOnly,
        viewportCoordinates: coords,
        pageCoordinates: pageCoords,
        cornerRadius: layout?.radius,
        parent: into,
        backendNodeId: node.backendDOMNodeId,
        frame: tree.frame,
        frameKey: tree.key,
      });
      if (interactive || scrollOnly) selectorMap.set(selectorMap.size, element);
      if (scroller && layout?.scroll) {
        element.attributes.scroll = scrollNote(layout.scroll);
        // A panel's wrapper role ("none", "generic") says nothing next to what it holds.
        if (UNNAMED_ROLES.has(role)) delete element.attributes.role;
      }
      into.children.push(element);

      // A native date or time input is one element too: its user-agent segments are spinbutton spans that take no text
      // (typing into one failed six times in a live run), while the input itself is set to a value in the format below.
      const inputType = layout?.tagName === 'input' ? layout.attributes.type : undefined;
      if (interactive && (DATE_ROLES.has(role) || (inputType !== undefined && inputType in DATE_FORMATS))) {
        if (!element.attributes.value) delete element.attributes.value;
        if (inputType) element.attributes.format = DATE_FORMATS[inputType];
        delete element.attributes.role;
        return false;
      }

      // A native <select> is one element: its options become a count (or their names when few), not one element each
      // (a country list listed 240). select_dropdown_option picks by visible text.
      const nativeSelect =
        interactive && (layout?.tagName === 'select' || (node.childIds ?? []).some(id => nodesById.get(id)?.role?.value === 'MenuListPopup'));
      if (nativeSelect) {
        const options = selectOptions(node, nodesById);
        const selected = options.find(option => option.selected)?.name;
        if (!element.attributes.value && selected) element.attributes.value = selected;
        element.attributes.options = options.length > MAX_LISTED_OPTIONS ? String(options.length) : options.map(option => option.name).join(' | ');
        return false;
      }

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

/** Elements in the frame with pointer listeners of their own: one call for the whole subtree, shadow roots included. */
async function readPointerListeners(frame: Frame, timeoutMs: number): Promise<Set<number>> {
  try {
    const documentHandle = await withTimeout(frame.evaluateHandle(() => document), timeoutMs);
    try {
      const objectId = documentHandle.remoteObject().objectId;
      if (!objectId) return new Set();
      const { listeners } = await withTimeout(
        internals(frame).client.send('DOMDebugger.getEventListeners', { objectId, depth: -1, pierce: true }),
        timeoutMs,
      );
      return new Set(
        listeners
          .filter(listener => POINTER_EVENTS.has(listener.type) && listener.backendNodeId !== undefined)
          .map(listener => listener.backendNodeId as number),
      );
    } finally {
      await documentHandle.dispose().catch(() => undefined);
    }
  } catch (error) {
    logger.warning(`Pointer listeners unavailable for ${frame.url()}: ${error instanceof Error ? error.message : String(error)}`);
    return new Set();
  }
}

async function readFrame(frame: Frame, timeoutMs = FRAME_TIMEOUT_MS): Promise<FrameTree | null> {
  const { client, _id: key } = internals(frame);
  const parent = frame.parentFrame();
  try {
    const [tree, hostBackendNodeId, pointerListeners] = await Promise.all([
      withTimeout(client.send('Accessibility.getFullAXTree', { frameId: key }), timeoutMs),
      parent
        ? withTimeout(internals(parent).client.send('DOM.getFrameOwner', { frameId: key }), timeoutMs).then(
          owner => owner.backendNodeId,
          () => undefined,
        )
        : undefined,
      readPointerListeners(frame, timeoutMs),
    ]);
    return {
      key,
      parentKey: parent ? internals(parent)._id : undefined,
      url: frame.url(),
      hostBackendNodeId,
      nodes: tree.nodes as unknown as AXNode[],
      pointerListeners,
      frame,
    };
  } catch (error) {
    logger.warning(`Skipping frame ${frame.url()}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function readLayouts(sessions: CDPSession[], scale: number, timeoutMs = FRAME_TIMEOUT_MS): Promise<Map<string, DocumentLayout>> {
  const layouts = new Map<string, DocumentLayout>();
  await Promise.all(
    sessions.map(async client => {
      try {
        const snapshot = await withTimeout(
          client.send('DOMSnapshot.captureSnapshot', { computedStyles: [...SNAPSHOT_STYLES], includeDOMRects: true }),
          timeoutMs,
        );
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
    Promise.all(frames.map(frame => readFrame(frame))),
    readLayouts([...new Set(frames.map(frame => internals(frame).client))], scale),
  ]);
  // A very large document can take longer than one frame's budget (a live read timed out on every step and the model,
  // told the page was empty, kept leaving it). Give the main document one longer try before giving up on it.
  const mainIndex = frames.indexOf(page.mainFrame());
  if (mainIndex >= 0 && !trees[mainIndex]) {
    logger.warning(`Main document not read in ${FRAME_TIMEOUT_MS}ms; retrying with ${LARGE_PAGE_TIMEOUT_MS}ms`);
    const mainKey = internals(page.mainFrame())._id;
    const [tree, retried] = await Promise.all([
      readFrame(page.mainFrame(), LARGE_PAGE_TIMEOUT_MS),
      layouts.has(mainKey) ? new Map<string, DocumentLayout>() : readLayouts([mainClient], scale, LARGE_PAGE_TIMEOUT_MS),
    ]);
    trees[mainIndex] = tree;
    for (const [key, layout] of retried) layouts.set(key, layout);
  }
  const available = trees.filter((tree): tree is FrameTree => tree !== null);
  for (const tree of available) tree.layout = layouts.get(tree.key);
  const state = buildDomState(available, viewport);
  if (mainIndex >= 0 && !trees[mainIndex]) state.unreadable = true;
  logger.info(`${state.selectorMap.size} interactive elements from ${available.length}/${frames.length} frames`);
  return state;
}

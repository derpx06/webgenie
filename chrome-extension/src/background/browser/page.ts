import 'webextension-polyfill';
import {
  connect,
  ExtensionTransport,
  type HTTPRequest,
  type HTTPResponse,
  type ProtocolType,
  type KeyInput,
} from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import type { Browser } from 'puppeteer-core/lib/esm/puppeteer/api/Browser.js';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import type { CDPSession } from 'puppeteer-core/lib/esm/puppeteer/api/CDPSession.js';
import type { Dialog } from 'puppeteer-core/lib/esm/puppeteer/api/Dialog.js';
import {
  removeHighlights as _removeHighlights,
  getScrollInfo as _getScrollInfo,
  drawHighlightOverlaysViaCoordinates,
} from './dom/service';
import { DOMElementNode, resolveByIdentity, type DOMState } from './dom/views';
import { blocksToMarkdown, extractReadBlocks, findNextPageHref, type ReadBlock } from './dom/read-page';
import {
  type BrowserContextConfig,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  type PageDialog,
  type PageState,
  URLNotAllowedError,
} from './views';
import { createLogger } from '@src/background/log';
import { record } from '@src/background/trace';
import { isUrlAllowed, isNewTabPage } from './util';
import { NetworkLog, type NetRecord } from './network-log';
import { getAXTreeState } from './chromium-apis/ax-tree-extractor';
import { pruneAXTree } from './dom/ax-tree-pruner';
import type { AgentPointerMessage } from '@extension/storage';
import type { IBrowserAdapter } from '../adapters/IBrowserAdapter';
import type { IStorageProvider } from '../adapters/IStorageProvider';
import { ChromeBrowserAdapter } from '../adapters/ChromeBrowserAdapter';
import { ChromeStorageProvider } from '../adapters/ChromeStorageProvider';


const logger = createLogger('Page');

/** A part of the viewport a screenshot shows, in CSS pixels from its top left, and whether to label what is in it. */
export interface ScreenshotOptions {
  clip?: { x: number; y: number; width: number; height: number };
  /** The page scroll the clip was measured at, so the element labels can be matched to it. */
  scrollY?: number;
  /** False leaves the index boxes off; the default draws them, as a whole-page screenshot always has. */
  annotate?: boolean;
}

/** The label boxes to draw: every element with a measured box, or, when the screenshot is clipped, only those it shows. */
export function highlightRects(
  selectorMap: Map<number, DOMElementNode>,
  shot?: ScreenshotOptions | null,
): Array<{ index: number; x: number; y: number; w: number; h: number }> {
  const rects: Array<{ index: number; x: number; y: number; w: number; h: number }> = [];
  // The clip is in viewport pixels and the boxes in page pixels, so the scroll at capture time joins them.
  const clip = shot?.clip;
  const top = clip ? clip.y + (shot?.scrollY ?? 0) : 0;
  for (const [index, element] of selectorMap.entries()) {
    const box = element.pageCoordinates;
    if (!box) continue;
    if (clip) {
      const left = box.center.x - box.width / 2;
      const boxTop = box.center.y - box.height / 2;
      if (left > clip.x + clip.width || left + box.width < clip.x) continue;
      if (boxTop > top + clip.height || boxTop + box.height < top) continue;
    }
    rects.push({ index, x: box.center.x, y: box.center.y, w: box.width, h: box.height });
  }
  return rects;
}

/** A region clamped to the viewport: a clip that reaches past it makes Chrome capture nothing at all. */
export function clampClip(
  region: ScreenshotOptions['clip'],
  view: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (!region) return { x: 0, y: 0, width: view.width, height: view.height };
  const x = Math.max(0, Math.min(region.x, view.width - 1));
  const y = Math.max(0, Math.min(region.y, view.height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(region.width + Math.min(0, region.x), view.width - x)),
    height: Math.max(1, Math.min(region.height + Math.min(0, region.y), view.height - y)),
  };
}

/**
 * Runs in the page: one JavaScript value as text a model can read. DOM nodes become their tag, identifying attributes
 * and text instead of `{}`, lists and objects are walked to a fixed depth, cycles are named, and the whole thing is cut
 * to `cap` characters, because an unbounded value is an unbounded prompt.
 */
export function serializeForModel(value: unknown, cap: number): string {
  const seen = new WeakSet<object>();
  const MAX_ITEMS = 100;
  const flat = (text: string, chars: number) => text.replace(/\s+/g, ' ').trim().slice(0, chars);

  const plain = (node: unknown, depth: number): unknown => {
    if (node === undefined) return '(undefined)';
    if (node === null || typeof node === 'boolean' || typeof node === 'number' || typeof node === 'string') return node;
    if (typeof node === 'function') return `[function ${(node as { name?: string }).name ?? ''}]`;
    if (typeof node === 'bigint' || typeof node === 'symbol') return String(node);
    const object = node as object;
    if (seen.has(object)) return '[circular]';
    seen.add(object);
    if (typeof Element !== 'undefined' && object instanceof Element) {
      const attributes = ['id', 'name', 'type', 'role', 'aria-label', 'href', 'value', 'class']
        .map(name => {
          const value = object.getAttribute(name);
          return value ? ` ${name}="${flat(value, 60)}"` : '';
        })
        .join('');
      return `<${object.tagName.toLowerCase()}${attributes}>${flat(object.textContent ?? '', 150)}`;
    }
    if (typeof Node !== 'undefined' && object instanceof Node) return flat((object as Node).textContent ?? '', 200);
    if (object instanceof Error) return `${object.name}: ${object.message}`;
    if (depth >= 5) return '[…]';
    const items =
      Array.isArray(object) ? object
        : object instanceof Set ? [...object]
          : typeof (object as ArrayLike<unknown>).length === 'number' && typeof (object as { item?: unknown }).item === 'function'
            ? Array.from(object as ArrayLike<unknown>)
            : null;
    if (items) {
      const shaped: unknown[] = items.slice(0, MAX_ITEMS).map(item => plain(item, depth + 1));
      if (items.length > MAX_ITEMS) shaped.push(`…${items.length - MAX_ITEMS} more`);
      return shaped;
    }
    const entries = object instanceof Map ? [...object].slice(0, MAX_ITEMS) : Object.keys(object).slice(0, MAX_ITEMS).map(key => [key, (object as Record<string, unknown>)[key]] as const);
    const shaped: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      try {
        shaped[String(key)] = plain(item, depth + 1);
      } catch {
        shaped[String(key)] = '[unreadable]';
      }
    }
    return shaped;
  };

  let text: string;
  try {
    const shaped = plain(value, 0);
    text = typeof shaped === 'string' ? shaped : (JSON.stringify(shaped) ?? String(shaped));
  } catch (error) {
    text = `[the value could not be read: ${error instanceof Error ? error.message : String(error)}]`;
  }
  return text.length > cap ? `${text.slice(0, cap)}…(cut at ${cap} characters)` : text;
}

/** Navigations wait for the document to be parsed; the next page read waits for the network to go idle. */
const NAVIGATION_OPTIONS = { waitUntil: 'domcontentloaded' as const, timeout: 15000 };

/** How long a gesture that asked for a new window waits for the browser to create its tab. */
const NEW_TAB_WAIT_MS = 2000;

/**
 * Runs in the page: the body's text, then the rendered text of each open shadow root (slotted content included),
 * labelled with its host like frames are, so text a web component renders is readable and locatable.
 * ponytail: shadow sections skip visibility checks and cap at 20 hosts / 500 chars each.
 */
function pageTextWithShadowRoots(): string {
  const text = document.body?.innerText ?? '';
  const hosts: Element[] = [];
  const collect = (root: Document | ShadowRoot) =>
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        hosts.push(el);
        collect(el.shadowRoot);
      }
    });
  collect(document);
  const rendered = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node instanceof Element && ['STYLE', 'SCRIPT', 'TEMPLATE'].includes(node.tagName)) return '';
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true });
      return (assigned.length > 0 ? assigned : Array.from(node.childNodes)).map(rendered).join(' ');
    }
    const children = node instanceof Element && node.shadowRoot ? [node.shadowRoot] : Array.from(node.childNodes);
    return children.map(rendered).join(' ');
  };
  const sections = hosts
    .slice(0, 20)
    .map(host => {
      const inner = rendered(host.shadowRoot as ShadowRoot).replace(/\s+/g, ' ').trim().slice(0, 500);
      return inner ? `[Shadow root of <${host.tagName.toLowerCase()}>] ${inner}` : '';
    })
    .filter(Boolean);
  return [text, ...sections].join('\n');
}

/** What submitting the form around an element would involve, read from the live page. */
export interface FormCommitInfo {
  inForm: boolean;
  /** The element (or the button it sits in) submits that form. */
  isSubmitter: boolean;
  /** The form asks for payment card or bank details. */
  paymentFields: boolean;
  submitLabels: string[];
}

/** Runs in the page: must stay self-contained. Without a start element, follows focus into shadow roots and same-origin frames. */
const inspectForm = (start: Element | null): FormCommitInfo => {
  let el: Element | null = start ?? document.activeElement;
  while (!start && el) {
    if (el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    else if (el instanceof HTMLIFrameElement && el.contentDocument?.activeElement) el = el.contentDocument.activeElement;
    else break;
  }
  const submitter = el?.closest('button, input[type="submit"], input[type="image"]') as HTMLButtonElement | HTMLInputElement | null;
  const form = submitter?.form ?? (el as HTMLInputElement | null)?.form ?? el?.closest('form') ?? null;
  if (!form) return { inForm: false, isSubmitter: false, paymentFields: false, submitLabels: [] };
  const controls = Array.from(form.elements) as HTMLInputElement[];
  const submits = (c: Element) => (c.tagName === 'BUTTON' && (c as HTMLButtonElement).type === 'submit') || (c.tagName === 'INPUT' && ['submit', 'image'].includes((c as HTMLInputElement).type));
  const describe = (c: HTMLInputElement) => `${c.autocomplete ?? ''} ${c.name ?? ''} ${c.id} ${c.getAttribute('aria-label') ?? ''} ${c.placeholder ?? ''}`;
  return {
    inForm: true,
    isSubmitter: !!submitter && submits(submitter),
    paymentFields: controls.some(c => /\bcc-|card.?(number|num)|cc.?num|\bcvc\b|\bcvv\b|\bcsc\b|\biban\b|security.?code/i.test(describe(c))),
    submitLabels: controls
      .filter(submits)
      .map(c => ((c as HTMLElement).innerText || c.value || c.getAttribute('aria-label') || '').trim())
      .filter(Boolean),
  };
};

/** What a mouse gesture caused besides changing the page. */
export interface MouseOutcome {
  dialog?: PageDialog;
  fileChooser: boolean;
  /** The tab the gesture opened, once the browser has created it. */
  newTabId?: number;
}

export interface InputOutcome {
  matched: boolean;
  secret: boolean;
  actualLength: number;
  /** The field's value after typing; null for password fields. */
  actual: string | null;
}

const MODIFIER_KEYS: Record<string, KeyInput> = {
  ctrl: 'Control',
  control: 'Control',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  win: 'Meta',
  super: 'Meta',
};

const NAMED_KEYS: Record<string, KeyInput> = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}` as KeyInput])),
};

/**
 * Parses a key or shortcut ("Enter", "page down", "Control+Shift+T", "Control++") into puppeteer key names.
 * Named keys are case-insensitive; single characters keep their case; modifiers are never swapped per OS.
 */
export function normalizeKeyCombo(combo: string): { modifiers: KeyInput[]; key: KeyInput } {
  const trimmed = combo.trim();
  const parts = trimmed === '+' ? ['+'] : trimmed.endsWith('++') ? [...trimmed.slice(0, -2).split('+'), '+'] : trimmed.split('+');
  const names = parts.map(part => (part === '+' ? part : part.trim())).filter(Boolean);
  if (names.length === 0) {
    throw new Error('No key given');
  }
  const lookup = (name: string) => name.toLowerCase().replace(/[\s_-]/g, '');
  const modifiers = names.slice(0, -1).map(name => {
    const modifier = MODIFIER_KEYS[lookup(name)];
    if (!modifier) throw new Error(`Unknown modifier "${name}". Use Control, Shift, Alt or Meta.`);
    return modifier;
  });
  const last = names[names.length - 1];
  const key = last.length === 1 ? (last as KeyInput) : (NAMED_KEYS[lookup(last)] ?? MODIFIER_KEYS[lookup(last)]);
  if (!key) {
    throw new Error(`Unknown key "${last}". Use a single character or one of: ${[...new Set(Object.values(NAMED_KEYS))].join(', ')}`);
  }
  return { modifiers, key };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Where a pointer action on an element aims; runs in the page and must stay self-contained.
 *
 * An element with a box of its own is its own target. When it has none the page is drawing the control somewhere
 * else — a wrapping label, the div a custom combobox, tile or checkbox renders into, a sibling drawn next to a
 * hidden input — and that surface is what a person clicks. Aiming only at the element's own box made every such
 * control permanently unclickable while still being listed, so the model kept choosing it: four benchmark tasks
 * died that way, one after 38 refused clicks.
 *
 * The chain runs from the most certain surface to the least: the element's own `<label>` (the page states the
 * relation), then a descendant (inside it, so a click there can only mean this control), then the nearest ancestor,
 * then a sibling. Outside surfaces are only taken while they hold no *other* control — a click on them could not
 * mean anything else — and while they are not so large that their centre could be anywhere. Nothing in the chain
 * qualifies: the element is returned unchanged and the caller refuses, which is the honest answer for a control
 * that really is hidden.
 */
export function pointerTarget(el: Element): Element {
  const boxOf = (candidate: Element) => candidate.getBoundingClientRect();
  const hasBox = (candidate: Element) => {
    const rect = boxOf(candidate);
    return rect.width > 0 && rect.height > 0;
  };
  if (hasBox(el)) return el;

  const label = Array.from((el as HTMLInputElement).labels ?? []).find(hasBox);
  if (label) return label;

  // Inside the element: an inline wrapper around positioned content (a link wrapping an absolutely placed image).
  const descendant = Array.from(el.querySelectorAll('*')).find(hasBox);
  if (descendant) return descendant;

  const viewArea = typeof window === 'undefined' ? 0 : (window.innerWidth || 0) * (window.innerHeight || 0);
  const tooLarge = (candidate: Element) => {
    const rect = boxOf(candidate);
    return viewArea > 0 && rect.width * rect.height > viewArea / 2;
  };
  // A surface that contains some other control is that control's, not this element's; ancestors of `el` on the way
  // up are not "other", and the walk stops at them anyway because the nearest one is reached first. The selector is
  // inline because this function is serialized into the page, where module constants do not exist.
  const holdsOtherControl = (candidate: Element) =>
    Array.from(
      candidate.querySelectorAll(
        'a[href],button,input,select,textarea,summary,[onclick],[contenteditable=""],[contenteditable="true"],' +
          '[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="option"],' +
          '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="combobox"],[role="listbox"],' +
          '[role="textbox"],[role="searchbox"],[role="spinbutton"],[role="slider"],[role="treeitem"]',
      ),
    ).some(other => other !== el && !other.contains(el) && !el.contains(other));

  // ponytail: nearest qualifying ancestor, not the one the page gave a click listener — a listener cannot be read
  // from inside the page. The two guards below keep a wrong aim from being actionable; if traces show clicks landing
  // on inert wrappers, prefer an ancestor whose computed `cursor` is `pointer`.
  for (let node = el.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
    if (holdsOtherControl(node) || tooLarge(node)) break;
    if (hasBox(node)) return node;
  }
  const sibling = [el.nextElementSibling, el.previousElementSibling].find(
    candidate => candidate && hasBox(candidate) && !tooLarge(candidate) && !holdsOtherControl(candidate),
  );
  return sibling ?? el;
}

export interface CoverBlocker {
  /** Why the pointer action is refused; absent when it can go ahead at `offset`. */
  message?: string;
  /** Labels of the covering layer's buttons, so the model can close it. */
  buttons?: string[];
  /** Something else is on top of the element (not set for a disabled one). */
  covered?: boolean;
  /** Covered only by an empty box that is no dialog or fixed/sticky bar: nothing for the model to close. */
  clickThrough?: boolean;
  /** A point inside the element, from its top-left corner, that is not covered (the centre is). */
  offset?: { x: number; y: number };
}

/**
 * Why a pointer action on the element must not be sent, or null; runs in the page and must stay self-contained.
 * A covered centre tries four inner points and aims at the first free one. A covered target names what covers it:
 * its own or the focused field's open list, else the covering layer (the nearest dialog or fixed/sticky box, or the
 * open dialog whose backdrop it is) by its accessible name, heading or text, with that layer's buttons. A bare "<div>"
 * did not tell the model what to close (9 of 57 real-site traces). Nothing that holds the target is ever named: a
 * live refusal told the model to close the very dialog its option sat in, and it closed and reopened it until the
 * token cap.
 */
export function coverBlocker(el: Element, isHover: boolean, checkCovered: boolean): CoverBlocker | null {
  if (!isHover && ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true')) {
    return {
      message:
        'The element is disabled: the page turns it on once what it waits for is done (a required field filled, an option chosen, a term accepted). Do that first, or use another element',
    };
  }
  if (!checkCovered) return null;
  const rect = el.getBoundingClientRect();
  const root = el.getRootNode() as unknown as DocumentOrShadowRoot & ParentNode;
  const coverAt = (fx: number, fy: number) => {
    const hit = root.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return null;
    if ((hit.closest('label') as HTMLLabelElement | null)?.control === el) return null;
    return hit;
  };
  const hit = coverAt(0.5, 0.5);
  if (!hit) return null;
  for (const [fx, fy] of [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ]) {
    if (!coverAt(fx, fy)) return { offset: { x: rect.width * fx, y: rect.height * fy } };
  }

  const tag = (node: Element) => node.tagName.toLowerCase();
  const role = (node: Element) => (node.getAttribute('role') ?? '').toLowerCase();
  // Rendered text: textContent also holds <style> and <script> contents (a live refusal quoted "@media screen and ...").
  const textOf = (node: Element | null) => (node ? ((node as HTMLElement).innerText ?? '') : '');
  const clip = (value: string | null | undefined, max = 60) => {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const chain: Element[] = [];
  for (let node: Element | null = hit; node && !node.contains(el); node = node.parentElement) chain.push(node);

  // A list a field opened (suggestions, a menu): the target's own, or that of the field being typed into.
  const focused = root.activeElement;
  for (const owner of focused && focused !== el ? [el, focused] : [el]) {
    const ids = `${owner.getAttribute('aria-controls') ?? ''} ${owner.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean);
    const expanded = owner.getAttribute('aria-expanded') === 'true';
    const popup = chain.find(node => (node.id && ids.includes(node.id)) || (expanded && ['listbox', 'menu', 'tree', 'grid'].includes(role(node))));
    if (!popup) continue;
    const list = role(popup) === 'menu' ? 'menu' : 'list of suggestions';
    const field = clip(owner.getAttribute('aria-label') || (owner as HTMLInputElement).placeholder || (owner as HTMLInputElement).name, 40);
    const whose = owner === el ? `its own open ${list}` : `the open ${list} of the focused field${field ? ` "${field}"` : ''}`;
    return { message: `The element is covered by <${tag(hit)}> ${whose}: choose an option from it, or press Escape to close it first` };
  }

  const isDialog = (node: Element) =>
    ['dialog', 'alertdialog'].includes(role(node)) || tag(node) === 'dialog' || node.getAttribute('aria-modal') === 'true';
  const bar = chain.find(node => isDialog(node) || ['fixed', 'sticky'].includes(getComputedStyle(node).position));
  const layer = bar ?? hit;
  // A backdrop has no text of its own: the dialog it belongs to is what to close.
  const openDialog = textOf(layer).trim()
    ? null
    : (Array.from(root.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')).find(
        node => !node.contains(el) && node.getBoundingClientRect().width > 0 && textOf(node).trim(),
      ) ?? null);
  const named = openDialog ?? layer;
  const labelledBy = (named.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => textOf(named.ownerDocument.getElementById(id)))
    .join(' ');
  const name =
    clip(named.getAttribute('aria-label')) ||
    clip(labelledBy) ||
    clip(textOf(named.querySelector('h1, h2, h3, h4, [role="heading"], legend'))) ||
    clip(textOf(named)) ||
    clip(textOf(chain.find(node => textOf(node).trim()) ?? null));
  const kind = isDialog(named) ? 'dialog ' : ['alert', 'banner', 'region', 'complementary'].includes(role(named)) ? `${role(named)} ` : '';
  // Labelled as the accessibility tree names them, so they match the indexes of the page read.
  const buttons = Array.from(named.querySelectorAll('button, a[href], [role="button"], input[type="submit"], input[type="button"]'))
    .map(button => clip(button.getAttribute('aria-label') || textOf(button) || (button as HTMLInputElement).value || button.getAttribute('title'), 1000))
    .filter(label => label && label.length <= 40)
    .slice(0, 6);
  const what = `${kind}${name ? `"${name}"` : ''}`.trim();
  const message = openDialog
    ? `The element is covered by <${tag(layer)}> behind the ${what}`
    : `The element is covered by <${tag(layer)}>${what ? ` ${what}` : ''}`;
  return { covered: true, message, buttons, ...(!bar && !openDialog && !name && buttons.length === 0 && { clickThrough: true }) };
}

/**
 * Whether the element's box moves from one animation frame to the next: a sliding panel, a carousel or a list still
 * settling would take the click where the element was, not where it is. Runs in the page and must stay self-contained;
 * a frame that never comes (a throttled background tab) counts as still, so nothing is refused for want of an answer.
 */
export function boxMoving(el: Element): Promise<boolean> {
  const box = () => {
    const rect = el.getBoundingClientRect();
    return [rect.left, rect.top, rect.width, rect.height].map(value => Math.round(value)).join(',');
  };
  const before = box();
  return new Promise(resolve => {
    const giveUp = setTimeout(() => resolve(false), 250);
    requestAnimationFrame(() => {
      clearTimeout(giveUp);
      resolve(box() !== before);
    });
  });
}

/**
 * Whether a navigation is tried once more before anything reads the page: a transient network error, or a server
 * answer of 429 or 5xx. A name that does not resolve or a refused address is not retried: the second try answers
 * the same.
 */
export function needsReload(status?: number, errorMessage?: string): boolean {
  if (errorMessage !== undefined) {
    return /net::ERR_(CONNECTION_(RESET|CLOSED|ABORTED|TIMED_OUT)|TIMED_OUT|EMPTY_RESPONSE|NETWORK_CHANGED|HTTP2_PROTOCOL_ERROR|ADDRESS_UNREACHABLE|SOCKET_NOT_CONNECTED)/i.test(errorMessage);
  }
  return status === 429 || (status !== undefined && status >= 500 && status < 600);
}

/** Animation frames a target may still be moving in before the gesture is refused (Playwright waits for the same). */
const MOVING_CHECKS = 6;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * How text goes into a field. Key presses by default: widgets such as datepickers, masks and autocompletes read
 * what was typed from keyboard events and can overwrite a value that arrived without them. One insert for very
 * long text (speed), and for line breaks in a single-line input (Enter would submit the form).
 */
export function typingMethod(text: string, fieldType: string): 'keys' | 'insert' {
  if (text.length > 300) return 'insert';
  const multiline = fieldType === 'textarea' || fieldType === 'contenteditable';
  return text.includes('\n') && !multiline ? 'insert' : 'keys';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (value: number | string) => String(value).padStart(2, '0');

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function monthNumber(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/** yyyy-mm-dd from ISO (2024-05-20, 2024/05/20), numeric (05/20/2024; 20/05/2024 when the first part is over 12) or named (May 20, 2024; 20 May 2024). */
function parseDate(text: string): string | null {
  const t = text.trim().replace(/^[a-z]+,\s*/i, match => (monthNumber(match) ? match : ''));
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return +m[1] > 12 ? isoDate(+m[3], +m[2], +m[1]) : isoDate(+m[3], +m[1], +m[2]);
  m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(t);
  if (m && monthNumber(m[1])) return isoDate(+m[3], monthNumber(m[1]), +m[2]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(t);
  if (m && monthNumber(m[2])) return isoDate(+m[3], monthNumber(m[2]), +m[1]);
  return null;
}

/** HH:MM[:SS] from 24-hour (15:30) or 12-hour (3:30 PM, 3 pm) time. */
function parseTime(text: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i.exec(text.trim());
  if (!m || (!m[2] && !m[4])) return null;
  let hours = +m[1];
  const minutes = +(m[2] ?? 0);
  if (m[4]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (m[4].toLowerCase() === 'p' ? 12 : 0);
  }
  if (hours > 23 || minutes > 59 || (m[3] && +m[3] > 59)) return null;
  return `${pad(hours)}:${pad(minutes)}${m[3] ? `:${m[3]}` : ''}`;
}

/**
 * The value a native date, time, datetime-local or month input takes for text written the way a person would, or null
 * when the text is not such a value. Other input types keep the text. A date field typed key by key goes segment by
 * segment in the locale's order, and failed three times in a row on a real site; its value is set directly instead.
 */
export function toNativeInputValue(text: string, type: string): string | null {
  const t = text.trim();
  switch (type) {
    case 'date':
      return parseDate(t.replace(/T.*$/, ''));
    case 'time':
      return parseTime(t);
    case 'datetime-local': {
      const m = /^(.+?)(?:T|,?\s+at\s+|,\s*|\s+)(\d{1,2}(?::\d{2}){0,2}\s*(?:[ap]\.?m?\.?)?)$/i.exec(t);
      const date = m && parseDate(m[1]);
      const time = m && parseTime(m[2]);
      return date && time ? `${date}T${time}` : null;
    }
    case 'month': {
      const month = (year: number, value: number) => (value >= 1 && value <= 12 ? `${year}-${pad(value)}` : null);
      let m = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
      if (m) return month(+m[1], +m[2]);
      m = /^(\d{1,2})[-/.](\d{4})$/.exec(t);
      if (m) return month(+m[2], +m[1]);
      m = /^([a-z]+)\.?,?\s+(\d{4})$/i.exec(t);
      return m && monthNumber(m[1]) ? month(+m[2], monthNumber(m[1])) : null;
    }
    default:
      return text;
  }
}

/** A read with at most this many interactive elements may be a page that has not rendered its controls yet. */
export const SPARSE_READ_ELEMENTS = 2;

/**
 * Longest one page read may hold a step. A complete read of a heavy page legitimately spends a few seconds (the
 * accessibility tree of every frame, a retry on an empty DOM, settling a page that renders late), so the cap is set
 * where reads stop being reads: 37 of run r3's reads ran past 10 s, two of them for 221 s and 192 s.
 */
export const READ_STATE_CAP_MS = 10_000;

/**
 * Re-reads a sparse page (see SPARSE_READ_ELEMENTS) while it is likely still rendering: after a navigation, or while its
 * document loads. Stops as soon as controls appear, or once the document has loaded and re-reads found no more
 * elements (a page that really is that sparse costs one or two intervals), and never waits longer than maxWaitMs.
 */
export async function settleSparseRead<T extends { selectorMap: Map<number, unknown> }>(
  first: T,
  read: () => Promise<T | null>,
  documentLoading: () => Promise<boolean>,
  { justNavigated, maxWaitMs = 3000, intervalMs = 400 }: { justNavigated: boolean; maxWaitMs?: number; intervalMs?: number },
): Promise<T> {
  let state = first;
  if (state.selectorMap.size > SPARSE_READ_ELEMENTS || (!justNavigated && !(await documentLoading()))) return state;
  const deadline = Date.now() + maxWaitMs;
  let quiet = 0;
  while (Date.now() + intervalMs < deadline) {
    await sleep(intervalMs);
    const next = await read();
    // A failed re-read (the page moved on, a dialog opened) keeps the read already made; the next read starts over.
    if (!next) break;
    const grew = next.selectorMap.size > state.selectorMap.size;
    state = next;
    if (state.selectorMap.size > SPARSE_READ_ELEMENTS) break;
    quiet = grew ? 0 : quiet + 1;
    // No controls at all is rarer on a real page than a few, so it gets one more re-read.
    if (quiet >= (state.selectorMap.size === 0 ? 2 : 1) && !(await documentLoading())) break;
  }
  return state;
}

export function getAdaptiveDomRetryDelayMs(attempt: number): number {
  return Math.min(750, Math.max(250, attempt * 250));
}

export function build_initial_state(tabId?: number, url?: string, title?: string): PageState {
  return {
    elementTree: new DOMElementNode({
      tagName: 'root',
      isVisible: true,
      parent: null,
      xpath: '',
      attributes: {},
      children: [],
    }),
    selectorMap: new Map(),
    tabId: tabId || 0,
    url: url || '',
    title: title || '',
    screenshot: null,
    scrollY: 0,
    scrollHeight: 0,
    visualViewportHeight: 0,
  };
}

export default class Page {
  private _tabId: number;
  private _browser: Browser | null = null;
  private _puppeteerPage: PuppeteerPage | null = null;
  private _config: BrowserContextConfig;
  private _state: PageState;
  private _validWebPage = false;
  private _cachedState: PageState | null = null;
  /** Bumped by every invalidation: a read started under an older generation is never cached or joined. */
  private _generation = 0;
  private _pendingState: { generation: number; useVision: boolean; promise: Promise<PageState> } | null = null;
  /** URL of the last successful read; a read at a different URL waits for the page to load first. */
  private _lastReadUrl: string | null = null;
  /** URL whose sparse read was already waited on while its document loaded. */
  private _settledUrl: string | null = null;
  /** A JavaScript dialog left open for the agent to answer. */
  private _pendingDialog: Dialog | null = null;
  /** True while navigateTo/goBack/goForward/refreshPage run, so their own beforeunload prompt is accepted. */
  private _agentNavigating = false;
  private _fileChooserOpened = false;
  /** The page asked for a new window or tab (window.open, a target=_blank link or form) since the last gesture began. */
  private _windowOpened = false;
  /** The file input of the last chooser the page opened (intercepted), for uploadFile. */
  private _fileChooserNode: number | null = null;
  /** What this tab asked the network for, so sniff_api can show the site's own data endpoints. */
  private readonly _network = new NetworkLog();
  /** What the next screenshot shows and labels; set by view_screenshot and used once. */
  private _screenshotOptions: ScreenshotOptions | null = null;
  private _browserAdapter: IBrowserAdapter;
  private _storageProvider: IStorageProvider;

  constructor(
    tabId: number,
    url: string,
    title: string,
    config: Partial<BrowserContextConfig> = {},
    browserAdapter?: IBrowserAdapter,
    storageProvider?: IStorageProvider
  ) {
    this._tabId = tabId;
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this._state = build_initial_state(tabId, url, title);
    this._browserAdapter = browserAdapter || new ChromeBrowserAdapter();
    this._storageProvider = storageProvider || new ChromeStorageProvider();
    // chrome://newtab/, chrome://newtab/extensions, https://chromewebstore.google.com/ are not valid web pages, can't be attached
    const lowerCaseUrl = url.trim().toLowerCase();
    this._validWebPage =
      (tabId &&
        lowerCaseUrl &&
        lowerCaseUrl.startsWith('http') &&
        !lowerCaseUrl.startsWith('https://chromewebstore.google.com')) ||
      false;
  }

  get tabId(): number {
    return this._tabId;
  }

  get validWebPage(): boolean {
    return this._validWebPage;
  }

  get attached(): boolean {
    return this._validWebPage && this._puppeteerPage !== null;
  }

  /**
   * Re-evaluate whether this page is a valid web page based on a new URL.
   * Safe to call at any time; only promotes false→true, never demotes.
   */
  refreshValidWebPage(url: string): void {
    if (!url) return;
    const lower = url.trim().toLowerCase();
    if (lower.startsWith('http') && !lower.startsWith('https://chromewebstore.google.com')) {
      this._validWebPage = true;
    }
  }

  updateUrl(url: string): void {
    if (!url) return;
    const previousUrl = this._state.url;
    // Replaced, not mutated: the old object may be a state the agent is still comparing against.
    this._state = { ...this._state, url };
    this.refreshValidWebPage(url);

    // ── SPA Cache Invalidation ────────────────────────────────────────────────
    // When a SPA performs a client-side navigation (pushState / replaceState),
    // chrome.webNavigation.onHistoryStateUpdated fires and calls updateUrl().
    // The old _cachedState holds element indices from the PREVIOUS view — any
    // LLM action referencing those indices will fail with
    // "Element with index X does not exist".
    // Clearing the cache here forces a fresh DOM extraction on the next getState()
    // call, ensuring indices always match the currently rendered view.
    if (previousUrl && previousUrl !== url) {
      logger.info(`[SPA Nav] URL changed ${previousUrl} → ${url} — invalidating DOM cache`);
      this.invalidateCache();
    }
    // ─────────────────────────────────────────────────────────────────────────
  }

  /**
   * Re-checks the live tab URL and promotes _validWebPage if the tab has
   * navigated to a real page since construction. Called at the start of
   * getState() so we never return an empty state just because the Page was
   * constructed from a newtab URL.
   * Also tries to attach puppeteer so click/input actions work immediately.
   */
  private async _revalidateFromTab(): Promise<void> {
    if (this._validWebPage) return; // already valid, nothing to do
    try {
      const tab = await this._browserAdapter.getTab(this._tabId);
      this.refreshValidWebPage(tab.url ?? '');
      if (this._validWebPage) {
        // Update the cached state URL/title now that we know the real URL
        this._state = { ...this._state, url: tab.url ?? '', title: tab.title ?? '' };
        logger.info('Page re-validated from tab', this._tabId, tab.url);
        // Attempt puppeteer attachment so click/input actions can work.
        // Failure is non-fatal; DOM reads via chrome.scripting will still work.
        if (!this._puppeteerPage) {
          await this.attachPuppeteer().catch(err =>
            logger.warning('Re-validation puppeteer attach failed (non-fatal):', err),
          );
        }
      }
    } catch {
      // Tab may have been closed; leave _validWebPage as-is
    }
  }

  async attachPuppeteer(): Promise<boolean> {
    if (!this._validWebPage) {
      return false;
    }
    if (this._puppeteerPage) {
      return true;
    }

    logger.info('attaching puppeteer', this._tabId);
    const connectTab = async () =>
      connect({
        transport: await ExtensionTransport.connectTab(this._tabId),
        defaultViewport: null,
        protocol: 'cdp' as ProtocolType,
      });
    let browser: Browser;
    try {
      browser = await connectTab();
    } catch (error) {
      // A session left behind by an earlier service worker blocks a new attach: release it once and retry.
      if (!/already attached/i.test(error instanceof Error ? error.message : String(error))) throw error;
      await this._browserAdapter.detachDebugger({ tabId: this._tabId }).catch(() => undefined);
      browser = await connectTab();
    }
    const [page] = await browser.pages();
    this._browser = browser;
    this._puppeteerPage = page;

    try {
      const client = (page.mainFrame() as unknown as { client: CDPSession }).client;
      // Focus and :focus behave as in a focused window even while the user works in another one.
      await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      // A native file picker would block the tab; the agent is told about the chooser instead.
      await client.send('Page.setInterceptFileChooserDialog', { enabled: true });
      client.on('Page.windowOpen', () => {
        this._windowOpened = true;
      });
      client.on('Page.fileChooserOpened', event => {
        this._fileChooserOpened = true;
        this._fileChooserNode = event.backendNodeId ?? null;
      });
      this._recordNetwork(client);
    } catch (error) {
      logger.warning('Could not configure the page session:', error);
    }

    // Dialogs stay open for the agent to answer (handle_dialog); the page state shows them.
    page.on('dialog', dialog => {
      if (dialog.type() === 'beforeunload' && this._agentNavigating) {
        void dialog.accept().catch(() => undefined);
        return;
      }
      logger.info(`JavaScript ${dialog.type()} dialog opened: "${dialog.message().slice(0, 200)}"`);
      this._pendingDialog = dialog;
      this.invalidateCache();
    });
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) this._pendingDialog = null;
    });

    return true;
  }

  /** Attaches on first use; throws when this tab cannot be controlled. */
  public async ensurePuppeteerConnected(): Promise<void> {
    if (this._puppeteerPage) {
      return;
    }
    if (!this._validWebPage) {
      throw new Error(`Cannot control this tab (${this._state.url || 'no page loaded'}): only web pages can be automated`);
    }
    try {
      await this.attachPuppeteer();
    } catch (error) {
      throw new Error(
        `Cannot control this tab (DevTools may be open on it): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Forgets the debugger session (closed by the browser or the user); the next use attaches again. */
  markDetached(): void {
    const browser = this._browser;
    if (browser) void Promise.resolve().then(() => browser.disconnect()).catch(() => undefined);
    this._browser = null;
    this._puppeteerPage = null;
    this._pendingState = null;
    this._lastReadUrl = null;
    this._pendingDialog = null;
    this.invalidateCache();
  }

  async detachPuppeteer(): Promise<void> {
    const browser = this._browser;
    if (browser) await Promise.resolve().then(() => browser.disconnect()).catch(() => undefined);
    this._browser = null;
    this.markDetached();
    this._state = build_initial_state(this._tabId, this._state.url, this._state.title);
  }

  /**
   * Records every request of this tab from the session that is already attached. Bodies are pulled only for JSON
   * responses and only while the per-tab budget lasts, because each one is a CDP round trip.
   */
  private _recordNetwork(client: CDPSession): void {
    void client.send('Network.enable', { maxTotalBufferSize: 10_000_000, maxResourceBufferSize: 5_000_000 }).catch(() => undefined);
    client.on('Network.requestWillBeSent', event =>
      this._network.started(event.requestId, event.request?.method ?? 'GET', event.request?.url ?? ''),
    );
    client.on('Network.responseReceived', event =>
      this._network.responded(event.requestId, event.response?.status ?? 0, event.response?.mimeType ?? ''),
    );
    client.on('Network.loadingFailed', event => this._network.failed(event.requestId));
    client.on('Network.loadingFinished', event => {
      const done = this._network.finished(event.requestId, event.encodedDataLength ?? 0);
      if (!done?.wantsBody) return;
      void client
        .send('Network.getResponseBody', { requestId: event.requestId })
        .then(({ body, base64Encoded }) => this._network.sampled(done.record, base64Encoded ? atob(body) : body))
        // The buffer evicts a body as soon as the page is busy; a record without a sample is still an endpoint.
        .catch(() => undefined);
    });
  }

  /** Every request this tab made, newest last. */
  networkRecords(): NetRecord[] {
    return this._network.all();
  }

  /**
   * What the next screenshot shows: a part of the viewport instead of all of it, and whether the interactive elements
   * in it are labelled. Used by the next read and then forgotten, so one call changes one image.
   */
  setScreenshotOptions(options: ScreenshotOptions | null): void {
    this._screenshotOptions = options;
  }

  /**
   * Evaluates one JavaScript expression in the page and returns its value as text. The expression goes through
   * Runtime.evaluate, so a page whose CSP forbids eval still runs it; the value is then shaped by a function called
   * on the handle, so DOM nodes come back named rather than empty. The caller decides what may be evaluated.
   */
  async evaluateExpression(expression: string, maxChars: number): Promise<string> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) throw new Error('Puppeteer is not connected');
    const handle = await this._puppeteerPage.evaluateHandle(expression);
    try {
      return await handle.evaluate(serializeForModel, maxChars);
    } finally {
      await handle.dispose().catch(() => undefined);
    }
  }

  /**
   * Requests an address from inside the page, so the site's own cookies, origin and headers apply — an endpoint the
   * page itself called answers this exactly as it answered the page. The caller checks the address first.
   */
  async fetchInPage(url: string, maxChars: number): Promise<{ status: number; type: string; body: string; truncated: boolean }> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) throw new Error('Puppeteer is not connected');
    return this._puppeteerPage.evaluate(
      async (address: string, cap: number) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const response = await fetch(address, {
            credentials: 'include',
            headers: { accept: 'application/json, text/plain, */*' },
            signal: controller.signal,
          });
          const text = await response.text();
          return {
            status: response.status,
            type: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
            body: text.slice(0, cap),
            truncated: text.length > cap,
          };
        } finally {
          clearTimeout(timer);
        }
      },
      url,
      maxChars,
    );
  }

  /**
   * A file's bytes, requested from inside the page so the session that was allowed to download it is the one that
   * asks. base64 because that is what survives the CDP round trip. The caller checks the address first.
   */
  async fetchBytesInPage(url: string, maxBytes: number): Promise<{ status: number; type: string; base64: string; bytes: number }> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) throw new Error('Puppeteer is not connected');
    return this._puppeteerPage.evaluate(
      async (address: string, cap: number) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch(address, { credentials: 'include', signal: controller.signal });
          const buffer = new Uint8Array(await response.arrayBuffer());
          const kept = buffer.subarray(0, cap);
          let binary = '';
          for (let i = 0; i < kept.length; i += 8192) binary += String.fromCharCode(...kept.subarray(i, i + 8192));
          return {
            status: response.status,
            type: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
            base64: btoa(binary),
            bytes: buffer.length,
          };
        } finally {
          clearTimeout(timer);
        }
      },
      url,
      maxBytes,
    );
  }

  async removeHighlight(): Promise<void> {
    // A script injected while a JavaScript dialog is open blocks until the dialog closes.
    if (this._validWebPage && !this._pendingDialog) {
      await _removeHighlights(this._tabId, this._browserAdapter);
    }
  }

  /** The page's interactive elements and text, from the accessibility tree of every frame. */
  async getClickableElements(showHighlightElements: boolean, shot?: ScreenshotOptions | null): Promise<DOMState | null> {
    if (!this._validWebPage) {
      return null;
    }
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    const state = pruneAXTree(await getAXTreeState(this._puppeteerPage));
    if (showHighlightElements) {
      await this._drawHighlightsFromCoords(state, shot);
    }
    return state;
  }

  /**
   * Draw highlight overlays for all interactive elements in a DOMState using their
   * stored pageCoordinates. Works for both AXTree-derived and DOMSnapshot-derived states.
   */
  private async _drawHighlightsFromCoords(state: DOMState, shot?: ScreenshotOptions | null): Promise<void> {
    const rects = highlightRects(state.selectorMap, shot);
    if (rects.length > 0) {
      await drawHighlightOverlaysViaCoordinates(this._tabId, rects, this._browserAdapter);
    }
  }

  /** Whether the main document is still loading; a page that cannot answer (mid-navigation) counts as loading. */
  private async _documentLoading(): Promise<boolean> {
    const page = this._puppeteerPage;
    if (!page) return false;
    return withTimeout(page.evaluate(() => document.readyState !== 'complete'), 500, 'ready state').catch(() => true);
  }

  /** Waits until the element count of every frame holds still for two checks, at most maxWaitMs. */
  private async _waitForDomStability(maxWaitMs = 1000, checkIntervalMs = 50): Promise<void> {
    const page = this._puppeteerPage;
    if (!page) {
      return;
    }
    const countIn = (frame: ReturnType<PuppeteerPage['frames']>[number]) =>
      Promise.race([
        frame.evaluate(() => document.getElementsByTagName('*').length).catch(() => 0),
        // A frame blocked by a dialog or busy script must not hold up the read.
        new Promise<number>(resolve => setTimeout(() => resolve(0), 300)),
      ]);
    let previous = -1;
    let stableTicks = 0;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const counts = await Promise.all(page.frames().filter(frame => !frame.detached).map(countIn));
      const count = counts.reduce((sum, value) => sum + value, 0);
      if (count > 0 && count === previous) {
        if (++stableTicks >= 2) return;
      } else {
        stableTicks = 0;
        previous = count;
      }
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
  }

  // Get scroll position information for the current page.
  async getScrollInfo(): Promise<[number, number, number]> {
    if (!this._validWebPage) {
      return [0, 0, 0];
    }
    return _getScrollInfo(this._tabId, this._browserAdapter);
  }

  // Get scroll position information for a specific element.
  async getElementScrollInfo(elementNode: DOMElementNode): Promise<[number, number, number]> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    const element = await this.locateElement(elementNode);
    if (!element) {
      throw new Error(`Element: ${elementNode} not found`);
    }

    // Find the nearest scrollable ancestor
    const scrollableElement = await this._findNearestScrollableElement(element);
    if (!scrollableElement) {
      throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
    }

    const scrollInfo = await scrollableElement.evaluate(el => {
      return {
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      };
    });

    return [scrollInfo.scrollTop, scrollInfo.clientHeight, scrollInfo.scrollHeight];
  }

  /**
   * Find the nearest scrollable ancestor of the given element
   * @param element The element to start searching from
   * @returns The nearest scrollable ancestor or null if none found
   */
  private async _findNearestScrollableElement(element: ElementHandle): Promise<ElementHandle | null> {
    if (!this._puppeteerPage) {
      return null;
    }

    // Check if the current element is scrollable
    const isScrollable = await element.evaluate((el: Element) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const hasVerticalScrollbar = el.scrollHeight > el.clientHeight;
      const canScrollVertically =
        style.overflowY === 'scroll' ||
        style.overflowY === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflow === 'auto';

      return hasVerticalScrollbar && canScrollVertically;
    });

    if (isScrollable) {
      return element;
    }

    // Check parent elements
    let currentElement: ElementHandle<Element> | null = element;

    try {
      while (currentElement) {
        // Get the parent element (as an ElementHandle) of the current element
        const parentHandle = (await currentElement.evaluateHandle(
          (el: Element) => el.parentElement,
        )) as ElementHandle<Element> | null;

        const parentElement = parentHandle ? await parentHandle.asElement() : null;

        if (!parentElement) {
          // Reached the root without finding a scrollable ancestor
          currentElement = null;
          break;
        }

        const parentIsScrollable = await parentElement.evaluate((el: Element) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          const hasVerticalScrollbar = el.scrollHeight > el.clientHeight;
          const canScrollVertically =
            ['scroll', 'auto'].includes(style.overflowY) || ['scroll', 'auto'].includes(style.overflow);

          return hasVerticalScrollbar && canScrollVertically;
        });

        if (parentIsScrollable) {
          // Found a scrollable ancestor – return it (the caller should dispose when finished)
          return parentElement;
        }

        // Move up the DOM tree – dispose the previous element handle before continuing
        if (currentElement !== element) {
          try {
            await currentElement.dispose();
          } catch (disposeErr) {
            logger.debug('Failed to dispose element handle:', disposeErr);
          }
        }

        currentElement = parentElement;
      }
    } catch (error) {
      // Error accessing parent, break out of loop
      logger.error('Error finding scrollable parent:', error);
    }

    // If no scrollable ancestor found, return the document body or documentElement
    try {
      const bodyElement = await this._puppeteerPage.$('body');
      if (bodyElement) {
        const bodyIsScrollable = await bodyElement.evaluate(el => {
          if (!(el instanceof HTMLElement)) return false;
          return el.scrollHeight > el.clientHeight;
        });
        if (bodyIsScrollable) {
          return bodyElement;
        }
      }

      // Last resort: return document element for page-level scrolling
      const documentElement = await this._puppeteerPage.evaluateHandle(() => document.documentElement);
      const docElement = (await documentElement.asElement()) as ElementHandle<Element> | null;
      return docElement;
    } catch (error) {
      logger.error('Failed to find scrollable element:', error);
      return null;
    }
  }

  /** The last read, or null once anything has invalidated it. */
  getCachedState(): PageState | null {
    return this._cachedState;
  }

  /** The last read if nothing invalidated it and the tab is still on that URL; otherwise a new read. */
  async getCurrentState(useVision = false): Promise<PageState> {
    const cached = this._cachedState;
    if (cached && !this._pendingState && (!useVision || cached.screenshot)) {
      const liveUrl = await this._browserAdapter.getTab(this._tabId).then(
        tab => tab.url ?? '',
        () => cached.url,
      );
      if (liveUrl === cached.url && this._cachedState === cached) return cached;
    }
    return this.getState(useVision);
  }

  invalidateCache(): void {
    this._generation++;
    this._cachedState = null;
  }

  async getState(useVision = false): Promise<PageState> {
    const pending = this._pendingState;
    // A read started before an invalidation may predate the change the caller is waiting for.
    if (pending && pending.generation === this._generation && (pending.useVision || !useVision)) {
      return pending.promise;
    }
    const generation = this._generation;
    const entry = { generation, useVision } as { generation: number; useVision: boolean; promise: Promise<PageState> };
    entry.promise = this._readState(useVision)
      .then(state => {
        if (generation === this._generation) this._cachedState = state;
        return state;
      })
      .finally(() => {
        if (this._pendingState === entry) this._pendingState = null;
      });
    this._pendingState = entry;
    // A read that will not finish must not hold the step: two reads in run r3 took 221 s and 192 s, and 37 of them
    // took over 10 s (4.79 s a task on average). The read goes on in the background — the next one joins it instead of
    // starting over — and the step is told the page could not be read in time, which the prompt turns into an
    // instruction to wait and read it again rather than into "the page is empty".
    const overdue = Symbol('overdue');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capped = await Promise.race([
      entry.promise,
      new Promise<typeof overdue>(resolve => {
        timer = setTimeout(() => resolve(overdue), READ_STATE_CAP_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (capped !== overdue) return capped;
    // Nothing else awaits the read now, so its failure must not surface as an unhandled rejection.
    entry.promise.catch(() => undefined);
    logger.warning(`[getState] Page read still running after ${READ_STATE_CAP_MS}ms; reporting the page as unreadable`);
    const tab = await this._browserAdapter.getTab(this._tabId).catch(() => null);
    return {
      ...build_initial_state(this._tabId, tab?.url ?? this._state.url, tab?.title ?? this._state.title),
      unreadable: true,
    };
  }

  private async _readState(useVision: boolean): Promise<PageState> {
    // The tab may have left an initial chrome://newtab/ URL since this Page was constructed.
    await this._revalidateFromTab();
    if (!this._validWebPage) {
      return build_initial_state(this._tabId, this._state.url, this._state.title);
    }

    const dialog = this.pendingDialog;
    if (dialog) {
      // The page's scripts are paused until the dialog is answered; reading the page would only time out.
      const tab = await this._browserAdapter.getTab(this._tabId).catch(() => null);
      return { ...build_initial_state(this._tabId, tab?.url ?? this._state.url, tab?.title ?? this._state.title), dialog };
    }

    // Network idle only after the page moved (a navigation, the first read); otherwise only the DOM must hold still.
    const liveUrl = await this._browserAdapter.getTab(this._tabId).then(
      tab => tab.url ?? '',
      () => '',
    );
    const justNavigated = liveUrl !== this._lastReadUrl;
    if (justNavigated) {
      await this.waitForPageAndFramesLoad();
    }
    await this._waitForDomStability();

    const read = async (): Promise<PageState | null> => {
      try {
        return await this._updateState(useVision);
      } catch (error) {
        if (error instanceof URLNotAllowedError) throw error;
        logger.warning(`[getState] Page read failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    };

    // SPAs paint a shell and hydrate later, and frames briefly fail mid-navigation: retry a read with no content at
    // all. A page with text but no controls (a confirmation, an article) is a complete read.
    const MAX_DOM_RETRIES = 3;
    let state = await read();
    for (let attempt = 1; attempt < MAX_DOM_RETRIES && !(state && state.elementTree.children.length > 0); attempt++) {
      const retryDelayMs = getAdaptiveDomRetryDelayMs(attempt);
      logger.warning(
        `[getState] Empty DOM on attempt ${attempt}/${MAX_DOM_RETRIES} for ${state?.url ?? this._state.url} — retrying in ${retryDelayMs}ms`,
      );
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      state = await read();
    }
    if (state) {
      // A read with almost no controls right after a navigation, or while the document still loads, is often a page
      // that has not rendered them yet (16 of 57 real-site traces were told of an empty page that filled a moment later).
      // A document that keeps loading is waited for once per URL, so a page that never finishes is not slowed on every read.
      if (state.selectorMap.size <= SPARSE_READ_ELEMENTS) {
        const waitWhileLoading = this._settledUrl !== state.url;
        this._settledUrl = state.url;
        state = await settleSparseRead(
          state,
          async () => {
            if (this._pendingDialog) return null;
            await this._waitForDomStability();
            return read();
          },
          async () => waitWhileLoading && (await this._documentLoading()),
          { justNavigated },
        );
      }
      this._lastReadUrl = state.url;
      return state;
    }

    // Never serve an older page as the current one: report the live tab with no elements.
    const tab = await this._browserAdapter.getTab(this._tabId).catch(() => null);
    return build_initial_state(this._tabId, tab?.url ?? this._state.url, tab?.title ?? this._state.title);
  }

  async _updateState(useVision = false): Promise<PageState> {
    try {
      // chrome.tabs.get is the authoritative URL/title: puppeteer can report about:blank mid-navigation.
      let url: string;
      let title: string;
      try {
        const tab = await this._browserAdapter.getTab(this._tabId);
        url = tab.url || this._puppeteerPage?.url() || '';
        title = tab.title || (await this._puppeteerPage?.title()) || '';
      } catch {
        url = this._puppeteerPage?.url() || '';
        title = (await this._puppeteerPage?.title()) || '';
      }
      // Checked on every read, so redirects, tab switches and pages opened by clicks cannot slip past the firewall.
      if (url && !isNewTabPage(url) && !isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
        await this._puppeteerPage?.goto(this._config.homePageUrl || 'about:blank').catch(() => undefined);
        throw new URLNotAllowedError(`URL: ${url} is not allowed`);
      }

      await this.removeHighlight();
      // One call of view_screenshot shapes one image; a read that takes no screenshot leaves the request for the next.
      const shot = useVision ? this._screenshotOptions : null;
      if (useVision) this._screenshotOptions = null;
      const displayHighlights = (this._config.displayHighlights || useVision) && shot?.annotate !== false;
      const content = await this.getClickableElements(displayHighlights, shot);
      if (!content) {
        throw new Error('Failed to get clickable elements');
      }

      // Take screenshot if needed
      const screenshot = useVision ? await this.takeScreenshot(false, shot?.clip) : null;
      const [scrollY, visualViewportHeight, scrollHeight] = await this.getScrollInfo();

      // A new object per read: states handed out earlier are never mutated.
      this._state = {
        elementTree: content.elementTree,
        selectorMap: content.selectorMap,
        unreadable: content.unreadable,
        tabId: this._tabId,
        url,
        title,
        screenshot,
        scrollY,
        visualViewportHeight,
        scrollHeight,
      };

      // ── DOM → LLM COMPLETE LOG ───────────────────────────────────────────
      // Full structured dump of every interactive element sent to the LLM.
      // Open the background service worker DevTools to see this output.
      // NO elements are trimmed — the agent sees exactly what is logged here.
      if (this._config.logDOMSnapshot) {
        const elementCount = this._state.selectorMap.size;
        const logTime = new Date().toISOString();
        const divider = '─'.repeat(60);

        if (elementCount === 0) {
          console.warn(
            `\n╔══ [DOM→LLM] EMPTY PAGE ════════════════════════════════════╗\n` +
            `║ ⚠  EMPTY selector map — LLM sees NO interactive elements!\n` +
            `║ tab=${this._tabId}  url=${this._state.url}\n` +
            `║ time=${logTime}\n` +
            `╚════════════════════════════════════════════════════════════╝`,
          );
        } else {
          // Build per-element lines — ALL elements, no cap
          const allEntries = Array.from(this._state.selectorMap.entries());
          const lines = allEntries.map(([idx, el]) => {
            const tag         = el.tagName || '?';
            const text        = el.getAllTextTillNextClickableElement(3)?.trim() || '';
            const role        = el.attributes?.['role']          || '';
            const label       = el.attributes?.['aria-label']    || '';
            const href        = el.attributes?.['href']          || '';
            const ariasel     = el.attributes?.['aria-selected'] || '';
            const placeholder = el.attributes?.['placeholder']   || '';
            const eltype      = el.attributes?.['type']          || '';
            const name        = el.attributes?.['name']          || '';
            const elid        = el.attributes?.['id']            || '';
            const isNew       = (el as unknown as { isNew?: boolean }).isNew ? ' NEW' : '';

            const extras = [
              role        && `role=${role}`,
              label       && `aria="${label}"`,
              href        && `href=${href.slice(0, 60)}`,
              ariasel     && `aria-selected=${ariasel}`,
              placeholder && `placeholder="${placeholder}"`,
              eltype      && `type=${eltype}`,
              name        && `name="${name}"`,
              elid        && `id="${elid}"`,
            ].filter(Boolean).join(' | ');

            const textPart   = text   ? ` "${text}"`  : '';
            const extrasPart = extras ? `\n       ${extras}` : '';
            return `  [${idx}]${isNew} <${tag}>${textPart}${extrasPart}`;
          });

          // Tag-type frequency summary
          const tagCounts: Record<string, number> = {};
          for (const [, el] of allEntries) {
            const t = el.tagName || 'unknown';
            tagCounts[t] = (tagCounts[t] || 0) + 1;
          }
          const tagSummary = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => `${t}x${n}`)
            .join('  ');

          console.log(
            `\n[DOM→LLM] ` + divider + `\n` +
            `  tab     : ${this._tabId}\n` +
            `  url     : ${this._state.url}\n` +
            `  time    : ${logTime}\n` +
            `  scroll  : scrollY=${this._state.scrollY}px  bodyH=${this._state.scrollHeight}px  vpH=${Math.round(this._state.visualViewportHeight)}px\n` +
            `  elements: ${elementCount} total  [${tagSummary}]\n` +
            divider + `\n` +
            `${lines.join('\n')}\n` +
            divider,
          );
        }
      }
      // ────────────────────────────────────────────────────────────────────


      return this._state;
    } catch (error) {
      // getState retries, then reports the live tab with no elements; it never serves an older read.
      logger.warning('Failed to update state:', error);
      throw error;
    }
  }

  async takeScreenshot(fullPage = false, region?: ScreenshotOptions['clip']): Promise<string | null> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    try {
      // First disable animations/transitions
      await this._puppeteerPage.evaluate(() => {
        // The agent's own presence overlay hides itself while this is set, so the models see the page, not the cursor.
        document.documentElement.setAttribute('data-webgenie-capture', '1');
        const styleId = 'puppeteer-disable-animations';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            *, *::before, *::after {
              animation: none !important;
              transition: none !important;
            }
          `;
          document.head.appendChild(style);
        }
      });

      // At most 1280 px wide: a full window on a scaled display is over 2000 px, and those uploads made image calls hang
      // past their limits (run E). Gemini reads a screen at this size just as well.
      const view = await this._puppeteerPage.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
      const clip = clampClip(region, view);
      const scale = Math.min(1, 1280 / Math.max(1, clip.width * view.dpr));
      const screenshot = await this._puppeteerPage.screenshot({
        encoding: 'base64',
        type: 'jpeg',
        quality: 60,
        optimizeForSpeed: true,
        ...(fullPage ? { fullPage: true } : { clip: { ...clip, scale } }),
      });

      return screenshot as string;
    } catch (error) {
      logger.error('Failed to take screenshot:', error);
      throw error;
    } finally {
      // A capture that failed must still give the page its animations and its overlay back.
      await this._puppeteerPage
        ?.evaluate(() => {
          document.documentElement.removeAttribute('data-webgenie-capture');
          document.getElementById('puppeteer-disable-animations')?.remove();
        })
        .catch(() => undefined);
    }
  }

  url(): string {
    // Note: this._puppeteerPage.url() can return 'about:blank' or an intermediate URL
    // during frame initialization after attach, even when the tab is on Gmail/Calendar.
    // Always prefer _state.url which is populated from chrome.tabs.get (authoritative).
    // Fall back to puppeteer only if state URL is empty.
    if (this._state.url && !isNewTabPage(this._state.url) && !this._state.url.startsWith('chrome://')) {
      return this._state.url;
    }
    if (this._puppeteerPage) {
      const puppeteerUrl = this._puppeteerPage.url();
      if (puppeteerUrl && !isNewTabPage(puppeteerUrl) && !puppeteerUrl.startsWith('chrome://')) {
        return puppeteerUrl;
      }
    }
    return this._state.url;
  }

  async title(): Promise<string> {
    if (this._puppeteerPage) {
      return await this._puppeteerPage.title();
    }
    return this._state.title;
  }

  async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }
    await this._navigate(page => page.goto(url, NAVIGATION_OPTIONS), `navigate to ${url}`);
  }

  async refreshPage(): Promise<void> {
    await this._navigate(page => page.reload(NAVIGATION_OPTIONS), 'reload');
  }

  async goBack(): Promise<void> {
    await this._navigate(page => page.goBack(NAVIGATION_OPTIONS), 'go back');
  }

  async goForward(): Promise<void> {
    await this._navigate(page => page.goForward(NAVIGATION_OPTIONS), 'go forward');
  }

  private async _navigate(navigation: (page: PuppeteerPage) => Promise<unknown>, label: string): Promise<void> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    logger.info(label);
    this.invalidateCache();
    this._agentNavigating = true;
    let failure: Error | null = null;
    let status: number | undefined;
    try {
      const response = (await navigation(this._puppeteerPage)) as { status?: () => number } | null;
      status = typeof response?.status === 'function' ? response.status() : undefined;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (/timeout/i.test(error.message)) logger.warning(`${label} timed out; continuing with the partly loaded page`);
      else if (needsReload(undefined, error.message)) failure = error;
      else throw error;
    } finally {
      this._agentNavigating = false;
    }
    // A network error or a 429/5xx answer is usually gone on the second try, and an agent that is shown the error
    // page calls the task infeasible instead of retrying (WAREX). Reload once, before anything reads the page.
    if (failure || needsReload(status)) {
      logger.warning(`${label} met ${failure ? failure.message : `HTTP ${status}`}; reloading once before reading the page`);
      this._agentNavigating = true;
      try {
        await sleep(status === 429 ? 1000 : 300);
        await this._puppeteerPage.reload(NAVIGATION_OPTIONS);
      } catch (error) {
        if (failure) throw failure;
        logger.warning(`the reload after HTTP ${status} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this._agentNavigating = false;
      }
    }
    const url = this._puppeteerPage?.url();
    if (url) this.updateUrl(url);
  }

  // scroll to a percentage of the page or element
  // if yPercent is 0, scroll to the top of the page, if 100, scroll to the bottom of the page
  // if elementNode is provided, scroll to a percentage of the element
  // if elementNode is not provided, scroll to a percentage of the page
  async scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    if (!elementNode) {
      await this._puppeteerPage.evaluate(yPercent => {
        const scrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const scrollTop = (scrollHeight - viewportHeight) * (yPercent / 100);
        window.scrollTo({
          top: scrollTop,
          left: window.scrollX,
          behavior: 'instant',
        });
      }, yPercent);
    } else {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element: ${elementNode} not found`);
      }

      // Find the nearest scrollable ancestor
      const scrollableElement = await this._findNearestScrollableElement(element);
      if (!scrollableElement) {
        throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
      }

      await scrollableElement.evaluate((el, yPercent) => {
        const scrollHeight = el.scrollHeight;
        const viewportHeight = el.clientHeight;
        const scrollTop = (scrollHeight - viewportHeight) * (yPercent / 100);
        el.scrollTo({
          top: scrollTop,
          left: el.scrollLeft,
          behavior: 'instant',
        });
      }, yPercent);
    }
  }

  /** Scrolls the page, or the element's nearest scrollable ancestor, by `pages` of its visible height (negative is up). */
  async scrollByPages(pages: number, elementNode?: DOMElementNode): Promise<void> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    if (!elementNode) {
      await this._puppeteerPage.evaluate(pages => {
        window.scrollBy({ top: pages * (window.visualViewport?.height || window.innerHeight), behavior: 'instant' });
      }, pages);
      return;
    }
    const element = await this.locateElement(elementNode);
    if (!element) {
      throw new Error(`Element: ${elementNode} not found`);
    }
    const scrollableElement = await this._findNearestScrollableElement(element);
    if (!scrollableElement) {
      throw new Error(`No scrollable ancestor found for element: ${elementNode}`);
    }
    await scrollableElement.evaluate((el, pages) => {
      el.scrollBy({ top: pages * el.clientHeight, behavior: 'instant' });
    }, pages);
  }

  /** Presses a key or shortcut `repeat` times in the focused element, or in `node` after focusing it. */
  async sendKeys(keys: string, node?: DOMElementNode, repeat = 1): Promise<void> {
    const { modifiers, key } = normalizeKeyCombo(keys);
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    if (node) {
      const handle = await this._requireHandle(node);
      const inChildFrame = !!node.frame && node.frame !== this._puppeteerPage.mainFrame();
      const focused = !inChildFrame && (await handle.evaluate(el => {
        (el as HTMLElement).focus();
        return (el.getRootNode() as Document | ShadowRoot).activeElement === el;
      }));
      // ponytail: programmatic focus cannot enter a cross-site frame and misses unfocusable elements, so those get a
      // real click, which on a slider track also moves the value; a CDP DOM.focus would avoid that if it matters.
      if (!focused) await this._dispatchMouse(handle, 'click', { checkCover: false });
    }
    const keyboard = this._puppeteerPage.keyboard;
    // A key press that opened a dialog ends the repeats: nothing reaches the page until the dialog is answered.
    for (let pressed = 0; pressed < repeat && !this._pendingDialog; pressed++) {
      try {
        for (const modifier of modifiers) await keyboard.down(modifier);
        // A key that opens a dialog is not acknowledged until the dialog closes.
        await Promise.race([keyboard.press(key), sleep(1500)]);
      } finally {
        for (const modifier of [...modifiers].reverse()) {
          await keyboard.up(modifier).catch(() => undefined);
        }
      }
    }
  }

  /** Scrolls the nth visible match of the text (case-insensitive, open shadow roots and every frame included) into view. */
  async scrollToText(text: string, nth = 1): Promise<boolean> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    let remaining = nth;
    for (const frame of this._puppeteerPage.frames().filter(candidate => !candidate.detached)) {
      const found = await withTimeout(
        frame.evaluate(
          (needle, wanted) => {
            const matches: Element[] = [];
            const visit = (root: Node) => {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
              for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
                if (node.nodeType === Node.TEXT_NODE) {
                  const parent = node.parentElement;
                  if (parent && matches[matches.length - 1] !== parent && node.textContent?.toLowerCase().includes(needle)) {
                    const rect = parent.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) matches.push(parent);
                  }
                } else if ((node as Element).shadowRoot) {
                  visit((node as Element).shadowRoot as ShadowRoot);
                }
              }
            };
            visit(document.body ?? document.documentElement);
            const target = matches[wanted - 1];
            target?.scrollIntoView({ block: 'center', behavior: 'instant' });
            return target ? -1 : matches.length;
          },
          text.trim().toLowerCase(),
          remaining,
        ),
        2000,
        'scroll to text',
      ).catch(() => 0);
      if (found < 0) return true;
      remaining -= found;
    }
    return false;
  }

  /**
   * The live element for a node of the last read, adopted by backendNodeId in the frame it came from.
   *
   * A re-render between the read and the action replaces the node, and the adoption fails with "Node is detached
   * from document" even though the same control is still on the page under a new node. One fresh read is taken and
   * the element followed by identity before giving up; the traces show that retry usually succeeding, and each
   * failure the model has to recover from instead costs a replan.
   */
  async locateElement(element: DOMElementNode): Promise<ElementHandle | null> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage || element.backendNodeId == null) {
      return null;
    }
    const adopt = async (node: DOMElementNode): Promise<ElementHandle> => {
      const frame = node.frame ?? this._puppeteerPage!.mainFrame();
      return (await frame.mainRealm().adoptBackendNode(node.backendNodeId!)) as unknown as ElementHandle;
    };
    try {
      return await adopt(element);
    } catch (error) {
      const replacement = await this._afterFreshRead(element);
      if (replacement) {
        try {
          return await adopt(replacement);
        } catch {
          // Gone in the fresh read too; fall through to the warning below.
        }
      }
      logger.warning(`${element} is no longer in the page: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** The same element in a read taken now, or null when the page no longer has it (or has two that would fit). */
  private async _afterFreshRead(element: DOMElementNode): Promise<DOMElementNode | null> {
    this.invalidateCache();
    const state = await this.getState().catch(() => null);
    if (!state) return null;
    const index = resolveByIdentity(element, state.selectorMap);
    const found = index === null ? null : (state.selectorMap.get(index) ?? null);
    return found && found.backendNodeId != null ? found : null;
  }

  private async _requireHandle(node: DOMElementNode): Promise<ElementHandle> {
    const handle = await this.locateElement(node);
    if (!handle) {
      // No index: the number the model was shown is not the number this node carries after a re-read, and naming
      // one it never saw sent it clicking an unrelated element in a live run.
      throw new Error(
        'That element is no longer available: the page replaced or removed it. Read the page again and use the index the new list gives it.',
      );
    }
    return handle;
  }

  private _pageClient(): CDPSession {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    return (this._puppeteerPage.mainFrame() as unknown as { client: CDPSession }).client;
  }

  /**
   * One mouse gesture on an element: scroll it into view, refuse it when disabled or covered, then send the
   * move/press/release events once. Events are never re-sent: an unacknowledged press may still land, and
   * a second one would click twice. Coordinates from clickablePoint include iframe offsets.
   */
  private async _dispatchMouse(
    handle: ElementHandle,
    kind: 'click' | 'right' | 'hover',
    { clickCount = 1, checkCover = true } = {},
  ): Promise<MouseOutcome> {
    const sized = await handle.evaluateHandle(pointerTarget);
    const target = (sized.asElement() as ElementHandle | null) ?? handle;
    // A refused gesture must leave the page where it found it: the scroll below moved an open consent dialog out of
    // the element list's viewport window in a live run, and the model never saw its buttons again.
    // ponytail: the frame's own scroll only; a scroll container the element sits in is not restored.
    const scrolledFrom = await target.evaluate(() => [window.scrollX, window.scrollY] as [number, number]).catch(() => null);
    const restoreScroll = async () => {
      if (scrolledFrom) await target.evaluate((_el, x, y) => window.scrollTo(x, y), ...scrolledFrom).catch(() => {});
    };
    await target.scrollIntoView();
    // The agent's own overlay is one fixed host with pointer-events: none, so it can no longer cover a target the
    // way the old draggable capsule did (Online-Mind2Web, Trader Joe's); nothing has to be disarmed before a click.
    let blocker = await target.evaluate(coverBlocker, kind === 'hover', checkCover);
    if (blocker?.covered) {
      // A sticky header or footer, a sliding panel or a list still settling can sit over the target right after the
      // scroll (live runs: a site header, a page footer). Centre it again in every scroll container, let the page
      // settle, and look once more before refusing.
      await target.scrollIntoView();
      await sleep(150);
      blocker = await target.evaluate(coverBlocker, kind === 'hover', checkCover);
    }
    // Covered only by an empty, transparent box that is no dialog or bar (a live refusal named an unnamed <div> the
    // model could do nothing about): nothing to close, so the element itself is clicked below.
    const clickThrough = Boolean(blocker?.clickThrough && kind === 'click' && clickCount === 1);
    if (blocker?.message && !clickThrough) {
      await restoreScroll();
      throw new Error(blocker.buttons ? `${blocker.message}${this._indexedButtons(blocker.buttons)}; close or move past it first` : blocker.message);
    }
    // A target that is still sliding gets the gesture where it was, not where it is: give it a few frames to come to
    // rest, and refuse rather than click whatever moved into that spot.
    let moving = false;
    for (let checks = 0; checks < MOVING_CHECKS; checks++) {
      moving = (await target.evaluate(boxMoving).catch(() => false)) === true;
      if (!moving) break;
      await sleep(50);
    }
    if (moving) {
      await restoreScroll();
      throw new Error(
        'The element is still moving (an animation, a sliding panel or a list still loading). Wait for the page to settle and try again; if it keeps moving, use a control that stands still.',
      );
    }
    // The overlay aimed its cursor from the page read; the scroll above has since moved the element, so the gesture
    // tells the page where the element really is. Decoration, so it is never awaited and never throws.
    void this._showPointer(target);
    const { x, y } = await target.clickablePoint(blocker?.offset).catch(async () => {
      await restoreScroll();
      // "Off the page" in the old wording sent the model scrolling for it; the action has already scrolled to it.
      throw new Error(
        'The element has no visible area: it is hidden, or inside a collapsed section, menu or panel. Scrolling will not reveal it (actions already scroll to their element); open what contains it, click its visible label, or choose another element.',
      );
    });

    const client = this._pageClient();
    const button = kind === 'right' ? 'right' : 'left';
    this._fileChooserOpened = false;
    this._windowOpened = false;
    // Tabs created while the gesture runs; a tab this one opens is created asynchronously, often after the click is
    // acknowledged, and a check made at that moment missed it.
    const createdTabs: chrome.tabs.Tab[] = [];
    const onTabCreated = (tab: chrome.tabs.Tab) => void createdTabs.push(tab);
    this._browserAdapter.addTabCreatedListener(onTabCreated);
    try {
      const outcome = clickThrough ? await this._clickInPage(target) : await this._sendMouseEvents(client, kind, button, x, y, clickCount);
      if (kind !== 'hover' && !outcome.dialog && this._windowOpened) {
        for (const startedAt = Date.now(); createdTabs.length === 0 && Date.now() - startedAt < NEW_TAB_WAIT_MS; ) await sleep(50);
      }
      const opened = createdTabs.find(tab => tab.openerTabId === this._tabId) ?? (this._windowOpened ? createdTabs[0] : undefined);
      return opened?.id !== undefined ? { ...outcome, newTabId: opened.id } : outcome;
    } finally {
      this._browserAdapter.removeTabCreatedListener(onTabCreated);
    }
  }

  /**
   * Where the element sits now, in top-level viewport pixels, for the on-page cursor. Sent after the gesture has
   * scrolled to the element and found it clickable, so a refused gesture never moves the cursor to it.
   */
  private async _showPointer(target: ElementHandle): Promise<void> {
    try {
      const box = await target.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) return;
      await this._browserAdapter.sendTabMessage(this._tabId, {
        type: 'AGENT_POINTER',
        rect: { x: box.x, y: box.y, w: box.width, h: box.height },
      } satisfies AgentPointerMessage);
    } catch {
      // A tab without the content script, or one navigating away: the gesture itself is unaffected.
    }
  }

  /** A DOM click, queued so that a dialog it opens cannot block the call; the dialog is still reported. */
  private async _clickInPage(target: ElementHandle): Promise<MouseOutcome> {
    await target.evaluate(el => void setTimeout(() => (el as HTMLElement).click(), 0));
    await sleep(150);
    return { dialog: this.pendingDialog ?? undefined, fileChooser: this._fileChooserOpened };
  }

  private async _sendMouseEvents(
    client: CDPSession,
    kind: 'click' | 'right' | 'hover',
    button: 'left' | 'right',
    x: number,
    y: number,
    clickCount: number,
  ): Promise<MouseOutcome> {
    const events: Promise<unknown>[] = [client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })];
    if (kind !== 'hover') {
      for (let count = 1; count <= clickCount; count++) {
        events.push(client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count }));
        events.push(client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count }));
      }
    }
    const startedAt = Date.now();
    // A dialog the click opens blocks the acknowledgement; stop waiting as soon as it shows instead of timing out.
    const dialogOrTimeout = (async () => {
      while (Date.now() - startedAt < 1500) {
        if (this._pendingDialog) return 'dialog' as const;
        await sleep(50);
      }
      return 'timeout' as const;
    })();
    const settled = await Promise.race([
      Promise.all(events).then(
        () => 'acked' as const,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
      ),
      dialogOrTimeout,
    ]);
    const dialog = this.pendingDialog ?? undefined;
    record({
      level: settled === 'acked' || dialog ? 'info' : 'warning',
      kind: 'span',
      component: 'Page',
      msg: 'input dispatch',
      durationMs: Date.now() - startedAt,
      data: { kind, acked: settled === 'acked', dialogOpened: Boolean(dialog) },
    });
    if (settled instanceof Error) {
      throw settled;
    }
    return { dialog, fileChooser: this._fileChooserOpened };
  }

  /**
   * The covering layer's buttons as indexes of the last read, so the model can close it in its next call.
   * ponytail: matched by label; a label that also appears outside the layer may name that element's index instead.
   */
  private _indexedButtons(labels: string[]): string {
    const selectorMap = this._cachedState?.selectorMap;
    if (!selectorMap) return '';
    const named = labels.flatMap(label => {
      for (const [index, node] of selectorMap) {
        const nodeLabel = (node.attributes['aria-label'] || node.getAllTextTillNextClickableElement(2)).replace(/\s+/g, ' ').trim();
        if (nodeLabel === label) return [`[${index}] "${label}"`];
      }
      return [];
    });
    return named.length > 0 ? `; its buttons: ${[...new Set(named)].join(', ')}` : '';
  }

  async clickNode(node: DOMElementNode, clickCount = 1): Promise<MouseOutcome> {
    return this._dispatchMouse(await this._requireHandle(node), 'click', { clickCount });
  }

  async hoverNode(node: DOMElementNode): Promise<MouseOutcome> {
    return this._dispatchMouse(await this._requireHandle(node), 'hover');
  }

  async rightClickNode(node: DOMElementNode): Promise<MouseOutcome> {
    return this._dispatchMouse(await this._requireHandle(node), 'right');
  }

  /**
   * Puts a file into a file input: the element itself, else the input whose chooser a click on it opens, else a drop on
   * it. The File is built in the page from its bytes, since DOM.setFileInputFiles needs a path on disk.
   * ponytail: the chooser is caught on the main frame's session only; an upload button inside a cross-site iframe falls back to the drop.
   */
  async uploadFile(node: DOMElementNode, file: { name: string; type: string; data: string }): Promise<string> {
    const put = (target: ElementHandle, drop: boolean) =>
      target.evaluate(
        (element: Element, name: string, type: string, data: string, asDrop: boolean) => {
          const binary = atob(data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], name, { type }));
          if (asDrop) {
            for (const kind of ['dragenter', 'dragover', 'drop']) {
              element.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: transfer }));
            }
            return '';
          }
          const input = element as HTMLInputElement;
          input.files = transfer.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return Array.from(input.files ?? [], picked => picked.name).join(', ');
        },
        file.name,
        file.type,
        file.data,
        drop,
      );
    const handle = await this._requireHandle(node);
    if (await handle.evaluate((element: Element) => element instanceof HTMLInputElement && element.type === 'file')) {
      return `; the file field now holds: ${await put(handle, false)}`;
    }
    this._fileChooserNode = null;
    await this._dispatchMouse(handle, 'click');
    for (let waited = 0; this._fileChooserNode === null && waited < 1000; waited += 100) await sleep(100);
    if (this._fileChooserNode !== null && this._puppeteerPage) {
      const frame = node.frame ?? this._puppeteerPage.mainFrame();
      const input = (await frame.mainRealm().adoptBackendNode(this._fileChooserNode)) as unknown as ElementHandle;
      return `through the file chooser it opened; the file field now holds: ${await put(input, false)}`;
    }
    await put(handle, true);
    return 'by dropping it on the element (it opened no file chooser)';
  }

  /** The form around the element (without one, around the focused element): its payment fields and submit buttons. */
  async formCommitInfo(node?: DOMElementNode): Promise<FormCommitInfo> {
    if (node) return (await this._requireHandle(node)).evaluate(inspectForm);
    if (!this._puppeteerPage) throw new Error('Puppeteer page is not connected');
    return this._puppeteerPage.evaluate(inspectForm, null);
  }

  /**
   * Replaces the field's content with text and reads it back from the live element. Text goes in as one
   * Input.insertText (what an IME or paste does, so framework-controlled inputs see it); date, range and
   * similar inputs get their value set directly. Password values never leave this method.
   */
  async inputTextNode(node: DOMElementNode, text: string): Promise<InputOutcome> {
    const handle = await this._requireHandle(node);
    const field = await handle.evaluate(el => {
      const input = el as HTMLInputElement;
      const tag = el.tagName.toLowerCase();
      if (input.disabled || el.getAttribute('aria-disabled') === 'true')
        return { error: 'The field is disabled: the page turns it on once what it waits for is filled or chosen; do that first' };
      if (input.readOnly)
        return {
          error:
            'The field is read-only: the page fills it through its own control (a picker, a list, a pair of buttons). Click the field or that control and choose the value there instead of typing',
        };
      if (tag === 'input' && ['date', 'datetime-local', 'time', 'month', 'week', 'color', 'range'].includes(input.type)) {
        return { mode: 'setter', type: input.type, secret: false };
      }
      if (tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable) {
        const type = tag === 'input' ? input.type : tag === 'textarea' ? 'textarea' : 'contenteditable';
        return { mode: 'insert', type, secret: tag === 'input' && input.type === 'password' };
      }
      return { error: `A <${tag}> does not accept text; type into an input, textarea or editable element` };
    });
    if ('error' in field) {
      throw new Error(field.error);
    }

    const converted = field.mode === 'setter' && text.trim() ? toNativeInputValue(text, field.type) : text;
    if (converted === null) {
      const examples: Record<string, string> = { date: '2024-05-20', time: '15:30', 'datetime-local': '2024-05-20T15:30', month: '2024-05' };
      throw new Error(`"${text}" is not a ${field.type} this ${field.type} field accepts; type it like ${examples[field.type]} (it is set directly, not typed key by key)`);
    }
    const expected = converted;
    const setValue = (value: string) =>
      handle.evaluate((el, next) => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
        if (setter) setter.call(el, next);
        else (el as HTMLElement).innerText = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);

    if (field.mode === 'setter') {
      await setValue(expected);
    } else {
      // A real click puts focus in the field's own frame; programmatic focus cannot enter a cross-site iframe.
      await this._dispatchMouse(handle, 'click', { checkCover: false });
      await handle.evaluate(el => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          el.select();
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      const keyboard = this._puppeteerPage!.keyboard;
      if (!text) {
        await withTimeout(keyboard.press('Backspace'), 2000, 'typing');
      } else if (typingMethod(text, field.type) === 'keys') {
        await withTimeout(keyboard.type(text), 2000 + text.length * 50, 'typing');
      } else {
        await withTimeout(this._pageClient().send('Input.insertText', { text }), 2000, 'typing');
        // Key listeners still see input: End moves the caret without changing the text.
        await withTimeout(keyboard.press('End'), 2000, 'typing');
      }
    }

    const readBack = () =>
      handle.evaluate(el =>
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText ?? '',
      );
    const same = (value: string) => value.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim();
    let actual = await readBack();
    if (!same(actual) && field.mode === 'insert') {
      // Some pages swallow inserted text; set the value directly once and let the page's listeners see it.
      await setValue(text);
      actual = await readBack();
    }
    return { matched: same(actual), secret: field.secret, actualLength: actual.length, actual: field.secret ? null : actual };
  }

  /** Selects by visible text: sets a native select, or opens an ARIA widget and clicks the matching option. */
  async selectOption(node: DOMElementNode, text: string): Promise<{ selected: boolean; confirmed: boolean; message: string }> {
    const handle = await this._requireHandle(node);
    const native = await handle.evaluate((el, wanted) => {
      if (!(el instanceof HTMLSelectElement)) return null;
      const options = Array.from(el.options);
      // The page read shows option names with collapsed spaces; an exact match first, then one ignoring spacing and case.
      const loose = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
      const option =
        options.find(candidate => candidate.text.trim() === wanted.trim()) ?? options.find(candidate => loose(candidate.text) === loose(wanted));
      if (!option) {
        return {
          selected: false,
          confirmed: false,
          message: `Option "${wanted}" not found. Available options: ${options.map(candidate => `"${candidate.text.trim()}"`).join(', ')}`,
        };
      }
      if (el.value !== option.value) {
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { selected: true, confirmed: el.value === option.value, message: `Selected option "${wanted}"` };
    }, text);
    if (native) {
      return native;
    }

    let option = await this._ariaOption(handle, text);
    if (!option) {
      await this._dispatchMouse(handle, 'click', { checkCover: false });
      const deadline = Date.now() + 1000;
      while (!option && Date.now() < deadline) {
        await sleep(100);
        option = await this._ariaOption(handle, text);
      }
    }
    if (!option) {
      const available = await this._ariaOptionTexts(handle);
      return {
        selected: false,
        confirmed: false,
        message: `Option "${text}" not found${available.length ? `. Available options: ${available.map(o => `"${o}"`).join(', ')}` : ' after opening the dropdown'}`,
      };
    }
    await this._dispatchMouse(option, 'click', { checkCover: false });
    await sleep(100);
    const confirmed = await handle
      .evaluate((el, wanted) => {
        const shows = (candidate: Element | null) =>
          Boolean(candidate && `${(candidate as HTMLInputElement).value ?? ''} ${candidate.textContent ?? ''}`.includes(wanted));
        return shows(el) || shows(el.parentElement) || shows(el.parentElement?.parentElement ?? null) || shows(el.parentElement?.parentElement?.parentElement ?? null);
      }, text)
      .catch(() => false);
    return { selected: true, confirmed, message: `Selected option "${text}"` };
  }

  private async _ariaOptionTexts(handle: ElementHandle): Promise<string[]> {
    return handle.evaluate(el => {
      const doc = el.ownerDocument;
      const ids = `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean);
      const scopes = ids.map(id => doc.getElementById(id)).filter((scope): scope is HTMLElement => scope !== null);
      return (scopes.length ? scopes : [doc])
        .flatMap(scope => Array.from(scope.querySelectorAll('[role="option"]')))
        .filter(option => option.getBoundingClientRect().height > 0)
        .map(option => (option.textContent ?? '').trim().replace(/\s+/g, ' '));
    });
  }

  private async _ariaOption(handle: ElementHandle, text: string): Promise<ElementHandle | null> {
    const found = await handle.evaluateHandle((el, wanted) => {
      const doc = el.ownerDocument;
      const ids = `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean);
      const scopes = ids.map(id => doc.getElementById(id)).filter((scope): scope is HTMLElement => scope !== null);
      const normalized = wanted.trim().replace(/\s+/g, ' ');
      return (
        (scopes.length ? scopes : [doc])
          .flatMap(scope => Array.from(scope.querySelectorAll('[role="option"]')))
          .find(option => option.getBoundingClientRect().height > 0 && (option.textContent ?? '').trim().replace(/\s+/g, ' ') === normalized) ?? null
      );
    }, text);
    const element = found.asElement() as ElementHandle | null;
    if (!element) {
      await found.dispose();
    }
    return element;
  }

  /** Drags one element onto another: HTML5 draggables through drag interception, anything else with mouse moves. */
  async dragNode(sourceNode: DOMElementNode, targetNode: DOMElementNode): Promise<void> {
    const source = await this._requireHandle(sourceNode);
    const target = await this._requireHandle(targetNode);
    const page = this._puppeteerPage!;
    await source.scrollIntoView();
    const html5 = await source.evaluate(el => el.closest('[draggable="true"]') !== null);
    if (html5) {
      if (sourceNode.frameKey !== targetNode.frameKey) {
        throw new Error('Dragging between frames is not supported; drag within one frame.');
      }
      // Mouse events do not start an HTML5 drag in a tab driven over CDP, so the page receives the drag sequence
      // a browser would fire, with one shared DataTransfer.
      await source.evaluate((sourceElement, targetElement) => {
        const dataTransfer = new DataTransfer();
        const fire = (element: Element, type: string) => {
          const rect = element.getBoundingClientRect();
          element.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            }),
          );
        };
        fire(sourceElement, 'dragstart');
        fire(targetElement, 'dragenter');
        fire(targetElement, 'dragover');
        fire(targetElement, 'drop');
        fire(sourceElement, 'dragend');
      }, target);
      return;
    }
    const from = await source.clickablePoint();
    const to = await target.clickablePoint();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 15 });
    await page.mouse.up();
  }

  get pendingDialog(): PageDialog | null {
    const dialog = this._pendingDialog;
    return dialog ? { type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() || undefined } : null;
  }

  async handleDialog(accept: boolean, promptText?: string): Promise<string> {
    const dialog = this._pendingDialog;
    if (!dialog) {
      return 'No dialog is showing.';
    }
    this._pendingDialog = null;
    this.invalidateCache();
    const description = `${dialog.type()} dialog "${dialog.message().slice(0, 200)}"`;
    try {
      if (accept) await dialog.accept(promptText);
      else await dialog.dismiss();
    } catch (error) {
      logger.warning(`Answering the ${description} failed: ${error instanceof Error ? error.message : String(error)}`);
      return `The ${description} was already closed.`;
    }
    return `${accept ? 'Accepted' : 'Dismissed'} the ${description}${accept && promptText !== undefined ? ' after entering the text' : ''}.`;
  }

  private async _waitForStableNetwork() {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe', 'xhr', 'fetch']);

    const RELEVANT_CONTENT_TYPES = new Set([
      'text/html',
      'text/css',
      'application/javascript',
      'image/',
      'font/',
      'application/json',
    ]);

    const IGNORED_URL_PATTERNS = new Set([
      // Analytics and tracking
      'analytics',
      'tracking',
      'telemetry',
      'beacon',
      'metrics',
      // Ad-related
      'doubleclick',
      'adsystem',
      'adserver',
      'advertising',
      // Social media widgets
      'facebook.com/plugins',
      'platform.twitter',
      'linkedin.com/embed',
      // Live chat and support
      'livechat',
      'zendesk',
      'intercom',
      'crisp.chat',
      'hotjar',
      // Push notifications
      'push-notifications',
      'onesignal',
      'pushwoosh',
      // Background sync/heartbeat
      'heartbeat',
      'ping',
      'alive',
      // WebRTC and streaming
      'webrtc',
      'rtmp://',
      'wss://',
      // Common CDNs
      'cloudfront.net',
      'fastly.net',
    ]);

    const pendingRequests = new Set();
    let lastActivity = Date.now();

    const onRequest = (request: HTTPRequest) => {
      // Filter by resource type
      const resourceType = request.resourceType();
      if (!RELEVANT_RESOURCE_TYPES.has(resourceType)) {
        return;
      }

      // Filter out streaming, websocket, and other real-time requests
      if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(resourceType)) {
        return;
      }

      // Filter out by URL patterns
      const url = request.url().toLowerCase();
      if (Array.from(IGNORED_URL_PATTERNS).some(pattern => url.includes(pattern))) {
        return;
      }

      // Filter out data URLs and blob URLs
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        return;
      }

      // Filter out requests with certain headers
      const headers = request.headers();
      if (
        // biome-ignore lint/complexity/useLiteralKeys: <explanation>
        headers['purpose'] === 'prefetch' ||
        headers['sec-fetch-dest'] === 'video' ||
        headers['sec-fetch-dest'] === 'audio'
      ) {
        return;
      }

      pendingRequests.add(request);
      lastActivity = Date.now();
    };

    const onResponse = (response: HTTPResponse) => {
      const request = response.request();
      if (!pendingRequests.has(request)) {
        return;
      }

      // Filter by content type
      const contentType = response.headers()['content-type']?.toLowerCase() || '';

      // Skip streaming content
      if (
        ['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(t =>
          contentType.includes(t),
        )
      ) {
        pendingRequests.delete(request);
        return;
      }

      // Only process relevant content types
      if (!Array.from(RELEVANT_CONTENT_TYPES).some(ct => contentType.includes(ct))) {
        pendingRequests.delete(request);
        return;
      }

      // Skip large responses
      const contentLength = response.headers()['content-length'];
      if (contentLength && Number.parseInt(contentLength) > 5 * 1024 * 1024) {
        // 5MB
        pendingRequests.delete(request);
        return;
      }

      pendingRequests.delete(request);
      lastActivity = Date.now();
    };

    // Add event listeners
    this._puppeteerPage.on('request', onRequest);
    this._puppeteerPage.on('response', onResponse);

    const startTime = Date.now();
    let timedOut = false;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const now = Date.now();
        const timeSinceLastActivity = (now - lastActivity) / 1000; // Convert to seconds

        if (pendingRequests.size === 0 && timeSinceLastActivity >= this._config.waitForNetworkIdlePageLoadTime) {
          break;
        }

        const elapsedTime = (now - startTime) / 1000; // Convert to seconds
        if (elapsedTime > this._config.maximumWaitPageLoadTime) {
          timedOut = true;
          break;
        }
      }
    } finally {
      // Clean up event listeners
      this._puppeteerPage.off('request', onRequest);
      this._puppeteerPage.off('response', onResponse);
    }
    // Which hosts keep a page from going idle decides whether the ignore list or the cap needs changing.
    const pendingHosts = [...new Set(Array.from(pendingRequests).map(r => {
      try {
        return new URL((r as HTTPRequest).url()).hostname;
      } catch {
        return 'unknown';
      }
    }))].slice(0, 10);
    record({
      level: 'info',
      kind: 'span',
      component: 'Page',
      msg: 'network idle',
      durationMs: Date.now() - startTime,
      data: { timedOut, pending: pendingRequests.size, pendingHosts },
    });
  }

  async waitForPageAndFramesLoad(timeoutOverwrite?: number): Promise<void> {
    // Start timing
    const startTime = Date.now();

    // Wait for page load
    try {
      await this._waitForStableNetwork();

      // Check if the loaded URL is allowed
      if (this._puppeteerPage) {
        await this._checkAndHandleNavigation();
      }
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }
      console.warn('Page load failed, continuing...', error);
    }

    // Calculate remaining time to meet minimum wait time
    const elapsed = (Date.now() - startTime) / 1000; // Convert to seconds
    const minWaitTime = timeoutOverwrite || this._config.minimumWaitPageLoadTime;
    const remaining = Math.max(minWaitTime - elapsed, 0);

    console.debug(
      `--Page loaded in ${elapsed.toFixed(2)} seconds, waiting for additional ${remaining.toFixed(2)} seconds`,
    );

    // Sleep remaining time if needed
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining * 1000)); // Convert seconds to milliseconds
    }
  }

  /** The text of every frame of the page, each child frame under a header with its URL. */
  async getCompletePageContent(): Promise<string> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    const main = this._puppeteerPage.mainFrame();
    const parts = await Promise.all(
      this._puppeteerPage
        .frames()
        .filter(frame => !frame.detached)
        .map(async frame => {
          const text = await withTimeout(frame.evaluate(pageTextWithShadowRoots), 2000, 'page text').catch(() => '');
          const trimmed = text.trim();
          if (!trimmed) return '';
          return frame === main ? trimmed : `[Frame ${frame.url()}]\n${trimmed}`;
        }),
    );
    return parts.filter(Boolean).join('\n\n');
  }

  /**
   * The page's readable content as markdown: headings, paragraphs, lists, tables and links, extracted in the page
   * itself. `main` drops navigation, footers and banners; `full` keeps everything the page renders. Frames are appended
   * under their address, as `getCompletePageContent` does. An extraction that fails or comes back empty falls back to
   * the raw page text, so a read never returns nothing where the old path returned something.
   */
  async readPageMarkdown(mode: 'main' | 'full'): Promise<string> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    const main = this._puppeteerPage.mainFrame();
    const parts = await Promise.all(
      this._puppeteerPage
        .frames()
        .filter(frame => !frame.detached)
        .map(async frame => {
          const blocks = await withTimeout(frame.evaluate(extractReadBlocks, mode), 5000, 'read page').catch(() => [] as ReadBlock[]);
          const markdown = blocksToMarkdown(blocks).trim();
          if (!markdown) return '';
          return frame === main ? markdown : `## [Frame ${frame.url()}]\n\n${markdown}`;
        }),
    );
    const markdown = parts.filter(Boolean).join('\n\n');
    return markdown || (await this.getCompletePageContent());
  }

  /** The address of the page's "next page" link, when it offers one; empty when it does not. */
  async nextPageHref(): Promise<string> {
    await this.ensurePuppeteerConnected();
    if (!this._puppeteerPage) return '';
    return withTimeout(this._puppeteerPage.evaluate(findNextPageHref), 2000, 'next page link').catch(() => '');
  }

  /**
   * Check the current page URL and handle if it's not allowed
   * @throws URLNotAllowedError if the current URL is not allowed
   */
  private async _checkAndHandleNavigation(): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }

    const currentUrl = this._puppeteerPage.url();

    // New tab pages (about:blank, chrome://new-tab-page) are a valid navigation state.
    // Only mark as invalid for URLs that are explicitly blocked.
    if (isNewTabPage(currentUrl)) {
      // Silently allow — do not change _validWebPage, do not throw
      return;
    }

    if (!isUrlAllowed(currentUrl, this._config.allowedUrls, this._config.deniedUrls)) {
      const errorMessage = `URL: ${currentUrl} is not allowed`;
      logger.error(errorMessage);

      // Navigate to home page or about:blank
      const safeUrl = this._config.homePageUrl || 'about:blank';
      logger.info(`Redirecting to safe URL: ${safeUrl}`);

      try {
        await this._puppeteerPage.goto(safeUrl);
      } catch (error) {
        logger.error(`Failed to redirect to safe URL: ${error instanceof Error ? error.message : String(error)}`);
      }

      throw new URLNotAllowedError(errorMessage);
    }
  }
}

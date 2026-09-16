import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => {
  return {};
});

vi.mock('puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js', () => {
  return {
    connect: vi.fn(),
    ExtensionTransport: {
      connectTab: vi.fn(),
    },
  };
});

import Page, { build_initial_state, coverBlocker, getAdaptiveDomRetryDelayMs, normalizeKeyCombo, pointerTarget, settleSparseRead, toNativeInputValue, typingMethod } from '../page';
import { DOMElementNode } from '../dom/views';
import { URLNotAllowedError } from '../views';
import type { IBrowserAdapter } from '../../adapters/IBrowserAdapter';

describe('Page locateElement', () => {
  it('adopts the element by backendNodeId in the frame it was read from', async () => {
    const handle = { isHidden: vi.fn().mockResolvedValue(true) };
    const adoptInFrame = vi.fn().mockResolvedValue(handle);
    const adoptInMain = vi.fn();
    const page = new Page(1, 'https://example.com/', 'Example', {}, {} as IBrowserAdapter);
    Object.assign(page as unknown as Record<string, unknown>, {
      _validWebPage: true,
      _puppeteerPage: { mainFrame: () => ({ mainRealm: () => ({ adoptBackendNode: adoptInMain }) }) },
      ensurePuppeteerConnected: vi.fn().mockResolvedValue(undefined),
    });
    const node = new DOMElementNode({
      tagName: 'button',
      xpath: null,
      attributes: {},
      children: [],
      isVisible: true,
      highlightIndex: 3,
      backendNodeId: 42,
      frame: { mainRealm: () => ({ adoptBackendNode: adoptInFrame }) } as unknown as DOMElementNode['frame'],
    });

    await expect(page.locateElement(node)).resolves.toBe(handle);
    expect(adoptInFrame).toHaveBeenCalledWith(42);
    expect(adoptInMain).not.toHaveBeenCalled();
  });

  it('returns null when the node is gone from the page', async () => {
    const page = new Page(1, 'https://example.com/', 'Example', {}, {} as IBrowserAdapter);
    Object.assign(page as unknown as Record<string, unknown>, {
      _validWebPage: true,
      _puppeteerPage: { mainFrame: () => ({ mainRealm: () => ({ adoptBackendNode: vi.fn().mockRejectedValue(new Error('No node with given id found')) }) }) },
      ensurePuppeteerConnected: vi.fn().mockResolvedValue(undefined),
    });
    const node = new DOMElementNode({ tagName: 'a', xpath: null, attributes: {}, children: [], isVisible: true, backendNodeId: 7 });

    await expect(page.locateElement(node)).resolves.toBeNull();
  });
});

describe('Page DOM retry timing', () => {
  it('uses short adaptive retry delays instead of repeated fixed waits', () => {
    expect(getAdaptiveDomRetryDelayMs(1)).toBe(250);
    expect(getAdaptiveDomRetryDelayMs(2)).toBe(500);
    expect(getAdaptiveDomRetryDelayMs(3)).toBe(750);
  });
});

describe('Page state cache', () => {
  const pageState = (url: string) => ({ ...build_initial_state(1, url, 'T') });
  const deferred = () => {
    let resolve!: (value: ReturnType<typeof pageState>) => void;
    const promise = new Promise<ReturnType<typeof pageState>>(r => (resolve = r));
    return { promise, resolve };
  };

  it('does not cache or share a read that an invalidation overtook', async () => {
    const page = new Page(1, 'https://example.com/', 'T', {}, { getTab: vi.fn() } as unknown as IBrowserAdapter);
    const reads = [deferred(), deferred()];
    const readState = vi.fn().mockReturnValueOnce(reads[0].promise).mockReturnValueOnce(reads[1].promise);
    (page as unknown as { _readState: typeof readState })._readState = readState;

    const stale = page.getState();
    page.invalidateCache();
    const fresh = page.getState();
    expect(readState).toHaveBeenCalledTimes(2);

    reads[0].resolve(pageState('https://example.com/old'));
    await stale;
    expect(page.getCachedState()).toBeNull();

    reads[1].resolve(pageState('https://example.com/new'));
    expect((await fresh).url).toBe('https://example.com/new');
    expect(page.getCachedState()?.url).toBe('https://example.com/new');
  });

  it('serves the cache only while the tab is still on the cached URL', async () => {
    const adapter = { getTab: vi.fn().mockResolvedValue({ url: 'https://example.com/a' }) };
    const page = new Page(1, 'https://example.com/a', 'T', {}, adapter as unknown as IBrowserAdapter);
    (page as unknown as { _readState: unknown })._readState = vi.fn()
      .mockResolvedValueOnce(pageState('https://example.com/a'))
      .mockResolvedValueOnce(pageState('https://example.com/b'));

    await page.getState();
    expect((await page.getCurrentState()).url).toBe('https://example.com/a');

    adapter.getTab.mockResolvedValue({ url: 'https://example.com/b' });
    expect((await page.getCurrentState()).url).toBe('https://example.com/b');
  });
});

describe('Page firewall', () => {
  it('refuses to read a page whose live URL is not allowed and leaves it', async () => {
    const adapter = { getTab: vi.fn().mockResolvedValue({ url: 'file:///etc/passwd', title: 'passwd' }) };
    const page = new Page(1, 'https://ok.example/', 'OK', {}, adapter as unknown as IBrowserAdapter);
    const goto = vi.fn().mockResolvedValue(null);
    Object.assign(page as unknown as Record<string, unknown>, { _puppeteerPage: { goto, url: () => 'file:///etc/passwd' } });

    await expect(page._updateState()).rejects.toBeInstanceOf(URLNotAllowedError);
    expect(goto).toHaveBeenCalledWith('about:blank');
  });
});

describe('normalizeKeyCombo', () => {
  it.each([
    ['Enter', [], 'Enter'],
    ['esc', [], 'Escape'],
    ['PAGE_DOWN', [], 'PageDown'],
    ['page down', [], 'PageDown'],
    ['F5', [], 'F5'],
    ['space', [], 'Space'],
    ['ctrl+a', ['Control'], 'a'],
    ['Control+Shift+T', ['Control', 'Shift'], 'T'],
    ['cmd+c', ['Meta'], 'c'],
    ['Control++', ['Control'], '+'],
  ])('%s', (combo, modifiers, key) => {
    expect(normalizeKeyCombo(combo)).toEqual({ modifiers, key });
  });

  it('rejects unknown keys and modifiers with the allowed names', () => {
    expect(() => normalizeKeyCombo('Hyper')).toThrow(/Unknown key "Hyper".*PageDown/);
    expect(() => normalizeKeyCombo('Hyper+a')).toThrow(/Unknown modifier "Hyper"/);
  });
});

describe('Page with an open dialog', () => {
  it('does not inject scripts into the page, which would block until the dialog closes', async () => {
    const adapter = { executeScript: vi.fn() };
    const page = new Page(1, 'https://example.com/', 'Example', {}, adapter as unknown as IBrowserAdapter);
    Object.assign(page as unknown as Record<string, unknown>, { _pendingDialog: { type: () => 'confirm' } });

    await page.removeHighlight();

    expect(adapter.executeScript).not.toHaveBeenCalled();
  });
});

describe('Page read retries', () => {
  it('accepts a read with text but no interactive elements instead of retrying it', async () => {
    const adapter = { getTab: vi.fn().mockResolvedValue({ url: 'https://example.com/done', title: 'Done' }) };
    const page = new Page(1, 'https://example.com/done', 'Done', {}, adapter as unknown as IBrowserAdapter);
    const textOnly = build_initial_state(1, 'https://example.com/done', 'Done');
    textOnly.elementTree.children.push(new DOMElementNode({ tagName: 'h1', xpath: null, attributes: {}, children: [], isVisible: true }));
    const updateState = vi.fn().mockResolvedValue(textOnly);
    Object.assign(page as unknown as Record<string, unknown>, {
      _validWebPage: true,
      _lastReadUrl: 'https://example.com/done',
      _updateState: updateState,
      _waitForDomStability: vi.fn().mockResolvedValue(undefined),
    });

    const state = await page.getState();

    expect(state.url).toBe('https://example.com/done');
    expect(updateState).toHaveBeenCalledTimes(1);
  });
});

describe('settleSparseRead', () => {
  const read = (size: number) => ({ size, selectorMap: new Map(Array.from({ length: size }, (_, i) => [i, i])) });
  const fast = { maxWaitMs: 200, intervalMs: 5 };

  it('reads again after a navigation until the controls appear', async () => {
    const reads = vi.fn().mockResolvedValueOnce(read(0)).mockResolvedValueOnce(read(1)).mockResolvedValueOnce(read(12));
    const state = await settleSparseRead(read(0), reads, vi.fn().mockResolvedValue(false), { justNavigated: true, ...fast });
    expect(state.size).toBe(12);
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it('costs one re-read for a loaded page that really has almost no controls', async () => {
    const reads = vi.fn().mockResolvedValue(read(1));
    const state = await settleSparseRead(read(1), reads, vi.fn().mockResolvedValue(false), { justNavigated: true, ...fast });
    expect(state.size).toBe(1);
    expect(reads).toHaveBeenCalledTimes(1);

    const none = vi.fn().mockResolvedValue(read(0));
    await settleSparseRead(read(0), none, vi.fn().mockResolvedValue(false), { justNavigated: true, ...fast });
    expect(none).toHaveBeenCalledTimes(2);
  });

  it('waits while the document loads, within the time limit', async () => {
    const reads = vi.fn().mockResolvedValue(read(0));
    const startedAt = Date.now();
    await settleSparseRead(read(0), reads, vi.fn().mockResolvedValue(true), { justNavigated: false, ...fast });
    expect(Date.now() - startedAt).toBeLessThan(400);
    expect(reads.mock.calls.length).toBeGreaterThan(3);
  });

  it('does not wait for a loaded page read without a navigation, or for a page with controls', async () => {
    const reads = vi.fn();
    await settleSparseRead(read(0), reads, vi.fn().mockResolvedValue(false), { justNavigated: false, ...fast });
    await settleSparseRead(read(3), reads, vi.fn().mockResolvedValue(true), { justNavigated: true, ...fast });
    expect(reads).not.toHaveBeenCalled();
  });

  it('keeps the read it has when a re-read fails', async () => {
    const reads = vi.fn().mockResolvedValue(null);
    const first = read(0);
    await expect(settleSparseRead(first, reads, vi.fn().mockResolvedValue(true), { justNavigated: true, ...fast })).resolves.toBe(first);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});

describe('Page read right after a navigation', () => {
  it('does not report a transient blank read when a read shortly after has content', async () => {
    const adapter = { getTab: vi.fn().mockResolvedValue({ url: 'https://example.com/results', title: 'Results' }) };
    const page = new Page(1, 'https://example.com/', 'Home', {}, adapter as unknown as IBrowserAdapter);
    const blank = build_initial_state(1, 'https://example.com/results', 'Results');
    blank.elementTree.children.push(new DOMElementNode({ tagName: 'div', xpath: null, attributes: {}, children: [], isVisible: true }));
    const full = build_initial_state(1, 'https://example.com/results', 'Results');
    full.elementTree.children.push(new DOMElementNode({ tagName: 'div', xpath: null, attributes: {}, children: [], isVisible: true }));
    for (let i = 0; i < 5; i++) {
      full.selectorMap.set(i, new DOMElementNode({ tagName: 'a', xpath: null, attributes: {}, children: [], isVisible: true, highlightIndex: i }));
    }
    const updateState = vi.fn().mockResolvedValueOnce(blank).mockResolvedValue(full);
    Object.assign(page as unknown as Record<string, unknown>, {
      _validWebPage: true,
      _lastReadUrl: 'https://example.com/',
      _updateState: updateState,
      waitForPageAndFramesLoad: vi.fn().mockResolvedValue(undefined),
      _waitForDomStability: vi.fn().mockResolvedValue(undefined),
    });

    const state = await page.getState();

    expect(state.selectorMap.size).toBe(5);
    expect(updateState).toHaveBeenCalledTimes(2);
  });
});

describe('pointerTarget', () => {
  const element = (width: number, height: number, extra: Record<string, unknown> = {}) =>
    ({ getBoundingClientRect: () => ({ width, height }), querySelectorAll: () => [], labels: null, ...extra }) as unknown as Element;

  it('aims at an element that has a box', () => {
    const el = element(20, 20);
    expect(pointerTarget(el)).toBe(el);
  });

  it('aims at the visible label of a hidden checkbox', () => {
    const label = element(80, 20);
    const input = element(0, 0, { labels: [element(0, 0), label] });
    expect(pointerTarget(input)).toBe(label);
  });

  it('aims at the first visible descendant of an inline wrapper', () => {
    const image = element(50, 50);
    const link = element(0, 0, { querySelectorAll: () => [element(0, 0), image] });
    expect(pointerTarget(link)).toBe(image);
  });
});

describe('typingMethod', () => {
  it('types with key presses unless the text is very long or has a line break for a single-line field', () => {
    expect(typingMethod('05/20/2024', 'text')).toBe('keys');
    expect(typingMethod('S3cret!', 'password')).toBe('keys');
    expect(typingMethod('line one\nline two', 'textarea')).toBe('keys');
    expect(typingMethod('line one\nline two', 'contenteditable')).toBe('keys');
    expect(typingMethod('line one\nline two', 'text')).toBe('insert');
    expect(typingMethod('x'.repeat(301), 'textarea')).toBe('insert');
  });
});

describe('toNativeInputValue', () => {
  it.each([
    ['2024-05-20', 'date', '2024-05-20'],
    ['2024/5/2', 'date', '2024-05-02'],
    ['05/20/2024', 'date', '2024-05-20'],
    ['20/05/2024', 'date', '2024-05-20'],
    ['20.05.2024', 'date', '2024-05-20'],
    ['May 20, 2024', 'date', '2024-05-20'],
    ['Monday, May 20, 2024', 'date', '2024-05-20'],
    ['20 May 2024', 'date', '2024-05-20'],
    ['Sept 3rd 2024', 'date', '2024-09-03'],
    ['2024-05-20T10:00', 'date', '2024-05-20'],
    ['15:30', 'time', '15:30'],
    ['3:30 PM', 'time', '15:30'],
    ['12 am', 'time', '00:00'],
    ['09:05:30', 'time', '09:05:30'],
    ['2024-05-20T15:30', 'datetime-local', '2024-05-20T15:30'],
    ['2024-05-20 15:30', 'datetime-local', '2024-05-20T15:30'],
    ['May 20, 2024 at 3:30 pm', 'datetime-local', '2024-05-20T15:30'],
    ['05/20/2024, 9:00 AM', 'datetime-local', '2024-05-20T09:00'],
    ['2024-05', 'month', '2024-05'],
    ['05/2024', 'month', '2024-05'],
    ['May 2024', 'month', '2024-05'],
    ['#ff0000', 'color', '#ff0000'],
  ])('%s as %s', (text, type, value) => {
    expect(toNativeInputValue(text, type)).toBe(value);
  });

  it.each([
    ['next Friday', 'date'],
    ['13/13/2024', 'date'],
    ['25:00', 'time'],
    ['13 pm', 'time'],
    ['2024-05-20', 'datetime-local'],
    ['2024-13', 'month'],
  ])('refuses %s as %s', (text, type) => {
    expect(toNativeInputValue(text, type)).toBeNull();
  });
});

describe('Page inputTextNode on a native date field', () => {
  const dateField = (evaluate: ReturnType<typeof vi.fn>) => {
    const page = new Page(1, 'https://example.com/', 'Example', {}, {} as IBrowserAdapter);
    const dispatchMouse = vi.fn();
    Object.assign(page as unknown as Record<string, unknown>, {
      _requireHandle: vi.fn().mockResolvedValue({ evaluate }),
      _dispatchMouse: dispatchMouse,
    });
    return { page, dispatchMouse };
  };

  it('sets the value directly from a written date and reports the value the field holds', async () => {
    let value = '';
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ mode: 'setter', type: 'date', secret: false })
      .mockImplementationOnce(async (_fn: unknown, next: string) => {
        value = next;
      })
      .mockImplementation(async () => value);
    const { page, dispatchMouse } = dateField(evaluate);

    await expect(page.inputTextNode(new DOMElementNode({ tagName: 'input', xpath: null, attributes: {}, children: [], isVisible: true }), 'May 20, 2024'))
      .resolves.toEqual({ matched: true, secret: false, actualLength: 10, actual: '2024-05-20' });
    expect(dispatchMouse).not.toHaveBeenCalled();
  });

  it('refuses text that is not a date with the format to use', async () => {
    const evaluate = vi.fn().mockResolvedValueOnce({ mode: 'setter', type: 'date', secret: false });
    const { page } = dateField(evaluate);
    await expect(page.inputTextNode(new DOMElementNode({ tagName: 'input', xpath: null, attributes: {}, children: [], isVisible: true }), 'soon'))
      .rejects.toThrow(/2024-05-20/);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('coverBlocker', () => {
  let all: Fake[] = [];
  /** A minimal element: tag, attributes, children, rendered text and CSS position; selectors are tag and [attr="v"] lists. */
  class Fake {
    parentElement: Fake | null = null;
    children: Fake[];
    ownerDocument = { getElementById: (id: string) => all.find(node => node.id === id) ?? null };
    constructor(
      public tagName: string,
      public attrs: Record<string, string> = {},
      kids: Fake[] = [],
      private ownText = '',
      public position = 'static',
    ) {
      for (const kid of kids) kid.parentElement = this;
      this.children = kids;
      all.push(this);
    }
    get id() {
      return this.attrs.id ?? '';
    }
    get innerText(): string {
      return [this.ownText, ...this.children.map(kid => kid.innerText)].filter(Boolean).join(' ');
    }
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 10, height: 10 };
    }
    contains(other: Fake): boolean {
      return other === this || this.children.some(kid => kid.contains(other));
    }
    closest() {
      return null;
    }
    descendants(): Fake[] {
      return this.children.flatMap(kid => [kid, ...kid.descendants()]);
    }
    matches(selector: string) {
      return selector.split(',').some(part => {
        const m = /^([a-z0-9]*)((?:\[[^\]]+\])*)$/.exec(part.trim());
        if (!m || (m[1] && m[1] !== this.tagName.toLowerCase())) return false;
        return [...m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) =>
          value === undefined ? name in this.attrs : this.attrs[name] === value,
        );
      });
    }
    querySelectorAll(selector: string) {
      return this.descendants().filter(node => node.matches(selector));
    }
    querySelector(selector: string) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  }
  const mount = (target: Fake, hit: Fake, body: Fake, activeElement: Fake | null = null) => {
    Object.assign(target, {
      getRootNode: () => ({ elementFromPoint: () => hit, activeElement, querySelectorAll: (s: string) => body.querySelectorAll(s) }),
    });
    return coverBlocker(target as unknown as Element, false, true);
  };

  beforeEach(() => {
    all = [];
    vi.stubGlobal('getComputedStyle', (node: Fake) => ({ position: node.position }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names a fixed banner by its heading and lists its buttons', () => {
    const accept = new Fake('BUTTON', {}, [], 'Accept all');
    const close = new Fake('BUTTON', { 'aria-label': 'Close' }, [], '×');
    const text = new Fake('P', {}, [], 'We use cookies to improve your experience on this website and more');
    const banner = new Fake('DIV', {}, [new Fake('H2', {}, [], 'Your privacy choices'), text, accept, close], '', 'fixed');
    const target = new Fake('BUTTON', {}, [], 'Search');
    const body = new Fake('BODY', {}, [banner, target]);

    expect(mount(target, text, body)).toEqual({
      message: 'The element is covered by <div> "Your privacy choices"',
      buttons: ['Accept all', 'Close'],
    });
  });

  it('names a dialog by aria-labelledby and says it is a dialog', () => {
    const title = new Fake('SPAN', { id: 't' }, [], 'Sign in to continue');
    const dialog = new Fake('DIV', { role: 'dialog', 'aria-labelledby': 't' }, [title, new Fake('BUTTON', {}, [], 'Not now')]);
    const target = new Fake('A', {}, [], 'Orders');
    const body = new Fake('BODY', {}, [dialog, target]);

    expect(mount(target, title, body)?.message).toBe('The element is covered by <div> dialog "Sign in to continue"');
  });

  it('names the open dialog when the hit is its empty backdrop', () => {
    const backdrop = new Fake('DIV', { class: 'backdrop' }, [], '', 'fixed');
    const dialog = new Fake('DIV', { 'aria-modal': 'true', 'aria-label': 'Choose your location' }, [new Fake('BUTTON', {}, [], 'Done')]);
    const target = new Fake('BUTTON', {}, [], 'Add to cart');
    const body = new Fake('BODY', {}, [backdrop, dialog, target]);

    expect(mount(target, backdrop, body)).toEqual({
      message: 'The element is covered by <div> behind the dialog "Choose your location"',
      buttons: ['Done'],
    });
  });

  it('clips a long covering text to about 60 characters', () => {
    const layer = new Fake('DIV', {}, [], 'x'.repeat(200), 'sticky');
    const target = new Fake('BUTTON');
    const message = mount(target, layer, new Fake('BODY', {}, [layer, target]))!.message;
    expect(message).toBe(`The element is covered by <div> "${'x'.repeat(59)}…"`);
  });

  it("says when the target's own open list covers it", () => {
    const option = new Fake('LI', { role: 'option' }, [], 'Paris');
    const list = new Fake('UL', { id: 'suggestions', role: 'listbox' }, [option]);
    const target = new Fake('INPUT', { role: 'combobox', 'aria-controls': 'suggestions', 'aria-expanded': 'true' });
    const blocker = mount(target, option, new Fake('BODY', {}, [target, list]))!;
    expect(blocker.message).toMatch(/^The element is covered by <li> its own open list of suggestions: choose an option/);
    expect(blocker.buttons).toBeUndefined();
  });

  it("says when the focused field's open list covers the target", () => {
    const option = new Fake('LI', { role: 'option' }, [], 'Paris');
    const list = new Fake('UL', { role: 'listbox' }, [option]);
    const field = new Fake('INPUT', { 'aria-label': 'Destination', 'aria-expanded': 'true' });
    const target = new Fake('BUTTON', {}, [], 'Search');
    expect(mount(target, option, new Fake('BODY', {}, [field, list, target]), field)?.message).toBe(
      'The element is covered by <li> the open list of suggestions of the focused field "Destination": choose an option from it, or press Escape to close it first',
    );
  });

  it('does not refuse a target that is on top', () => {
    const target = new Fake('BUTTON');
    expect(mount(target, target, new Fake('BODY', {}, [target]))).toBeNull();
  });
});

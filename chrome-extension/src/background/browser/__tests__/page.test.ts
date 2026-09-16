import { describe, expect, it, vi } from 'vitest';

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

import Page, { build_initial_state, getAdaptiveDomRetryDelayMs, normalizeKeyCombo, pointerTarget, toNativeInputValue, typingMethod } from '../page';
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

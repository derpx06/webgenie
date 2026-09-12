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

import Page, { build_initial_state, getAdaptiveDomRetryDelayMs, normalizeKeyCombo } from '../page';
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

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

import Page, { build_initial_state, getAdaptiveDomRetryDelayMs } from '../page';
import { DOMElementNode } from '../dom/views';
import type { IBrowserAdapter } from '../../adapters/IBrowserAdapter';

describe('Page locateElement', () => {
  it('does not query an empty healed CSS selector before trying XPath or heuristics', async () => {
    const adapter = {
      detachDebugger: vi.fn().mockResolvedValue(undefined),
    } as any;
    const page = new Page(1, 'https://x.com/sama', 'X', {}, adapter);
    const handle = {
      isHidden: vi.fn().mockResolvedValue(false),
    };
    const query = vi.fn(async (selector: string) => {
      if (selector === '') {
        throw new DOMException(
          "Failed to execute 'querySelector' on 'Document': The provided selector is empty.",
          'SyntaxError',
        );
      }
      if (selector === '::-p-xpath(/html/body/button[1])') {
        return handle;
      }
      return null;
    });

    const target = new DOMElementNode({
      tagName: 'button',
      xpath: null,
      attributes: {
        role: 'button',
        'aria-label': 'Follow @sama',
        'aria-description': 'Click to Follow sama',
      },
      children: [],
      isVisible: true,
      highlightIndex: 42,
    });
    const healedCandidate = new DOMElementNode({
      tagName: 'button',
      xpath: null,
      attributes: {
        role: 'button',
        'aria-label': 'Follow @sama',
        'aria-description': 'Click to Follow sama',
      },
      children: [],
      isVisible: true,
      highlightIndex: 42,
    });

    (page as any)._validWebPage = true;
    (page as any)._puppeteerPage = { $: query };
    (page as any)._state.selectorMap = new Map([[42, healedCandidate]]);
    (page as any).ensurePuppeteerConnected = vi.fn().mockResolvedValue(undefined);
    (page as any)._scrollIntoViewIfNeeded = vi.fn().mockResolvedValue(undefined);
    (page as any)._heuristicLocate = vi.fn().mockResolvedValue(handle);

    await expect(page.locateElement(target)).resolves.toBe(handle);
    expect(query).not.toHaveBeenCalledWith('');
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

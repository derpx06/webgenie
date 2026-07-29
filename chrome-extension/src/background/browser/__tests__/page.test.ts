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

import Page, { getAdaptiveDomRetryDelayMs } from '../page';
import { DOMElementNode } from '../dom/views';

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

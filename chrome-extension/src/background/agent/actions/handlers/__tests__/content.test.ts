import { describe, expect, it, vi } from 'vitest';
import { DOMElementNode } from '../../../../browser/dom/views';
import type { AgentContext } from '../../../types';
import { ContentHandler, findPassages } from '../content';

vi.mock('@extension/i18n', () => ({
  t: (key: string) => key,
}));

function createElement(index: number): DOMElementNode {
  return new DOMElementNode({
    tagName: 'DIV',
    xpath: `/div[${index + 1}]`,
    attributes: {},
    children: [],
    isVisible: true,
    isInViewport: true,
    highlightIndex: index,
  });
}

function handlerFor(page: Record<string, unknown>, context: Record<string, unknown> = {}) {
  const agentContext = {
    emitEvent: vi.fn(),
    findings: [],
    nSteps: 1,
    browserContext: { getCurrentPage: vi.fn(async () => page) },
    ...context,
  } as unknown as AgentContext;
  return { handler: new ContentHandler(agentContext), context: agentContext };
}

describe('ContentHandler scroll', () => {
  it('scrolls an element at index 0 to its top', async () => {
    const element = createElement(0);
    const page = {
      getCurrentState: vi.fn(async () => ({ selectorMap: new Map([[0, element]]) })),
      scrollToPercent: vi.fn(),
      getScrollInfo: vi.fn(),
    };
    const { handler } = handlerFor(page);

    await handler.handleScroll({ direction: 'top', index: 0 });

    expect(page.scrollToPercent).toHaveBeenCalledWith(0, element);
    expect(page.getScrollInfo).not.toHaveBeenCalled();
  });

  it('scrolls the page by pages, and reports content that loaded once it reached the bottom', async () => {
    const page = {
      scrollByPages: vi.fn(),
      getScrollInfo: vi
        .fn()
        .mockResolvedValueOnce([0, 500, 1000])
        .mockResolvedValueOnce([500, 500, 1000])
        .mockResolvedValue([500, 500, 1600]),
    };
    const { handler } = handlerFor(page);

    const down = await handler.handleScroll({ direction: 'down', pages: 2 });

    expect(page.scrollByPages).toHaveBeenCalledWith(2, undefined);
    expect(down.extractedContent).toContain('Scrolled down 2 pages.');
    expect(down.extractedContent).toContain('The page grew from 1000 to 1600 px');

    page.getScrollInfo.mockReset().mockResolvedValue([500, 500, 1600]);
    const up = await handler.handleScroll({ direction: 'up', pages: 0.5 });
    expect(page.scrollByPages).toHaveBeenLastCalledWith(-0.5, undefined);
    expect(up.extractedContent).toBe('Scrolled up 0.5 pages.');
  });

  it('reports an index that is not on the page instead of scrolling', async () => {
    const page = { getCurrentState: vi.fn(async () => ({ selectorMap: new Map() })), scrollByPages: vi.fn() };
    const { handler } = handlerFor(page);

    const result = await handler.handleScroll({ direction: 'down', index: 9 });

    expect(result.error).toBe('act_errors_elementNotExist');
    expect(page.scrollByPages).not.toHaveBeenCalled();
  });
});

describe('ContentHandler page text', () => {
  const text = `${'a'.repeat(12000)}TAIL price $42 end`;

  it('reads 12,000 characters at a time and names start_char to continue', async () => {
    const { handler } = handlerFor({ getCompletePageContent: vi.fn(async () => text) });

    const first = await handler.handleGetCompletePageContent({});
    expect(first.extractedContent).toContain('truncated at character 12000 of 12018; call get_complete_page_content with start_char 12000');
    expect(first.extractedContent).not.toContain('TAIL');

    const rest = await handler.handleGetCompletePageContent({ start_char: 12000 });
    expect(rest.extractedContent).toContain('[characters 12000-12018 of 12018]\nTAIL price $42 end');
    expect(rest.extractedContent).not.toContain('truncated');
  });

  it('returns only the passages that contain the text, with their offsets', async () => {
    const { handler } = handlerFor({ getCompletePageContent: vi.fn(async () => text) });

    const found = await handler.handleGetCompletePageContent({ find: 'PRICE' });
    expect(found.extractedContent).toContain('1 match for "PRICE":\n[at character 11905]');
    expect(found.extractedContent).toContain('TAIL price $42 end');

    const missing = await handler.handleGetCompletePageContent({ find: 'discount' });
    expect(missing.extractedContent).toContain('No match for "discount" in the page text (12018 characters).');
  });

  it('merges matches that share their context', () => {
    expect(findPassages('Total: 3 items. Total due: $30.', 'total')).toBe('2 matches for "total":\n[at character 0] Total: 3 items. Total due: $30.');
  });

  it('answers an unchanged re-read with a note while the earlier read is recent, and resends it later', async () => {
    const { handler, context } = handlerFor({ getCompletePageContent: vi.fn(async () => 'Short page') });

    await handler.handleGetCompletePageContent({});
    const again = await handler.handleGetCompletePageContent({});
    expect(again.extractedContent).toContain('same as your previous read (10 characters)');

    context.nSteps = 10;
    const later = await handler.handleGetCompletePageContent({});
    expect(later.extractedContent).toContain('Short page');
  });
});

describe('ContentHandler save_findings', () => {
  it('keeps findings on the task context', async () => {
    const { handler, context } = handlerFor({});

    await handler.handleSaveFindings({ text: '  Book A: $10  ' });

    expect(context.findings).toEqual(['Book A: $10']);
  });
});

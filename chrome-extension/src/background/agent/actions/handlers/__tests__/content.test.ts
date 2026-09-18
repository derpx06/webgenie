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
    browserContext: { getCurrentPage: vi.fn(async () => ({ url: () => 'https://example.test/', ...page })) },
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

  it('checks for new content when the page stops a scrollbar short of its end', async () => {
    const page = {
      scrollByPages: vi.fn(),
      getScrollInfo: vi
        .fn()
        .mockResolvedValueOnce([0, 800, 2000])
        .mockResolvedValueOnce([1185, 800, 2000])
        .mockResolvedValue([1185, 800, 2600]),
    };
    const { handler } = handlerFor(page);

    const down = await handler.handleScroll({ direction: 'down', pages: 2 });

    expect(down.extractedContent).toContain('The page grew from 2000 to 2600 px');
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

  it('says the whole page was read when start_char is at or past the end', async () => {
    const { handler } = handlerFor({ getCompletePageContent: vi.fn(async () => text) });

    const past = await handler.handleGetCompletePageContent({ start_char: 12018 });
    expect(past.extractedContent).toContain('start_char 12018 is at or past the end of the page text (12018 characters): the whole page has been read');
    expect(past.extractedContent).not.toContain('TAIL');
  });

  it('bounds the passages a find returns on a very large page', async () => {
    const { handler, context } = handlerFor({ getCompletePageContent: vi.fn(async () => 'filler words '.repeat(5000) + 'match here '.repeat(40000)) });

    const found = await handler.handleGetCompletePageContent({ find: 'match' });
    expect(found.extractedContent!.length).toBeLessThan(12500);
    expect(vi.mocked(context.emitEvent).mock.calls.at(-1)?.[2]).toContain('Searched 505000 characters of page text for "match"');
  });

  it('merges matches that share their context', () => {
    expect(findPassages('Total: 3 items. Total due: $30.', 'total')).toBe('2 matches for "total":\n[at character 0] Total: 3 items. Total due: $30.');
  });

  it('returns a matched table row whole, with the table header, instead of a window into the next row', () => {
    const page = 'Results\nName\tWins\tLosses\nAmber\t12\t3\nBirch\t7\t9\nFooter text';
    expect(findPassages(page, 'birch')).toBe('1 match for "birch":\n[at character 36] table header: Name | Wins | Losses\n  row: Birch | 7 | 9');
    // Pipe-separated rows count as a table; two matches in one row give the row once.
    expect(findPassages('| Item | Price |\n| Pen 2 | Pen $3 |', 'pen')).toBe('2 matches for "pen":\n[at character 17] table header: Item | Price\n  row: Pen 2 | Pen $3');
    // Text outside a table keeps the passage around the match.
    expect(findPassages(page, 'footer')).toContain('[at character 0] Results Name Wins Losses Amber 12 3 Birch 7 9 Footer text');
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

describe('ContentHandler read_page', () => {
  const article = [
    '# Coffee',
    'Intro about coffee, roughly forty characters long.',
    '## Roasting',
    'r'.repeat(5000),
    '## Brewing',
    'b'.repeat(5000),
  ].join('\n\n');

  function readablePage(markdown: string, extra: Record<string, unknown> = {}) {
    return {
      url: () => 'https://example.test/coffee',
      readPageMarkdown: vi.fn(async () => markdown),
      nextPageHref: vi.fn(async () => ''),
      navigateTo: vi.fn(),
      getScrollInfo: vi.fn(async () => [0, 500, 1000]),
      scrollToPercent: vi.fn(),
      ...extra,
    };
  }

  it('returns the first chunk with the outline and a cursor, and keeps the read on the context', async () => {
    const page = readablePage(article);
    const { handler, context } = handlerFor(page);

    const first = await handler.handleReadPage({ max_tokens: 500 });

    expect(page.readPageMarkdown).toHaveBeenCalledWith('main');
    expect(first.extractedContent).toContain('https://example.test/coffee — main content');
    expect(first.extractedContent).toContain('s2 ## Roasting [');
    expect(first.extractedContent).toContain('read on with read_page cursor');
    expect(context.pageRead).toEqual({ url: 'https://example.test/coffee', text: article });
  });

  it('jumps to a section instead of reading up to it, and lists the sections when there is no such one', async () => {
    const { handler } = handlerFor(readablePage(article));

    const brewing = await handler.handleReadPage({ section: 'Brewing' });
    expect(brewing.extractedContent).toContain('section s3 "Brewing"');
    expect(brewing.extractedContent).toContain('b'.repeat(100));
    expect(brewing.extractedContent).not.toContain('r'.repeat(100));

    const missing = await handler.handleReadPage({ section: 'Grinding' });
    expect(missing.extractedContent).toContain('No section "Grinding" on this page');
    expect(missing.extractedContent).toContain('s3 ## Brewing [');
  });

  it('continues from a cursor and says when the whole page has been read', async () => {
    const { handler } = handlerFor(readablePage(article));

    const first = await handler.handleReadPage({ max_tokens: 500 });
    const cursor = Number(/read_page cursor (\d+)/.exec(first.extractedContent ?? '')?.[1]);
    expect(cursor).toBeGreaterThan(0);

    const next = await handler.handleReadPage({ max_tokens: 500, cursor });
    expect(next.extractedContent).toContain(`from character ${cursor}`);

    const past = await handler.handleReadPage({ cursor: article.length + 5 });
    expect(past.extractedContent).toContain('at or past the end of the text');
  });

  it('returns the outline alone in structured mode', async () => {
    const { handler } = handlerFor(readablePage(article));

    const outline = await handler.handleReadPage({ mode: 'structured' });

    expect(outline.extractedContent).toContain('outline only, ');
    expect(outline.extractedContent).toContain('s1 # Coffee [');
    expect(outline.extractedContent).not.toContain('r'.repeat(100));
  });

  it('opens a target address before reading it', async () => {
    const page = readablePage(article);
    const { handler } = handlerFor(page);

    await handler.handleReadPage({ target: 'https://example.test/other' });

    expect(page.navigateTo).toHaveBeenCalledWith('https://example.test/other');
  });

  it('follows next-page links up to max_pages and says how many pages it read', async () => {
    let pageNumber = 1;
    const page = readablePage('', {
      readPageMarkdown: vi.fn(async () => `# Page ${pageNumber}\n\nrow ${pageNumber}`),
      nextPageHref: vi.fn(async () => (pageNumber < 9 ? `https://example.test/p${pageNumber + 1}` : '')),
      navigateTo: vi.fn(async () => {
        pageNumber++;
      }),
    });
    const { handler } = handlerFor(page);

    const all = await handler.handleReadPage({ all_pages: true, max_pages: 3 });

    expect(page.navigateTo).toHaveBeenCalledTimes(2);
    expect(all.extractedContent).toContain('3 pages');
    expect(all.extractedContent).toContain('# Page 3');
  });

  it('loads more by scrolling when the list has no next link, and stops when nothing grows', async () => {
    let height = 1000;
    let markdown = '# List\n\nitem 1';
    const page = readablePage('', {
      readPageMarkdown: vi.fn(async () => markdown),
      getScrollInfo: vi.fn(async () => [0, 500, height]),
      scrollToPercent: vi.fn(async () => {
        if (height === 1000) {
          height = 2000;
          markdown += '\n\nitem 2';
        }
      }),
    });
    const { handler } = handlerFor(page);

    const all = await handler.handleReadPage({ all_pages: true, max_pages: 4 });

    expect(all.extractedContent).toContain('item 2');
    expect(all.extractedContent).toContain('2 pages');
  });

  it('reports a failed read instead of throwing', async () => {
    const { handler } = handlerFor(
      readablePage('', {
        readPageMarkdown: vi.fn(async () => {
          throw new Error('debugger detached');
        }),
      }),
    );

    const failed = await handler.handleReadPage({});

    expect(failed.error).toContain('Could not read the page: debugger detached');
  });
});

describe('ContentHandler save_findings', () => {
  it('keeps findings on the task context', async () => {
    const { handler, context } = handlerFor({});

    await handler.handleSaveFindings({ text: '  Book A: $10  ' });

    expect(context.findings).toEqual(['Book A: $10']);
  });
});

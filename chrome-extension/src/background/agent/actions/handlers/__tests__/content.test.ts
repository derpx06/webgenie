import { describe, expect, it, vi } from 'vitest';
import { DOMElementNode } from '../../../../browser/dom/views';
import type { AgentContext } from '../../../types';
import { ContentHandler } from '../content';

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

describe('ContentHandler whole-page read (what get_complete_page_content replays as)', () => {
  const long = `# Report\n\n${'a'.repeat(12000)}\n\nTAIL price $42 end`;

  function page(markdown = long) {
    return {
      url: () => 'https://example.test/report',
      readPageMarkdown: vi.fn(async () => markdown),
      nextPageHref: vi.fn(async () => ''),
      getCurrentState: vi.fn(async () => ({ selectorMap: new Map<number, DOMElementNode>() })),
      getScrollInfo: vi.fn(async () => [0, 500, 1000]),
      scrollToPercent: vi.fn(),
    };
  }

  it('reads the whole page and continues at the cursor', async () => {
    const reader = page();
    const { handler } = handlerFor(reader);

    const first = await handler.handleReadPage({ mode: 'full' });
    expect(reader.readPageMarkdown).toHaveBeenCalledWith('full');
    expect(first.extractedContent).toContain('full content');
    expect(first.extractedContent).not.toContain('TAIL');

    const rest = await handler.handleReadPage({ mode: 'full', cursor: 12010 });
    expect(rest.extractedContent).toContain('TAIL price $42 end');
  });

  it('searches the page text and says when there is no match', async () => {
    const { handler } = handlerFor(page());

    const found = await handler.handleFindInPage({ query: 'PRICE' });
    expect(found.extractedContent).toContain('1 match for "PRICE"');
    expect(found.extractedContent).toContain('TAIL price $42 end');

    const missing = await handler.handleFindInPage({ query: 'discount' });
    expect(missing.extractedContent).toContain('No match for "discount"');
  });

  it('says the whole page was read when the cursor is past the end', async () => {
    const { handler } = handlerFor(page());

    const past = await handler.handleReadPage({ mode: 'full', cursor: long.length + 100 });

    expect(past.extractedContent).toContain('at or past the end of the text');
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

describe('ContentHandler find_in_page', () => {
  // Paragraphs far enough apart that the context windows around two matches do not merge into one passage.
  const page = [
    '# Store',
    `Widget costs $42 today.${' filler'.repeat(40)}`,
    ['| Item | Price |', '| --- | --- |', '| Gadget | $17 |'].join('\n'),
  ].join('\n\n');

  function searchablePage(markdown: string, selectorMap = new Map<number, DOMElementNode>()) {
    return {
      url: () => 'https://example.test/store',
      readPageMarkdown: vi.fn(async () => markdown),
      getCurrentState: vi.fn(async () => ({ selectorMap })),
    };
  }

  function labelled(index: number, text: string): DOMElementNode {
    const node = new DOMElementNode({
      tagName: 'A',
      xpath: `/a[${index}]`,
      attributes: {},
      children: [],
      isVisible: true,
      highlightIndex: index,
    });
    node.getAllTextTillNextClickableElement = () => text;
    return node;
  }

  it('returns each match with its context without reading the whole page', async () => {
    const { handler } = handlerFor(searchablePage(page));

    const found = await handler.handleFindInPage({ query: 'widget' });

    expect(found.extractedContent).toContain('1 match for "widget" on https://example.test/store');
    expect(found.extractedContent).toContain('Widget costs $42 today.');
    expect(found.extractedContent).not.toContain('Gadget');
  });

  it('names the element to act on for a match that belongs to one', async () => {
    const selectorMap = new Map([
      [3, labelled(3, 'Widget costs $42 today.')],
      [4, labelled(4, 'Widget')],
      [5, labelled(5, 'Something else entirely')],
    ]);
    const { handler } = handlerFor(searchablePage(page, selectorMap));

    const found = await handler.handleFindInPage({ query: 'Widget' });

    // The shortest element carrying the text is the specific one.
    expect(found.extractedContent).toContain('element [4]');
  });

  it('returns a matched table row whole, with its header', async () => {
    const { handler } = handlerFor(searchablePage(page));

    const found = await handler.handleFindInPage({ query: 'Gadget' });

    expect(found.extractedContent).toContain('table header: Item | Price');
    expect(found.extractedContent).toContain('row: Gadget | $17');
  });

  it('matches a regular expression and caps the snippets', async () => {
    const gap = ' word'.repeat(60);
    const { handler } = handlerFor(searchablePage([`x $1 y${gap}`, `x $22 y${gap}`, 'x $333 y'].join('\n\n')));

    const prices = await handler.handleFindInPage({ query: '\\$\\d+', regex: true });
    expect(prices.extractedContent).toContain('3 matches');

    const capped = await handler.handleFindInPage({ query: '\\$\\d+', regex: true, max_snippets: 1 });
    expect(capped.extractedContent).toContain('[2 more matches');
  });

  it('says so for a query that matches nothing and for an expression that does not compile', async () => {
    const { handler } = handlerFor(searchablePage(page));

    const none = await handler.handleFindInPage({ query: 'sprocket' });
    expect(none.extractedContent).toContain(`No match for "sprocket" in the ${page.length} characters of this page.`);

    const broken = await handler.handleFindInPage({ query: '[unclosed', regex: true });
    expect(broken.extractedContent).toContain('Check the expression');
  });
});

describe('ContentHandler content cache', () => {
  function cachedPage(pages: string[]) {
    let call = 0;
    return {
      url: () => 'https://example.test/live',
      readPageMarkdown: vi.fn(async () => pages[Math.min(call++, pages.length - 1)]),
      nextPageHref: vi.fn(async () => ''),
      getCurrentState: vi.fn(async () => ({ selectorMap: new Map<number, DOMElementNode>() })),
      getScrollInfo: vi.fn(async () => [0, 500, 1000]),
      scrollToPercent: vi.fn(),
    };
  }

  it('answers the same read of unchanged content with a marker instead of the text', async () => {
    const { handler, context } = handlerFor(cachedPage(['# Live\n\nscore 1-0']), { nSteps: 4 });

    const first = await handler.handleReadPage({});
    expect(first.extractedContent).toContain('score 1-0');

    context.nSteps = 6;
    const again = await handler.handleReadPage({});
    expect(again.extractedContent).toBe(
      '[unchanged since step 4] https://example.test/live has not changed since then, and you already have this result. Use it, or ask for something else: another section, cursor or query, or act on the page.',
    );
  });

  it('sends the text again once the content changes', async () => {
    const { handler } = handlerFor(cachedPage(['# Live\n\nscore 1-0', '# Live\n\nscore 1-0', '# Live\n\nscore 2-0']));

    await handler.handleReadPage({});
    expect((await handler.handleReadPage({})).extractedContent).toContain('unchanged since step');
    expect((await handler.handleReadPage({})).extractedContent).toContain('score 2-0');
  });

  it('still answers another part of an unchanged page', async () => {
    const page = ['# One', 'a'.repeat(200), '## Two', 'b'.repeat(200)].join('\n\n');
    const { handler } = handlerFor(cachedPage([page]));

    await handler.handleReadPage({});
    const section = await handler.handleReadPage({ section: 'Two' });

    expect(section.extractedContent).toContain('b'.repeat(100));
  });

  it('is shared with find_in_page, which still answers a new query', async () => {
    const { handler } = handlerFor(cachedPage(['# Live\n\nscore 1-0 at kickoff']));

    expect((await handler.handleFindInPage({ query: 'score' })).extractedContent).toContain('1 match');
    expect((await handler.handleFindInPage({ query: 'score' })).extractedContent).toContain('unchanged since step');
    expect((await handler.handleFindInPage({ query: 'kickoff' })).extractedContent).toContain('1 match');
  });
});

describe('ContentHandler extract', () => {
  const grid = [
    '# Catalogue',
    ['| Product | Price |', '| --- | --- |', '| Widget | $4.50 |', '| Gadget | $12 |'].join('\n'),
    '## Shipping',
    ['| Product | Price |', '| --- | --- |', '| Courier | $9 |'].join('\n'),
  ].join('\n\n');

  const listSchema = JSON.stringify({
    type: 'array',
    items: { type: 'object', properties: { product: { type: 'string' }, price: { type: 'number' } }, required: ['product'] },
  });

  function cataloguePage(markdown = grid) {
    return { url: () => 'https://example.test/shop', readPageMarkdown: vi.fn(async () => markdown) };
  }

  it('parses a list straight off the page and says where each field came from', async () => {
    const { handler, context } = handlerFor(cataloguePage(), { extractWithModel: vi.fn() });

    const result = await handler.handleExtract({ schema: listSchema });

    expect(result.extractedContent).toContain('[{"product":"Widget","price":4.5},{"product":"Gadget","price":12}]');
    expect(result.extractedContent).toContain('product=table(0.90), price=table(0.90)');
    expect(result.extractedContent).toContain('matches the schema');
    // Nothing was missing, so no model call was made.
    expect(context.extractWithModel).not.toHaveBeenCalled();
  });

  it('limits the extraction to a scope', async () => {
    const { handler } = handlerFor(cataloguePage());

    const shipping = await handler.handleExtract({ schema: listSchema, scope: 'Shipping' });

    expect(shipping.extractedContent).toContain('Courier');
    expect(shipping.extractedContent).not.toContain('Widget');
  });

  it('asks a model only for the fields parsing could not resolve, and marks them as the model\'s', async () => {
    const schema = JSON.stringify({
      type: 'object',
      properties: { product: { type: 'string' }, rating: { type: 'number' } },
    });
    const extractWithModel = vi.fn(async () => ({ product: 'Ignored', rating: 4.7 }));
    const { handler } = handlerFor(cataloguePage(), { extractWithModel });

    const result = await handler.handleExtract({ schema });

    expect(extractWithModel).toHaveBeenCalledTimes(1);
    // The parsed value wins; the model only fills the gap.
    expect(result.extractedContent).toContain('"product":"Widget"');
    expect(result.extractedContent).toContain('"rating":4.7');
    expect(result.extractedContent).toContain('product=table(0.90), rating=model(0.50)');
  });

  it('reports a field nothing could resolve instead of inventing it', async () => {
    const schema = JSON.stringify({ type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] });
    const { handler } = handlerFor(cataloguePage(), { extractWithModel: vi.fn(async () => null) });

    const result = await handler.handleExtract({ schema });

    expect(result.extractedContent).toContain('sku=not found');
    expect(result.extractedContent).toContain('does not match the schema: result.sku: missing');
  });

  // An `error` result ends the action batch and charges the failure budget, so three unusable
  // schemas in a row ended the task. Eleven distinct malformed schemas appear in the saved runs.
  it('repairs a schema the models broke, rather than failing', async () => {
    const { handler } = handlerFor(cataloguePage(), { extractWithModel: vi.fn(async () => null) });

    // A CSS selector carries \' into the JSON string — the commonest break, 136 occurrences.
    const withEscapes = String.raw`{"type":"object","properties":{"sku":{"type":"string","selector":"a[href*=\'sku\']"}}}`;
    const repaired = await handler.handleExtract({ schema: withEscapes });
    expect(repaired.error).toBeFalsy();
    expect(repaired.extractedContent).toContain('sku=');

    // Single-quoted, and fenced the way a model wraps a code block.
    const quoted = await handler.handleExtract({ schema: "```json\n{'type':'object','properties':{'sku':{'type':'string'}}}\n```" });
    expect(quoted.error).toBeFalsy();
    expect(quoted.extractedContent).toContain('sku=');
  });

  it('returns the page itself when the schema cannot be used at all', async () => {
    const { handler } = handlerFor(cataloguePage());

    for (const schema of ['{not json', '{"type":"object"}', 'describe the products']) {
      const result = await handler.handleExtract({ schema });
      expect(result.error).toBeFalsy();
      expect(result.extractedContent).toContain('extract could not use that schema');
      expect(result.extractedContent).toContain('Read from');
    }
  });
});

describe('ContentHandler save_findings', () => {
  it('keeps findings on the task context', async () => {
    const { handler, context } = handlerFor({});

    await handler.handleSaveFindings({ text: '  Book A: $10  ' });

    expect(context.findings).toEqual(['Book A: $10']);
  });
});

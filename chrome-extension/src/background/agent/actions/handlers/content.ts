import { ActionResult } from '@src/background/agent/types';
import type {
  findInPageActionSchema,
  getCompletePageContentActionSchema,
  readPageActionSchema,
  saveFindingsActionSchema,
  scrollActionSchema,
  scrollToTextActionSchema,
} from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import { wrapUntrustedContent } from '../../messages/utils';
import { scrollEdgeSlack } from '../../validation/service';
import { findSection, outlineOf, renderOutline, sliceRead } from '@src/background/browser/dom/read-page';
import type { DOMElementNode } from '@src/background/browser/dom/views';

const MAX_READ_CHARS = 12000;
/** Characters a token is worth, for the read tools' `max_tokens` budget. */
const CHARS_PER_TOKEN = 4;
/** Default and largest chunk a single read returns; the default matches the 12,000 characters the old read returned. */
const DEFAULT_READ_TOKENS = 3000;
const MAX_READ_TOKENS = 8000;

/** What the read tools need of a page; a handler test supplies these five and nothing else. */
interface ReadablePage {
  url(): string;
  readPageMarkdown(mode: 'main' | 'full'): Promise<string>;
  nextPageHref(): Promise<string>;
  navigateTo(url: string): Promise<void>;
  getCurrentState?(): Promise<{ selectorMap: Map<number, DOMElementNode> }>;
  getScrollInfo(): Promise<[number, number, number]>;
  scrollToPercent(percent: number): Promise<void>;
}
/** Characters shown on each side of a `find` match. */
const FIND_CONTEXT_CHARS = 100;
const MAX_FIND_PASSAGES = 30;
/** Matches find_in_page returns unless the call asks for more. */
const DEFAULT_SNIPPETS = 8;
/**
 * An unchanged re-read is answered with a note only while the earlier read is still among the navigator's recent
 * tool turns (it sees five); after that the text is sent again.
 */
const SAME_READ_STEPS = 3;

/** A row of a table in page text: cells separated by tabs (how innerText renders table cells) or by pipes. */
const isTableRow = (line: string) => line.includes('\t') || (line.match(/\|/g)?.length ?? 0) >= 2;
const cells = (line: string) => line.split(line.includes('\t') ? '\t' : '|').map(cell => cell.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
const MAX_ROW_CHARS = 1000;

/** Where a query matches: `[start, end]` character ranges. A regex that does not compile matches nothing. */
export function matchRanges(text: string, query: string, regex = false): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const wanted = query.trim();
  if (!wanted) return ranges;
  if (regex) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(wanted, 'gi');
    } catch {
      return ranges;
    }
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      ranges.push([match.index, match.index + match[0].length]);
      if (ranges.length >= 1000) break;
    }
    return ranges;
  }
  const lower = text.toLowerCase();
  const needle = wanted.toLowerCase();
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    ranges.push([at, at + needle.length]);
    if (ranges.length >= 1000) break;
  }
  return ranges;
}

/** One passage to show for a match: a table row with its header, else a window of text around the match. */
export interface Passage {
  start: number;
  end: number;
  row?: boolean;
  header?: string;
}

/**
 * The passage to show for each match; overlapping windows merge. A match inside a table row returns that whole row with
 * the table's first row (its header): a fixed window around the match ran into the neighbouring row and lost the column
 * names, and the neighbour's value was reported.
 */
export function passagesFor(text: string, ranges: Array<[number, number]>): Passage[] {
  const spans: Passage[] = [];
  for (const [at, matchEnd] of ranges) {
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const lineEnd = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at);
    let span: Passage;
    if (isTableRow(text.slice(lineStart, lineEnd)) && matchEnd <= lineEnd) {
      // The table's first row: walk up while the lines above are rows too.
      let headerStart = lineStart;
      while (headerStart > 0) {
        const above = text.lastIndexOf('\n', headerStart - 2) + 1;
        if (!isTableRow(text.slice(above, headerStart - 1))) break;
        headerStart = above;
      }
      const header = headerStart < lineStart ? text.slice(headerStart, text.indexOf('\n', headerStart)) : undefined;
      span = { start: lineStart, end: lineEnd, row: true, header };
    } else {
      span = { start: Math.max(0, at - FIND_CONTEXT_CHARS), end: Math.min(text.length, matchEnd + FIND_CONTEXT_CHARS) };
    }
    const last = spans[spans.length - 1];
    if (last && span.start <= last.end && !last.row && !span.row) last.end = Math.max(last.end, span.end);
    else if (!(last?.row && last.start === span.start)) spans.push(span);
  }
  return spans;
}

/** One passage as a line: a table row keeps its header, other text is flattened. */
function passageLine(text: string, { start, end, row, header }: Passage): string {
  return row
    ? `${header ? `table header: ${cells(header).slice(0, MAX_ROW_CHARS)}\n  row: ` : 'table row: '}${cells(text.slice(start, end)).slice(0, MAX_ROW_CHARS)}`
    : text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Each case-insensitive match of `needle` with the text around it and its character offset.
 *
 * @deprecated the shape `get_complete_page_content` returns; `find_in_page` uses `passagesFor` directly.
 */
export function findPassages(text: string, needle: string): string {
  const ranges = matchRanges(text, needle);
  const spans = passagesFor(text, ranges);
  const matches = ranges.length;
  if (matches === 0) return `No match for "${needle}" in the page text (${text.length} characters).`;
  const passages = spans.slice(0, MAX_FIND_PASSAGES).map(span => `[at character ${span.start}] ${passageLine(text, span)}`);
  const more = spans.length > MAX_FIND_PASSAGES ? `\n[${spans.length - MAX_FIND_PASSAGES} more passages not shown; search for a longer text]` : '';
  const out = `${matches} ${matches === 1 ? 'match' : 'matches'} for "${needle}":\n${passages.join('\n')}${more}`;
  return out.length > MAX_READ_CHARS ? `${out.slice(0, MAX_READ_CHARS)}\n[passages truncated; search for a longer text]` : out;
}

/** Attributes that carry an element's own words, for matching a found text to something the model can act on. */
const LABEL_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'value', 'alt', 'name'];

/**
 * The listed element a matched text belongs to: the one whose own text or labels hold it, the most specific winning, so
 * a hit can be acted on without reading the page again. Null when no listed element carries the text.
 */
export function elementForText(selectorMap: Map<number, DOMElementNode>, needle: string): number | null {
  const wanted = needle.replace(/\s+/g, ' ').trim().toLowerCase();
  if (wanted.length < 2) return null;
  let best: { index: number; length: number } | null = null;
  for (const [index, node] of selectorMap) {
    const own = node.getAllTextTillNextClickableElement().replace(/\s+/g, ' ').trim();
    const labels = LABEL_ATTRIBUTES.map(name => node.attributes[name] ?? '').join(' ');
    const text = `${own} ${labels}`.toLowerCase();
    if (!text.includes(wanted)) continue;
    if (!best || text.length < best.length) best = { index, length: text.length };
  }
  return best?.index ?? null;
}

export class ContentHandler extends BaseHandler {
  /** The last whole-page read of this task, to answer an unchanged re-read without resending it. */
  private lastRead: { text: string; start: number; step: number } | null = null;

  async handleViewScreenshot(): Promise<ActionResult> {
    this.context.screenshotWanted = true;
    const msg = 'A screenshot of the visible part of the page comes with your next browser state.';
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'Looking at the page');
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleSaveFindings(input: z.infer<typeof saveFindingsActionSchema.schema>): Promise<ActionResult> {
    // Findings can hold page data the user did not ask to see in the progress feed; only the models get them.
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, 'Saving findings');
    const text = input.text.trim();
    if (text) this.context.findings.push(text);
    const msg = 'Findings saved; they are shown in every later step of this task.';
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  /**
   * After scrolling the page near its bottom, whether it grew within a second. The element list is windowed around the
   * viewport, so without this an infinite-scroll page gives no sign that more content loaded (C14 scrolled six times).
   */
  private async pageGrowth(page: { getScrollInfo(): Promise<[number, number, number]> }, heightBefore: number): Promise<string> {
    const sleep = () => new Promise(resolve => setTimeout(resolve, 100));
    let height = heightBefore;
    for (let waited = 0; waited < 1000 && height <= heightBefore; waited += 100) {
      await sleep();
      [, , height] = await page.getScrollInfo();
    }
    if (height <= heightBefore) return ' The page height did not change: no more content loaded.';
    // The first growth is often just a loading indicator: report the height once it holds for 300 ms (1.5 s at most).
    let steady = 0;
    for (let waited = 0; waited < 1500 && steady < 3; waited += 100) {
      await sleep();
      const [, , next] = await page.getScrollInfo();
      steady = next === height ? steady + 1 : 0;
      height = next;
    }
    return ` The page grew from ${heightBefore} to ${height} px: new content loaded.`;
  }

  async handleScroll(input: z.infer<typeof scrollActionSchema.schema>): Promise<ActionResult> {
    const { direction } = input;
    const byPages = direction === 'down' || direction === 'up';
    const pages = Math.min(Math.max(input.pages ?? 1, 0.1), 10);
    const what = byPages ? `${direction} ${pages} ${pages === 1 ? 'page' : 'pages'}` : `to the ${direction}`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t('act_scroll_start', [what]));
    const page = await this.context.browserContext.getCurrentPage();

    let node: DOMElementNode | undefined;
    if (input.index != null) {
      node = (await page.getCurrentState()).selectorMap.get(input.index);
      if (!node) {
        return this.handleElementNotFound(input.index);
      }
    }

    const [, , heightBefore] = node ? [0, 0, 0] : await page.getScrollInfo();
    if (byPages) await page.scrollByPages(direction === 'up' ? -pages : pages, node);
    else await page.scrollToPercent(direction === 'top' ? 0 : 100, node);

    let growth = '';
    if (!node && (direction === 'down' || direction === 'bottom')) {
      const [scrollY, viewportHeight, height] = await page.getScrollInfo();
      // Only a page scrolled to its end can load more.
      if (scrollY + viewportHeight >= height - scrollEdgeSlack(viewportHeight)) growth = await this.pageGrowth(page, heightBefore);
    }

    const msg = t('act_scroll_ok', [what]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg + growth);
    return new ActionResult({
      extractedContent: `Scrolled ${what}${node ? ` in [${input.index}]` : ''}.${growth}`,
      includeInMemory: true,
    });
  }

  async handleScrollToText(input: z.infer<typeof scrollToTextActionSchema.schema>): Promise<ActionResult> {
    const nth = input.nth ?? 1;
    const intent = t('act_scrollToText_start', [input.text, nth.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    try {
      const scrolled = await page.scrollToText(input.text, nth);
      const msg = scrolled
        ? t('act_scrollToText_ok', [input.text, nth.toString()])
        : t('act_scrollToText_notFound', [input.text, nth.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      const msg = t('act_scrollToText_failed', [error instanceof Error ? error.message : String(error)]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
  }

  /** The page's readable markdown, and the address it was read at. */
  private async readDocument(page: ReadablePage, mode: 'main' | 'full'): Promise<{ url: string; markdown: string }> {
    const markdown = await page.readPageMarkdown(mode);
    return { url: page.url(), markdown };
  }

  /**
   * One more page of a list: the site's own "next page" link, else a scroll to the bottom of a page that loads more as
   * it is scrolled. Returns the content that was not there before, or null when there is no further page.
   */
  private async nextPageContent(page: ReadablePage, mode: 'main' | 'full', soFar: string): Promise<string | null> {
    const href = await page.nextPageHref();
    if (href) {
      await page.navigateTo(href);
    } else {
      const [, , heightBefore] = await page.getScrollInfo();
      await page.scrollToPercent(100);
      if ((await this.pageGrowth(page, heightBefore)).includes('did not change')) return null;
    }
    const { markdown } = await this.readDocument(page, mode);
    if (!markdown) return null;
    // A page that loads more in place returns the whole document again; only what grew is new.
    const added = markdown.startsWith(soFar) ? markdown.slice(soFar.length) : markdown;
    return added.trim() ? added : null;
  }

  async handleFindInPage(input: z.infer<typeof findInPageActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Looking for "${input.query}" on the page`);
    try {
      const page = (await this.context.browserContext.getCurrentPage()) as unknown as ReadablePage;
      // The whole page, navigation included: a find is as often for a control as for a value.
      const { url, markdown } = await this.readDocument(page, 'full');
      this.context.pageRead = { url, text: markdown };

      const ranges = matchRanges(markdown, input.query, input.regex ?? false);
      if (ranges.length === 0) {
        const msg = `No match for "${input.query}" in the ${markdown.length} characters of this page.${input.regex ? ' Check the expression, or search for plain text.' : ''}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }

      const limit = Math.min(Math.max(input.max_snippets ?? DEFAULT_SNIPPETS, 1), MAX_FIND_PASSAGES);
      const spans = passagesFor(markdown, ranges);
      const selectorMap = (await page.getCurrentState?.())?.selectorMap ?? new Map<number, DOMElementNode>();
      const lines = spans.slice(0, limit).map(span => {
        const range = ranges.find(([at]) => at >= span.start && at <= span.end) ?? ranges[0];
        const index = elementForText(selectorMap, markdown.slice(range[0], range[1]));
        return `[at character ${span.start}]${index === null ? '' : ` element [${index}]`} ${passageLine(markdown, span)}`;
      });
      const more = spans.length > limit ? `\n[${spans.length - limit} more matches; narrow the query or raise max_snippets]` : '';
      const body = `${ranges.length} ${ranges.length === 1 ? 'match' : 'matches'} for "${input.query}" on ${url}:\n${lines.join('\n')}${more}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `${ranges.length} matches for "${input.query}"`);
      return new ActionResult({
        extractedContent: wrapUntrustedContent(body.length > MAX_READ_CHARS ? `${body.slice(0, MAX_READ_CHARS)}\n[truncated]` : body, false),
        includeInMemory: true,
      });
    } catch (error) {
      const msg = `Could not search the page: ${error instanceof Error ? error.message : String(error)}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
  }

  async handleReadPage(input: z.infer<typeof readPageActionSchema.schema>): Promise<ActionResult> {
    const mode = input.mode ?? 'main';
    // The outline is built from the main content: 'structured' reads the same text and returns only its headings.
    const extractMode = mode === 'full' ? 'full' : 'main';
    const target = (input.target ?? 'current').trim();
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, target && target !== 'current' ? `Reading ${target}` : 'Reading the page');
    try {
      let page = (await this.context.browserContext.getCurrentPage()) as unknown as ReadablePage;
      if (target && target !== 'current' && /^https?:\/\//i.test(target) && target !== page.url()) {
        await page.navigateTo(target);
        page = (await this.context.browserContext.getCurrentPage()) as unknown as ReadablePage;
      }

      let { url, markdown } = await this.readDocument(page, extractMode);
      let pagesRead = 1;
      if (input.all_pages) {
        const limit = Math.min(Math.max(input.max_pages ?? 5, 1), 20);
        for (; pagesRead < limit; pagesRead++) {
          const added = await this.nextPageContent(page, extractMode, markdown);
          if (added === null) break;
          markdown = `${markdown}\n\n${added}`;
        }
        url = page.url();
      }
      this.context.pageRead = { url, text: markdown };
      return this.renderRead({ url, markdown, mode, pagesRead, input });
    } catch (error) {
      const msg = `Could not read the page: ${error instanceof Error ? error.message : String(error)}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
  }

  /** The chunk, outline and cursor the model gets back from a read. */
  private renderRead(read: {
    url: string;
    markdown: string;
    mode: 'main' | 'full' | 'structured';
    pagesRead: number;
    input: z.infer<typeof readPageActionSchema.schema>;
  }): ActionResult {
    const { url, markdown, mode, pagesRead, input } = read;
    const sections = outlineOf(markdown);
    const pages = pagesRead > 1 ? `, ${pagesRead} pages` : '';

    if (mode === 'structured') {
      const outline = renderOutline(sections) || '[no headings]';
      const msg = `${url} — outline only, ${markdown.length} characters${pages}\n${outline}\n[read a section with read_page section "<id or title>"]`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Outlined ${markdown.length} characters of page text`);
      return new ActionResult({ extractedContent: wrapUntrustedContent(msg, false), includeInMemory: true });
    }

    let text = markdown;
    let offset = 0;
    let scope = '';
    if (input.section) {
      const section = findSection(sections, input.section);
      if (!section) {
        const msg = `No section "${input.section}" on this page. Its sections are:\n${renderOutline(sections) || '[no headings]'}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg.slice(0, 200));
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }
      text = markdown.slice(section.start, section.end);
      offset = section.start;
      scope = ` section ${section.id} "${section.title}"`;
    }

    const maxChars = Math.min(Math.max(input.max_tokens ?? DEFAULT_READ_TOKENS, 200), MAX_READ_TOKENS) * CHARS_PER_TOKEN;
    const cursor = Math.max(0, (input.cursor ?? 0) - offset);
    if (cursor >= text.length && text.length > 0) {
      const msg = `cursor ${input.cursor} is at or past the end of the text (${markdown.length} characters): it has all been read. Use find_in_page to search it, or read_page with a section.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }
    const { body, next } = sliceRead(text, cursor, maxChars);

    const header = `${url} — ${mode} content, ${markdown.length} characters${pages}${scope}${cursor > 0 ? `, from character ${cursor + offset}` : ''}`;
    // The outline goes with the first chunk only: it is what makes reading on unnecessary.
    const outline = cursor === 0 && !input.section && sections.length > 1 && next !== null ? `\nSections:\n${renderOutline(sections)}\n` : '';
    const more = next === null
      ? ''
      : `\n[${text.length - next} characters left; read on with read_page cursor ${next + offset}, jump with section "<id>", or search with find_in_page]`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Read ${body.length} of ${markdown.length} characters of page text`);
    return new ActionResult({
      extractedContent: wrapUntrustedContent(`${header}\n${outline}\n${body}${more}`, false),
      includeInMemory: true,
    });
  }

  async handleGetCompletePageContent(input: z.infer<typeof getCompletePageContentActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(
      Actors.NAVIGATOR,
      ExecutionState.ACT_START,
      input.find ? `Searching the page text for "${input.find}"` : 'Extracting complete page content...',
    );

    const page = await this.context.browserContext.getCurrentPage();
    try {
      const content = await page.getCompletePageContent();
      this.context.pageRead = { url: page.url(), text: content };
      if (input.find) {
        const found = findPassages(content, input.find);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Searched ${content.length} characters of page text for "${input.find}"`);
        return new ActionResult({ extractedContent: wrapUntrustedContent(found, false), includeInMemory: true });
      }

      if (content.length > 0 && (input.start_char ?? 0) >= content.length) {
        // A live read continued at the exact end of the text and got an empty range back, then read again from 0.
        const note = `start_char ${input.start_char} is at or past the end of the page text (${content.length} characters): the whole page has been read. Use find to search it, or a start_char below ${content.length}.`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, note);
        return new ActionResult({ extractedContent: note, includeInMemory: true });
      }
      const start = Math.max(0, input.start_char ?? 0);
      const last = this.lastRead;
      if (last && last.text === content && last.start === start && this.context.nSteps - last.step <= SAME_READ_STEPS) {
        return new ActionResult({
          extractedContent: `The page text is the same as your previous read (${content.length} characters); use that read, or find / start_char for another part.`,
          includeInMemory: true,
        });
      }
      this.lastRead = { text: content, start, step: this.context.nSteps };

      const end = Math.min(content.length, start + MAX_READ_CHARS);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Read characters ${start}-${end} of ${content.length} of page text`);
      const range = start > 0 ? `[characters ${start}-${end} of ${content.length}]\n` : '';
      const rest = end < content.length
        ? `\n[truncated at character ${end} of ${content.length}; call get_complete_page_content with start_char ${end} to read on, or with find to search the text]`
        : '';
      return new ActionResult({
        extractedContent: wrapUntrustedContent(`${range}${content.slice(start, end)}${rest}`, false),
        includeInMemory: true,
      });
    } catch (error) {
      const msg = `Failed to extract page content: ${error instanceof Error ? error.message : String(error)}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
  }
}

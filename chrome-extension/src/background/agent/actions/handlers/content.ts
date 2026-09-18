import { ActionResult } from '@src/background/agent/types';
import type {
  extractActionSchema,
  findInPageActionSchema,
  getCompletePageContentActionSchema,
  readPageActionSchema,
  saveFindingsActionSchema,
  scrollActionSchema,
  scrollToTextActionSchema,
  viewScreenshotActionSchema,
} from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import { wrapUntrustedContent } from '../../messages/utils';
import { scrollEdgeSlack } from '../../validation/service';
import {
  extractFromLabels,
  extractFromTables,
  findSection,
  hashText,
  outlineOf,
  renderOutline,
  schemaFields,
  schemaProblems,
  sliceRead,
  type FieldSpec,
  type FieldValue,
} from '@src/background/browser/dom/read-page';
import type { DOMElementNode } from '@src/background/browser/dom/views';
import type { ScreenshotOptions } from '@src/background/browser/page';

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
/** A row of a table in page text: cells separated by tabs (how innerText renders table cells) or by pipes. */
const isTableRow = (line: string) => line.includes('\t') || (line.match(/\|/g)?.length ?? 0) >= 2;
const cells = (line: string) => line.split(line.includes('\t') ? '\t' : '|').map(cell => cell.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
const MAX_ROW_CHARS = 1000;
/** Pixels kept around an element a screenshot is narrowed to: a control means little without its label or its row. */
const MIN_REGION_MARGIN = 40;

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

/** Page text sent with an extraction the parse could not finish; one model call, not the whole document. */
const MODEL_EXTRACT_CHARS = 30000;

/** The part of the page an `extract` scope names: a section of the outline, else the text around the first mention. */
export function scopeOf(markdown: string, scope?: string): string {
  if (!scope?.trim()) return markdown;
  const section = findSection(outlineOf(markdown), scope);
  if (section) return markdown.slice(section.start, section.end);
  const at = markdown.toLowerCase().indexOf(scope.trim().toLowerCase());
  return at < 0 ? markdown : markdown.slice(at, at + MODEL_EXTRACT_CHARS);
}

/** The model's answer fills only the fields the parse could not, and is marked as the model's. */
export function mergeModelValues(
  parsed: Array<Record<string, FieldValue>>,
  answer: unknown,
  missing: FieldSpec[],
  many: boolean,
): void {
  const items = many ? (Array.isArray(answer) ? answer : ((answer as Record<string, unknown>)?.items as unknown[]) ?? []) : [answer];
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const row = parsed[index] ?? (parsed[index] = {});
    for (const field of missing) {
      const value = (item as Record<string, unknown>)[field.name];
      if (row[field.name] === undefined && value !== undefined && value !== null && value !== '') {
        row[field.name] = { value, source: 'model', confidence: 0.5 };
      }
    }
  });
}

/** The values alone, as the schema check and the answer want them. */
const plainValues = (row: Record<string, FieldValue> = {}) =>
  Object.fromEntries(Object.entries(row).map(([name, found]) => [name, found.value]));

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
  /**
   * The content cache, by address and mode: the hash of what was read, the step it first showed that content, and the
   * answers already given for it. A read tool asked twice for the same thing on an unchanged page says so instead of
   * sending the text again — a re-read was 20% of get_complete_page_content calls in the reviewed runs.
   */
  private reads = new Map<string, { hash: string; step: number; served: Set<string> }>();

  /**
   * Asks for a screenshot with the next browser state. Without arguments it is the whole visible page with every index
   * drawn on it, as it always was; an index or a region narrows it, which is what makes vision affordable — an image is
   * the most expensive thing in the prompt, and a chart legend does not need the other nine tenths of the page.
   */
  async handleViewScreenshot(input: z.infer<typeof viewScreenshotActionSchema.schema>): Promise<ActionResult> {
    const page = await this.context.browserContext.getCurrentPage();
    let clip: ScreenshotOptions['clip'];
    let where = 'the visible part of the page';

    if (typeof input.index === 'number') {
      const node = (await page.getCurrentState()).selectorMap.get(input.index);
      if (!node) return this.handleElementNotFound(input.index);
      const box = node.viewportCoordinates;
      if (!box || box.width <= 0 || box.height <= 0) {
        const msg = `Element [${input.index}] has no measured area, so it cannot be framed. Take the whole screenshot instead.`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      // Room around it: a control means little without the label, value or row beside it.
      const margin = Math.max(MIN_REGION_MARGIN, Math.round(Math.max(box.width, box.height) / 2));
      clip = {
        x: box.center.x - box.width / 2 - margin,
        y: box.center.y - box.height / 2 - margin,
        width: box.width + margin * 2,
        height: box.height + margin * 2,
      };
      where = `element [${input.index}] and its surroundings`;
    } else if (input.region) {
      const [x, y, width, height] = input.region;
      if (input.region.length !== 4 || !(width > 0) || !(height > 0)) {
        const msg = 'region must be [x, y, width, height] in pixels, with a width and a height above zero.';
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      clip = { x, y, width, height };
      where = `the region [${input.region.join(', ')}] of the visible page`;
    }

    const annotate = input.annotate !== false;
    const [scrollY] = await page.getScrollInfo();
    page.setScreenshotOptions(clip || !annotate ? { clip, scrollY, annotate } : null);
    this.context.screenshotWanted = true;
    const msg = `A screenshot of ${where} comes with your next browser state${annotate ? ', with the element indexes drawn on it' : ', with no index boxes'}.`;
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

  /**
   * The page's readable markdown, with what the content cache knows about it: `unchangedSince` is the step this exact
   * content was first read at, so a read of a page that has not changed is answered with a marker instead of the text.
   */
  private async readDocument(page: ReadablePage, mode: 'main' | 'full'): Promise<{ url: string; markdown: string; unchangedSince: number | null }> {
    const url = page.url();
    const markdown = await page.readPageMarkdown(mode);
    const key = `${url}|${mode}`;
    const hash = hashText(markdown);
    const known = this.reads.get(key);
    if (known?.hash === hash) return { url, markdown, unchangedSince: known.step };
    this.reads.set(key, { hash, step: this.context.nSteps, served: new Set() });
    return { url, markdown, unchangedSince: null };
  }

  /** The answer to a call that would repeat one already given for content that has not changed. */
  private unchanged(step: number, what: string): ActionResult {
    const msg = `[unchanged since step ${step}] ${what} has not changed since then, and you already have this result. Use it, or ask for something else: another section, cursor or query, or act on the page.`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Page unchanged since step ${step}`);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  /**
   * Whether this exact answer was already given for content that has not changed since. The first call for a part of an
   * unchanged page still answers: only asking for the same thing twice gets the marker.
   */
  private alreadyServed(url: string, mode: 'main' | 'full', answer: string): boolean {
    const entry = this.reads.get(`${url}|${mode}`);
    if (!entry) return false;
    if (entry.served.has(answer)) return true;
    entry.served.add(answer);
    return false;
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

  async handleExtract(input: z.infer<typeof extractActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, 'Extracting the requested fields');
    let schema: Record<string, unknown>;
    try {
      schema = JSON.parse(input.schema) as Record<string, unknown>;
    } catch (error) {
      const msg = `schema is not valid JSON (${error instanceof Error ? error.message : String(error)}). Send a JSON Schema, for example {"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"number"}}}}.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    const { many, fields, required } = schemaFields(schema);
    if (fields.length === 0) {
      const msg = 'schema names no fields: give an object schema with properties, or an array of such objects.';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    try {
      const page = (await this.context.browserContext.getCurrentPage()) as unknown as ReadablePage;
      const { url, markdown } = await this.readDocument(page, 'main');
      this.context.pageRead = { url, text: markdown };
      const scoped = scopeOf(markdown, input.scope);

      // What the page states plainly is parsed, not guessed: tables first (a grid, a list, a data table), then labels.
      const rows = extractFromTables(scoped, fields);
      const parsed: Array<Record<string, FieldValue>> = many ? rows : [rows[0] ?? {}];
      if (!many) parsed[0] = { ...extractFromLabels(scoped, fields), ...parsed[0] };

      const missing = fields.filter(field => parsed.some(row => row[field.name] === undefined));
      if (missing.length > 0 && this.context.extractWithModel) {
        const asked = await this.context.extractWithModel(schema, scoped.slice(0, MODEL_EXTRACT_CHARS));
        mergeModelValues(parsed, asked, missing, many);
      }

      const value = many ? parsed.map(plainValues) : plainValues(parsed[0]);
      const problems = schemaProblems(value, schema);
      const sources = fields
        .map(field => {
          const found = parsed.find(row => row[field.name])?.[field.name];
          return `${field.name}=${found ? `${found.source}(${found.confidence.toFixed(2)})` : 'not found'}`;
        })
        .join(', ');
      const body = [
        `Extracted from ${url}${input.scope ? ` (scope: ${input.scope})` : ''}${many ? `, ${parsed.length} items` : ''}`,
        JSON.stringify(value).slice(0, MAX_READ_CHARS),
        `per field: ${sources}`,
        problems.length ? `does not match the schema: ${problems.slice(0, 10).join('; ')}` : `matches the schema${required.length ? ' with every required field' : ''}`,
      ].join('\n');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Extracted ${many ? `${parsed.length} items` : 'the fields'} from the page`);
      return new ActionResult({ extractedContent: wrapUntrustedContent(body, false), includeInMemory: true });
    } catch (error) {
      const msg = `Could not extract from the page: ${error instanceof Error ? error.message : String(error)}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
  }

  async handleFindInPage(input: z.infer<typeof findInPageActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Looking for "${input.query}" on the page`);
    try {
      const page = (await this.context.browserContext.getCurrentPage()) as unknown as ReadablePage;
      // The whole page, navigation included: a find is as often for a control as for a value.
      const { url, markdown, unchangedSince } = await this.readDocument(page, 'full');
      this.context.pageRead = { url, text: markdown };
      // Recorded on every call, so the second identical search of unchanged content is the one that gets the marker.
      const served = this.alreadyServed(url, 'full', `find|${input.regex ? 're:' : ''}${input.query}|${input.max_snippets ?? ''}`);
      if (unchangedSince !== null && served) return this.unchanged(unchangedSince, `the same search of ${url}`);

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

      let { url, markdown, unchangedSince } = await this.readDocument(page, extractMode);
      let pagesRead = 1;
      if (input.all_pages) {
        const limit = Math.min(Math.max(input.max_pages ?? 5, 1), 20);
        for (; pagesRead < limit; pagesRead++) {
          const added = await this.nextPageContent(page, extractMode, markdown);
          if (added === null) break;
          markdown = `${markdown}\n\n${added}`;
        }
        url = page.url();
        unchangedSince = null;
      }
      this.context.pageRead = { url, text: markdown };
      const served = this.alreadyServed(url, extractMode, `read|${mode}|${input.section ?? ''}|${input.cursor ?? 0}|${input.max_tokens ?? ''}`);
      if (unchangedSince !== null && served) return this.unchanged(unchangedSince, url);
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

  /**
   * The old whole-page read, kept for one release so saved histories and older prompts keep working: `find` is a
   * find_in_page, everything else a full read_page continued at `start_char`.
   *
   * @deprecated use read_page and find_in_page.
   */
  async handleGetCompletePageContent(input: z.infer<typeof getCompletePageContentActionSchema.schema>): Promise<ActionResult> {
    if (input.find) return this.handleFindInPage({ query: input.find });
    return this.handleReadPage({ mode: 'full', cursor: input.start_char });
  }
}

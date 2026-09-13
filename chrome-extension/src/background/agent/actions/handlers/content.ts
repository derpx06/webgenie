import { ActionResult } from '@src/background/agent/types';
import type {
  getCompletePageContentActionSchema,
  saveFindingsActionSchema,
  scrollActionSchema,
  scrollToTextActionSchema,
} from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import { wrapUntrustedContent } from '../../messages/utils';
import type { DOMElementNode } from '@src/background/browser/dom/views';

const MAX_READ_CHARS = 12000;
/** Characters shown on each side of a `find` match. */
const FIND_CONTEXT_CHARS = 100;
const MAX_FIND_PASSAGES = 30;
/**
 * An unchanged re-read is answered with a note only while the earlier read is still among the navigator's recent
 * tool turns (it sees five); after that the text is sent again.
 */
const SAME_READ_STEPS = 3;

/** Each case-insensitive match of `needle` with the text around it and its character offset; overlapping passages merge. */
export function findPassages(text: string, needle: string): string {
  const wanted = needle.trim().toLowerCase();
  const lower = text.toLowerCase();
  const spans: Array<[number, number]> = [];
  let matches = 0;
  for (let at = wanted ? lower.indexOf(wanted) : -1; at >= 0; at = lower.indexOf(wanted, at + wanted.length)) {
    matches++;
    const start = Math.max(0, at - FIND_CONTEXT_CHARS);
    const end = Math.min(text.length, at + wanted.length + FIND_CONTEXT_CHARS);
    const last = spans[spans.length - 1];
    if (last && start <= last[1]) last[1] = end;
    else spans.push([start, end]);
  }
  if (matches === 0) return `No match for "${needle}" in the page text (${text.length} characters).`;
  const passages = spans
    .slice(0, MAX_FIND_PASSAGES)
    .map(([start, end]) => `[at character ${start}] ${text.slice(start, end).replace(/\s+/g, ' ').trim()}`);
  const more = spans.length > MAX_FIND_PASSAGES ? `\n[${spans.length - MAX_FIND_PASSAGES} more passages not shown; search for a longer text]` : '';
  const out = `${matches} ${matches === 1 ? 'match' : 'matches'} for "${needle}":\n${passages.join('\n')}${more}`;
  return out.length > MAX_READ_CHARS ? `${out.slice(0, MAX_READ_CHARS)}\n[passages truncated; search for a longer text]` : out;
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
      if (scrollY + viewportHeight >= height - 2) growth = await this.pageGrowth(page, heightBefore);
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

  async handleGetCompletePageContent(input: z.infer<typeof getCompletePageContentActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(
      Actors.NAVIGATOR,
      ExecutionState.ACT_START,
      input.find ? `Searching the page text for "${input.find}"` : 'Extracting complete page content...',
    );

    const page = await this.context.browserContext.getCurrentPage();
    try {
      const content = await page.getCompletePageContent();
      const msg = `Successfully extracted ${content.length} characters of page content.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      if (input.find) {
        return new ActionResult({ extractedContent: wrapUntrustedContent(findPassages(content, input.find), false), includeInMemory: true });
      }

      const start = Math.min(Math.max(0, input.start_char ?? 0), content.length);
      const last = this.lastRead;
      if (last && last.text === content && last.start === start && this.context.nSteps - last.step <= SAME_READ_STEPS) {
        return new ActionResult({
          extractedContent: `The page text is the same as your previous read (${content.length} characters); use that read, or find / start_char for another part.`,
          includeInMemory: true,
        });
      }
      this.lastRead = { text: content, start, step: this.context.nSteps };

      const end = Math.min(content.length, start + MAX_READ_CHARS);
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

import { ActionResult } from '@src/background/agent/types';
import type { searchWebActionSchema, goToUrlActionSchema, goBackActionSchema, waitForActionSchema } from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import { addressKey } from '../../validation/service';

const WAIT_POLL_MS = 500;

/**
 * Says where a navigation really landed when the site sent it elsewhere. Without it a live run opened a home page that
 * redirects 14 times, each result saying only "Navigated to" the address it asked for.
 */
export function redirectNote(requested: string, landed: string): string {
  const wanted = addressKey(requested);
  const final = addressKey(landed);
  return wanted && final && wanted !== final
    ? ` The site redirected to ${landed}; opening ${requested} again will land there again.`
    : '';
}

/**
 * The passage around the first occurrence of `wanted` as whole words (case and spacing aside), or null. A substring is
 * not a match: waiting for "loading" to go never ended while "loadingComplete" was on the page (seven waits in a live run).
 */
export function findWholeText(content: string, wanted: string): string | null {
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
  const target = flat(wanted);
  if (!target) return null;
  const text = flat(content);
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  // Word boundaries only where the wanted text starts or ends with a letter or digit ("$5" may follow a colon).
  const start = new RegExp('^[\\p{L}\\p{N}]', 'u').test(target) ? '(?<![\\p{L}\\p{N}])' : '';
  const end = new RegExp('[\\p{L}\\p{N}]$', 'u').test(target) ? '(?![\\p{L}\\p{N}])' : '';
  const match = new RegExp(`${start}${escaped}${end}`, 'iu').exec(text);
  if (!match) return null;
  return text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40).trim();
}

/**
 * What go_back or go_forward should say when the browser has nowhere to go.
 *
 * "History entry to navigate to not found" is the browser's own wording, and 6 of 271 tasks in the last round got nothing
 * else: a tab opened for the task has no earlier page, and a page that replaces its own history leaves nothing behind it.
 * The way out is an address or a link, so the message says so.
 */
export function explainHistoryFailure(raw: string, forward: boolean): string {
  if (/history entry to navigate to not found/i.test(raw)) {
    return forward
      ? 'There is no later page in this tab to go forward to. Use a link on this page, or go_to_url.'
      : 'There is no earlier page in this tab to go back to: it was opened for this task, or the site replaced its own history. Open the address you want with go_to_url, or use a link on this page.';
  }
  return raw;
}

export class NavigationHandler extends BaseHandler {
  async handleSearchWeb(input: z.infer<typeof searchWebActionSchema.schema>): Promise<ActionResult> {
    const intent = `Searching the web for: ${input.query}`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const encodedQuery = encodeURIComponent(input.query);
    // DuckDuckGo by default: Google answers automated browsing with a captcha page.
    const engine = input.engine || 'duckduckgo';
    const searchUrl = engine === 'google'
      ? `https://www.google.com/search?q=${encodedQuery}`
      : `https://duckduckgo.com/?q=${encodedQuery}`;

    await this.context.browserContext.navigateTo(searchUrl);

    const msg = `Web search opened for: ${input.query}`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: msg,
      includeInMemory: true,
    });
  }

  /** Opens an address, in this tab or in a new one that becomes the current tab. */
  async handleGoToUrl(input: z.infer<typeof goToUrlActionSchema.schema>): Promise<ActionResult> {
    const url = input.url.trim();
    const newTab = input.new_tab === true;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t(newTab ? 'act_openTab_start' : 'act_goToUrl_start', [url]));
    if (newTab && (!url || url.toLowerCase().startsWith('chrome://'))) {
      const error = `go_to_url opens web addresses only; "${url}" cannot be opened. Open an https:// address, or use search_web to search.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, error);
      return new ActionResult({ error, includeInMemory: true });
    }

    if (newTab) {
      const page = await this.context.browserContext.openTab(url);
      const msg = t('act_openTab_ok', [url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({
        extractedContent: `${msg} in new tab ${page.tabId}, now the current tab.${redirectNote(url, page.url())}`,
        includeInMemory: true,
      });
    }

    await this.context.browserContext.navigateTo(url);
    const msg = t('act_goToUrl_ok', [url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    const landed = await this.context.browserContext.getCurrentPage().then(page => page.url(), () => '');
    return new ActionResult({
      extractedContent: `${msg}${redirectNote(url, landed)}`,
      includeInMemory: true,
    });
  }

  /** One step through the tab's history, back by default and forward after a go_back. */
  async handleGoBack(input: z.infer<typeof goBackActionSchema.schema>): Promise<ActionResult> {
    const forward = input?.forward === true;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t(forward ? 'act_goForward_start' : 'act_goBack_start'));
    const page = await this.context.browserContext.getCurrentPage();
    try {
      if (forward) await page.goForward();
      else await page.goBack();
    } catch (error) {
      // Thrown rather than returned, so it takes the same path as any other failed action.
      throw new Error(explainHistoryFailure(error instanceof Error ? error.message : String(error), forward));
    }
    const msg = t(forward ? 'act_goForward_ok' : 'act_goBack_ok');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: msg,
      includeInMemory: true,
    });
  }

  /** Sleeps, and returns early when the task is cancelled. */
  private sleep(ms: number): Promise<void> {
    const signal = this.context.controller.signal;
    return new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }

  /**
   * Waits for a named condition and returns as soon as it holds. Blind waits were 107 wasted steps across the reviewed
   * tasks, and a `text_gone` that resolved instantly was read as proof a blocker had cleared, so a condition that was
   * already true when the wait started says so instead of reporting a wait.
   */
  async handleWaitFor(input: z.infer<typeof waitForActionSchema.schema>): Promise<ActionResult> {
    // A wait with nothing named is a wait for the page to stop loading, and it returns the moment it has: a blind
    // sleep spent its whole budget every time (0 of 63 returned early in the r3 run, median 3.00 s).
    const condition = input.condition ?? 'network_idle';
    const seconds = Math.min(Math.max(input.seconds ?? (input.condition ? 10 : 3), 1), 30);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Waiting for ${condition}`);
    const page = await this.context.browserContext.getCurrentPage();

    let wanted = input.text?.trim() ?? '';
    if (condition === 'element_gone') {
      const node = input.index === undefined ? undefined : (await this.context.browserContext.getCachedState()).selectorMap.get(input.index);
      const label = node ? (node.getAllTextTillNextClickableElement(2) || node.attributes['aria-label'] || '').replace(/\s+/g, ' ').trim() : '';
      if (!label) {
        const msg = input.index === undefined
          ? 'Not waited: element_gone needs the index of the element to wait for.'
          : `Not waited: [${input.index}] carries no text to recognise it by. Wait for a text of the block it is in with text_gone, or act and read the page again.`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      wanted = label;
    }

    if (condition === 'network_idle') {
      await Promise.race([this.context.browserContext.waitForPageAndFramesLoad(), this.sleep(seconds * 1000)]);
      const msg = 'The page and its frames finished loading. If what you expect is still missing, it is drawn after loading: wait_for the text itself.';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }

    if (!wanted) {
      const msg = `Not waited: ${condition} needs the text to wait for.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    const gone = condition !== 'text';
    const what = condition === 'element_gone' ? `[${input.index}] "${wanted}"` : `"${wanted}"`;
    const signal = this.context.controller.signal;
    const startedAt = Date.now();
    let msg: string;
    for (;;) {
      const found = findWholeText(await page.getCompletePageContent().catch(() => ''), wanted);
      const elapsed = (Date.now() - startedAt) / 1000;
      if ((found !== null) !== gone) {
        msg = elapsed < 0.2
          ? `${what} was ${gone ? 'already gone' : 'already on the page'} before the wait began, so nothing was waited for and this proves nothing about what you did. Read the page state instead.`
          : `${what} ${gone ? 'is gone from the page' : 'appeared on the page'} after ${elapsed.toFixed(1)} s.`;
        break;
      }
      if (elapsed >= seconds || signal.aborted) {
        msg = gone
          ? `${what} is still on the page after ${seconds} s, in: "${found}".`
          : `${what} did not appear on the page after ${seconds} s.`;
        break;
      }
      await this.sleep(WAIT_POLL_MS);
    }

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

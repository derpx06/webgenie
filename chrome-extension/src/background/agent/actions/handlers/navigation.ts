import { ActionResult } from '@src/background/agent/types';
import type { searchWebActionSchema, goToUrlActionSchema, waitActionSchema, waitForActionSchema } from '../schemas';
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

  async handleGoToUrl(input: z.infer<typeof goToUrlActionSchema.schema>): Promise<ActionResult> {
    const intent = t('act_goToUrl_start', [input.url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await this.context.browserContext.navigateTo(input.url);
    const msg = t('act_goToUrl_ok', [input.url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    const landed = await this.context.browserContext.getCurrentPage().then(page => page.url(), () => '');
    return new ActionResult({
      extractedContent: `${msg}${redirectNote(input.url, landed)}`,
      includeInMemory: true,
    });
  }

  async handleGoBack(): Promise<ActionResult> {
    const intent = t('act_goBack_start');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    await page.goBack();
    const msg = t('act_goBack_ok');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: msg,
      includeInMemory: true,
    });
  }

  async handleGoForward(): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t('act_goForward_start'));
    const page = await this.context.browserContext.getCurrentPage();
    await page.goForward();
    const msg = t('act_goForward_ok');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
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

  /** A fixed wait for nothing in particular; cancelling ends it. Anything nameable goes through wait_for. */
  async handleWait(input: z.infer<typeof waitActionSchema.schema>): Promise<ActionResult> {
    const seconds = Math.min(Math.max(input.seconds ?? 3, 1), 10);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t('act_wait_start', [seconds.toString()]));
    await this.sleep(seconds * 1000);
    const msg = `${t('act_wait_ok', [seconds.toString()])} Nothing was checked: wait_for names what you are waiting for and returns as soon as it happens.`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  /**
   * Waits for a named condition and returns as soon as it holds. Blind waits were 107 wasted steps across the reviewed
   * tasks, and a `text_gone` that resolved instantly was read as proof a blocker had cleared, so a condition that was
   * already true when the wait started says so instead of reporting a wait.
   */
  async handleWaitFor(input: z.infer<typeof waitForActionSchema.schema>): Promise<ActionResult> {
    const seconds = Math.min(Math.max(input.seconds ?? 10, 1), 30);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Waiting for ${input.condition}`);
    const page = await this.context.browserContext.getCurrentPage();

    let wanted = input.text?.trim() ?? '';
    if (input.condition === 'element_gone') {
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

    if (input.condition === 'network_idle') {
      await Promise.race([this.context.browserContext.waitForPageAndFramesLoad(), this.sleep(seconds * 1000)]);
      const msg = 'The page and its frames finished loading. If what you expect is still missing, it is drawn after loading: wait_for the text itself.';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }

    if (!wanted) {
      const msg = `Not waited: ${input.condition} needs the text to wait for.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    const gone = input.condition !== 'text';
    const what = input.condition === 'element_gone' ? `[${input.index}] "${wanted}"` : `"${wanted}"`;
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

import { ActionResult } from '@src/background/agent/types';
import type { searchWebActionSchema, goToUrlActionSchema, waitActionSchema } from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

const WAIT_POLL_MS = 500;

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
    return new ActionResult({
      extractedContent: msg,
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

  /** A fixed wait, or a wait for a text to appear or disappear that returns as soon as it does; cancelling ends it. */
  async handleWait(input: z.infer<typeof waitActionSchema.schema>): Promise<ActionResult> {
    const condition = input.text ? { text: input.text, gone: false } : input.text_gone ? { text: input.text_gone, gone: true } : null;
    const seconds = Math.min(Math.max(input.seconds ?? (condition ? 10 : 3), 1), 10);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t('act_wait_start', [seconds.toString()]));

    const signal = this.context.controller.signal;
    const sleep = (ms: number) =>
      new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });

    let msg: string;
    if (!condition) {
      await sleep(seconds * 1000);
      msg = t('act_wait_ok', [seconds.toString()]);
    } else {
      const flat = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
      const wanted = flat(condition.text);
      const page = await this.context.browserContext.getCurrentPage();
      const startedAt = Date.now();
      for (;;) {
        const present = flat(await page.getCompletePageContent().catch(() => '')).includes(wanted);
        const elapsed = (Date.now() - startedAt) / 1000;
        if (present !== condition.gone) {
          msg = `"${condition.text}" ${condition.gone ? 'is gone from the page' : 'appeared on the page'} after ${elapsed.toFixed(1)} s.`;
          break;
        }
        if (elapsed >= seconds || signal.aborted) {
          msg = `"${condition.text}" ${condition.gone ? 'is still on the page' : 'did not appear on the page'} after ${seconds} s.`;
          break;
        }
        await sleep(WAIT_POLL_MS);
      }
    }

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

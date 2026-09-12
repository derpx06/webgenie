import { ActionResult } from '@src/background/agent/types';
import type { searchGoogleActionSchema, searchWebActionSchema, goToUrlActionSchema, waitActionSchema } from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

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

  async handleSearchGoogle(input: z.infer<typeof searchGoogleActionSchema.schema>): Promise<ActionResult> {
    return this.handleSearchWeb({
      query: input.query,
      engine: 'google',
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

  async handleWait(input: z.infer<typeof waitActionSchema.schema>): Promise<ActionResult> {
    const seconds = input.seconds || 3;
    const intent = t('act_wait_start', [seconds.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, seconds * 1000);
      this.context.controller.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
    });

    const msg = t('act_wait_ok', [seconds.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

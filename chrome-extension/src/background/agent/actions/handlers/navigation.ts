import { ActionResult } from '@src/background/agent/types';
import { searchGoogleActionSchema, goToUrlActionSchema, goBackActionSchema, waitActionSchema } from '../schemas';
import { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

export class NavigationHandler extends BaseHandler {
  async handleSearchGoogle(input: z.infer<typeof searchGoogleActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_searchGoogle_start', [input.query]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await this.context.browserContext.navigateTo(`https://www.google.com/search?q=${input.query}`);

    const msg = t('act_searchGoogle_ok', [input.query]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: msg,
      includeInMemory: true,
    });
  }

  async handleGoToUrl(input: z.infer<typeof goToUrlActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_goToUrl_start', [input.url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await this.context.browserContext.navigateTo(input.url);
    const msg = t('act_goToUrl_ok', [input.url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: msg,
      includeInMemory: true,
    });
  }

  async handleGoBack(input: z.infer<typeof goBackActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_goBack_start');
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
    const intent = input.intent || t('act_wait_start', [seconds.toString()]);
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

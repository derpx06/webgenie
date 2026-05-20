import { ActionResult } from '@src/background/agent/types';
import type { sendKeysActionSchema } from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

export class KeyboardHandler extends BaseHandler {
  async handleSendKeys(input: z.infer<typeof sendKeysActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_sendKeys_start', [input.keys]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    await page.sendKeys(input.keys);
    const msg = t('act_sendKeys_ok', [input.keys]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

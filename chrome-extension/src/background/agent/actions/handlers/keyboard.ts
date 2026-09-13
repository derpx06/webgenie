import { ActionResult } from '@src/background/agent/types';
import type { sendKeysActionSchema } from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

export class KeyboardHandler extends BaseHandler {
  async handleSendKeys(input: z.infer<typeof sendKeysActionSchema.schema>): Promise<ActionResult> {
    const repeat = Math.min(Math.max(Math.floor(input.repeat ?? 1), 1), 50);
    const shown = repeat > 1 ? `${input.keys} x${repeat}` : input.keys;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, t('act_sendKeys_start', [shown]));

    const page = await this.context.browserContext.getCurrentPage();
    const node = input.index != null ? (await page.getCurrentState()).selectorMap.get(input.index) : undefined;
    if (input.index != null && !node) {
      return this.handleElementNotFound(input.index);
    }
    await page.sendKeys(input.keys, node, repeat);
    const msg = t('act_sendKeys_ok', [shown]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: node ? `${msg} in [${input.index}]` : msg, includeInMemory: true });
  }
}

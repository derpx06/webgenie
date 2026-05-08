import { ActionResult } from '@src/background/agent/types';
import { switchTabActionSchema, openTabActionSchema, closeTabActionSchema } from '../schemas';
import { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

export class TabHandler extends BaseHandler {
  async handleSwitchTab(input: z.infer<typeof switchTabActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_switchTab_start', [input.tab_id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await this.context.browserContext.switchTab(input.tab_id);
    const msg = t('act_switchTab_ok', [input.tab_id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleOpenTab(input: z.infer<typeof openTabActionSchema.schema>): Promise<ActionResult> {
    let url = input.url;
    if (!url || url.startsWith('chrome://')) {
      url = 'https://www.google.com';
    }
    const intent = input.intent || t('act_openTab_start', [url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await this.context.browserContext.openTab(url);
    const msg = t('act_openTab_ok', [url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleCloseTab(input: z.infer<typeof closeTabActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_closeTab_start', [input.tab_id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await this.context.browserContext.closeTab(input.tab_id);
    const msg = t('act_closeTab_ok', [input.tab_id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

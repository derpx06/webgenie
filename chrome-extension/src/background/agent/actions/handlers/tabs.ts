import { ActionResult } from '@src/background/agent/types';
import type { switchTabActionSchema, openTabActionSchema, closeTabActionSchema } from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

export class TabHandler extends BaseHandler {
  async handleSwitchTab(input: z.infer<typeof switchTabActionSchema.schema>): Promise<ActionResult> {
    const intent = t('act_switchTab_start', [input.tab_id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await this.context.browserContext.switchTab(input.tab_id);
    const msg = t('act_switchTab_ok', [input.tab_id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleOpenTab(input: z.infer<typeof openTabActionSchema.schema>): Promise<ActionResult> {
    const url = input.url.trim();
    const intent = t('act_openTab_start', [url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    if (!url || url.toLowerCase().startsWith('chrome://')) {
      const error = `open_tab opens web addresses only; "${url}" cannot be opened. Open an https:// address, or use search_web to search.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, error);
      return new ActionResult({ error, includeInMemory: true });
    }

    const page = await this.context.browserContext.openTab(url);
    const msg = t('act_openTab_ok', [url]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: `${msg} in new tab ${page.tabId}, now the current tab.`, includeInMemory: true });
  }

  async handleCloseTab(input: z.infer<typeof closeTabActionSchema.schema>): Promise<ActionResult> {
    const intent = t('act_closeTab_start', [input.tab_id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    await this.context.browserContext.closeTab(input.tab_id);
    const msg = t('act_closeTab_ok', [input.tab_id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

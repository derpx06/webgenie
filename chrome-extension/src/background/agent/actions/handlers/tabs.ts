import { ActionResult } from '@src/background/agent/types';
import type { switchTabActionSchema } from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

export class TabHandler extends BaseHandler {
  /** One verb for the tab list the state already shows: switch to a tab, or close it. */
  async handleSwitchTab(input: z.infer<typeof switchTabActionSchema.schema>): Promise<ActionResult> {
    const id = input.tab_id;
    const close = input.action === 'close';
    this.context.emitEvent(
      Actors.NAVIGATOR,
      ExecutionState.ACT_START,
      t(close ? 'act_closeTab_start' : 'act_switchTab_start', [id.toString()]),
    );

    if (close) await this.context.browserContext.closeTab(id);
    else await this.context.browserContext.switchTab(id);

    const msg = t(close ? 'act_closeTab_ok' : 'act_switchTab_ok', [id.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

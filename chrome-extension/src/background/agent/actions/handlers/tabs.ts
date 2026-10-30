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

    // A wrong tab id used to come back as a bare adapter error. The ids are the one thing the model cannot guess,
    // so the refusal carries them, the way a stale element index carries the current list.
    const tabs = await this.context.browserContext.getTabInfos();
    if (!tabs.some(tab => tab.id === id)) {
      const open = tabs.map(tab => `${tab.id}${tab.mine ? '' : " (the user's)"}`).join(', ') || 'none';
      const msg = `There is no tab ${id}. Open tab ids: ${open}. Use one of those, or go_to_url with new_tab to open another.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    if (close) await this.context.browserContext.closeTab(id);
    else await this.context.browserContext.switchTab(id);

    // Name the page it landed on: a task working across tabs has to know which one it is now on, and the id alone
    // does not say. Titles are the site's words.
    const landed = close ? null : (await this.context.browserContext.getTabInfos()).find(tab => tab.id === id);
    const where = landed ? ` Now on ${landed.url}` : '';
    const msg = `${t(close ? 'act_closeTab_ok' : 'act_switchTab_ok', [id.toString()])}${where}`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

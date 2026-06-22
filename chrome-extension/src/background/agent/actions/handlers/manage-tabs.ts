import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageTabsActionSchema } from '../schemas';

type ManageTabsInput = z.infer<typeof manageTabsActionSchema.schema>;

export class ManageTabsHandler extends BaseHandler {
  async handleManageTabs(input: ManageTabsInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing tabs with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'groupTabs') {
        if (!input.tabIds || input.tabIds.length === 0) throw new Error('tabIds array is required to group tabs');
        const groupId = await browser.groupTabs({ tabIds: input.tabIds });
        if (input.title || input.color || input.collapsed !== undefined) {
          await browser.updateTabGroup(groupId, { title: input.title, color: input.color as any, collapsed: input.collapsed });
        }
        resultText = `Successfully grouped tabs ${input.tabIds.join(', ')} into group ID: ${groupId}`;
      } else if (action === 'ungroupTabs') {
        if (!input.tabIds || input.tabIds.length === 0) throw new Error('tabIds array is required to ungroup tabs');
        await browser.ungroupTabs(input.tabIds);
        resultText = `Successfully ungrouped tabs ${input.tabIds.join(', ')}`;
      } else if (action === 'updateGroup') {
        if (input.groupId === undefined) throw new Error('groupId is required to update a group');
        await browser.updateTabGroup(input.groupId, { title: input.title, color: input.color as any, collapsed: input.collapsed });
        resultText = `Successfully updated group ${input.groupId}`;
      } else {
        throw new Error(`Unsupported action "${action}" for manage_tabs`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage tabs ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_tabs ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

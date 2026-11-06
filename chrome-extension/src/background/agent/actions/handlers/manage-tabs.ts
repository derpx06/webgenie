import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageTabsActionSchema } from '../schemas';

type ManageTabsInput = z.infer<typeof manageTabsActionSchema.schema>;

/** Lines a listing returns: a person with hundreds of tabs open still gets a result the model can read. */
const MAX_LISTED = 150;

export class ManageTabsHandler extends BaseHandler {
  async handleManageTabs(input: ManageTabsInput): Promise<ActionResult> {
    const action = input.action;
    const intent = `Managing tabs with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'listTabs') {
        const tabs = await browser.queryTabs(input.windowId !== undefined ? { windowId: input.windowId } : {});
        const needle = input.query?.toLowerCase();
        const shown = tabs.filter(tab => !needle || `${tab.title ?? ''} ${tab.url ?? ''}`.toLowerCase().includes(needle));
        resultText =
          `${shown.length} open tabs${needle ? ` matching "${input.query}"` : ''}:\n` +
          shown
            .slice(0, MAX_LISTED)
            .map(
              tab =>
                `- [${tab.id}] ${tab.title || 'Untitled'} (${(tab.url ?? '').slice(0, 120)}) window ${tab.windowId}` +
                `${tab.groupId !== undefined && tab.groupId >= 0 ? `, group ${tab.groupId}` : ''}${tab.active ? ', active' : ''}${tab.pinned ? ', pinned' : ''}`,
            )
            .join('\n') +
          (shown.length > MAX_LISTED ? `\n(${shown.length - MAX_LISTED} more not shown: narrow it with query or windowId)` : '');
      } else if (action === 'listGroups') {
        const groups = await browser.queryTabGroups(input.windowId !== undefined ? { windowId: input.windowId } : {});
        const tabs = await browser.queryTabs({});
        resultText =
          `${groups.length} tab groups:\n` +
          groups
            .map(group => {
              const members = tabs.filter(tab => tab.groupId === group.id).map(tab => tab.id);
              return `- [${group.id}] "${group.title || 'Unnamed'}" ${group.color}${group.collapsed ? ', collapsed' : ''}, window ${group.windowId}, tabs ${members.join(', ') || 'none'}`;
            })
            .join('\n');
      } else if (action === 'groupTabs') {
        if (!input.tabIds || input.tabIds.length === 0) throw new Error('tabIds array is required to group tabs');
        if (input.windowId !== undefined) {
          const windowTabs = await browser.queryTabs({ windowId: input.windowId });
          const windowTabIds = new Set(windowTabs.map(tab => tab.id));
          const outsideWindow = input.tabIds.filter((tabId: number) => !windowTabIds.has(tabId));
          if (outsideWindow.length > 0) {
            throw new Error(`Tabs ${outsideWindow.join(', ')} are not in window ${input.windowId}`);
          }
        }
        const groupId = await browser.groupTabs(
          input.groupId !== undefined ? { tabIds: input.tabIds, groupId: input.groupId } : { tabIds: input.tabIds },
        );
        if (input.title || input.color || input.collapsed !== undefined) {
          await browser.updateTabGroup(groupId, { title: input.title, color: input.color as any, collapsed: input.collapsed });
        }
        resultText = `Grouped tabs ${input.tabIds.join(', ')} into group ${groupId}${input.title ? ` "${input.title}"` : ''}`;
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

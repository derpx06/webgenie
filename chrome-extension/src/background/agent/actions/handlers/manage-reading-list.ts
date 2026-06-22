import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageReadingListActionSchema } from '../schemas';

type ManageReadingListInput = z.infer<typeof manageReadingListActionSchema.schema>;

export class ManageReadingListHandler extends BaseHandler {
  async handleManageReadingList(input: ManageReadingListInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing reading list with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'query') {
        const items = await browser.queryReadingList();
        resultText = `Retrieved ${items.length} reading list items:\n` +
          items.map((item: any) => `- [${item.title}](${item.url}) (Read: ${item.hasBeenRead})`).join('\n');
      } else if (action === 'getUnread') {
        const items = await browser.queryReadingList({ hasBeenRead: false });
        resultText = `Retrieved ${items.length} unread reading list items:\n` +
          items.map((item: any) => `- [${item.title}](${item.url})`).join('\n');
      } else if (action === 'add') {
        if (!input.url || !input.title) throw new Error('url and title are required for readingList add');
        await browser.addReadingListItem({ url: input.url, title: input.title, hasBeenRead: false });
        resultText = `Successfully added [${input.title}](${input.url}) to the reading list.`;
      } else if (action === 'markAsRead') {
        if (!input.url) throw new Error('URL is required for readingList markAsRead');
        await browser.updateReadingListItem({ url: input.url, hasBeenRead: true });
        resultText = `Successfully marked reading list item ${input.url} as read.`;
      } else {
        throw new Error(`Unsupported action "${action}" for manage_reading_list`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage reading list ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_reading_list ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageDownloadsActionSchema } from '../schemas';

type ManageDownloadsInput = z.infer<typeof manageDownloadsActionSchema.schema>;

/** Searches the browser's downloads. Starting a download is a click on the page, which the user's request controls. */
export class ManageDownloadsHandler extends BaseHandler {
  async handleManageDownloads(input: ManageDownloadsInput): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, 'Searching downloads');
    const items = await this.context.browserContext.browser.searchDownloads({ query: input.query ? [input.query] : [] });
    const resultText =
      `Found ${items.length} downloads:\n` +
      items
        .map((item: chrome.downloads.DownloadItem) => `- ${item.filename.split(/[\\/]/).pop()} from ${item.finalUrl || item.url} (${item.state})`)
        .join('\n');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Found ${items.length} downloads`);
    return new ActionResult({ extractedContent: resultText, includeInMemory: true });
  }
}

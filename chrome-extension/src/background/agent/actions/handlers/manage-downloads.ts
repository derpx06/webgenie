import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageDownloadsActionSchema } from '../schemas';

type ManageDownloadsInput = z.infer<typeof manageDownloadsActionSchema.schema>;

export class ManageDownloadsHandler extends BaseHandler {
  async handleManageDownloads(input: ManageDownloadsInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing downloads with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'download') {
        if (!input.url) throw new Error('URL is required for downloads action');
        const downloadId = await browser.downloadFile({
          url: input.url,
          filename: input.filename,
          conflictAction: input.conflictAction as any,
          saveAs: input.saveAs,
        });
        resultText = `Triggered download for ${input.url}. Download ID: ${downloadId}`;
      } else if (action === 'searchDownloads') {
        const items = await browser.searchDownloads({ query: input.query ? [input.query] : [] });
        resultText = `Found ${items.length} download items:\n` +
          items.map((item: chrome.downloads.DownloadItem) => `- [${item.filename}](${item.url}) (State: ${item.state})`).join('\n');
      } else {
        throw new Error(`Unsupported action "${action}" for manage_downloads`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage downloads ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_downloads ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

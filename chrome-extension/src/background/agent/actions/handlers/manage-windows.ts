import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageWindowsActionSchema } from '../schemas';

type ManageWindowsInput = z.infer<typeof manageWindowsActionSchema.schema>;

export class ManageWindowsHandler extends BaseHandler {
  async handleManageWindows(input: ManageWindowsInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing windows with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'getAllWindows') {
        const windows = await browser.getAllWindows({ populate: true });
        resultText = `Retrieved ${windows.length} windows:\n` +
          windows.map((w: chrome.windows.Window) => `- Window ID: ${w.id}, State: ${w.state}, Tabs: ${w.tabs?.length || 0}`).join('\n');
      } else if (action === 'getCurrentWindow') {
        const w = await browser.getCurrentWindow();
        resultText = `Current window ID: ${w.id}, State: ${w.state}`;
      } else {
        throw new Error(`Unsupported action "${action}" for manage_windows`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage windows ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_windows ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { managePrivacyActionSchema } from '../schemas';

type ManagePrivacyInput = z.infer<typeof managePrivacyActionSchema.schema>;

export class ManagePrivacyHandler extends BaseHandler {
  async handleManagePrivacy(input: ManagePrivacyInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing privacy with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'clearData') {
        const since = input.clearSince || 0;
        const dataTypes: Record<string, boolean> = {};
        if (input.clearTypes && input.clearTypes.length > 0) {
          input.clearTypes.forEach((t: string) => dataTypes[t] = true);
        } else {
          // default to clearing cache and cookies
          dataTypes.cache = true;
          dataTypes.cookies = true;
        }
        await browser.removeBrowsingData({ since }, dataTypes);
        resultText = `Successfully cleared browsing data: ${Object.keys(dataTypes).join(', ')}`;
      } else {
        throw new Error(`Unsupported action "${action}" for manage_privacy`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage privacy ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_privacy ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

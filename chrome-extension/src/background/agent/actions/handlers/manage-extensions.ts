import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageExtensionsActionSchema } from '../schemas';

type ManageExtensionsInput = z.infer<typeof manageExtensionsActionSchema.schema>;

export class ManageExtensionsHandler extends BaseHandler {
  async handleManageExtensions(input: ManageExtensionsInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing extensions with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'getAll') {
        const exts = await browser.getAllExtensions();
        resultText = `Retrieved ${exts.length} extensions:\n` +
          exts.map((e: chrome.management.ExtensionInfo) => `- [${e.enabled ? 'ENABLED' : 'DISABLED'}] ${e.name} (ID: ${e.id})`).join('\n');
      } else if (action === 'setEnabled') {
        if (!input.extensionId || input.extensionEnabled === undefined) throw new Error('extensionId and extensionEnabled are required');
        await browser.setExtensionEnabled(input.extensionId, input.extensionEnabled);
        resultText = `Successfully set extension ${input.extensionId} to ${input.extensionEnabled ? 'enabled' : 'disabled'}`;
      } else {
        throw new Error(`Unsupported action "${action}" for manage_extensions`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage extensions ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_extensions ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

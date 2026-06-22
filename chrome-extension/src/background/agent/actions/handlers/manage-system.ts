import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageSystemActionSchema } from '../schemas';

type ManageSystemInput = z.infer<typeof manageSystemActionSchema.schema>;

export class ManageSystemHandler extends BaseHandler {
  async handleManageSystem(input: ManageSystemInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing system with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'getCpu') {
        const cpu = await browser.getSystemCpu();
        resultText = `CPU Info:\nModel Name: ${cpu.modelName}\nArch: ${cpu.archName}\nProcessors: ${cpu.numOfProcessors}`;
      } else if (action === 'getMemory') {
        const mem = await browser.getSystemMemory();
        const formatBytes = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        resultText = `Memory Info:\nCapacity: ${formatBytes(mem.capacity)}\nAvailable: ${formatBytes(mem.availableCapacity)}`;
      } else {
        throw new Error(`Unsupported action "${action}" for manage_system`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage system ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_system ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

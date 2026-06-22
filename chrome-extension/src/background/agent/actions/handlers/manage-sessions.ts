import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageSessionsActionSchema } from '../schemas';

type ManageSessionsInput = z.infer<typeof manageSessionsActionSchema.schema>;

export class ManageSessionsHandler extends BaseHandler {
  async handleManageSessions(input: ManageSessionsInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing sessions with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'getRecentlyClosed') {
        const sessions = await browser.getRecentlyClosed();
        resultText = `Retrieved ${sessions.length} recently closed sessions:\n` +
          sessions.map((s: chrome.sessions.Session) => `- Session ID: ${s.tab?.sessionId || s.window?.sessionId} (${s.tab ? 'Tab: ' + s.tab.title : 'Window'})`).join('\n');
      } else if (action === 'restore') {
        const session = await browser.restoreSession(input.sessionId);
        resultText = `Successfully restored session ${session.tab?.sessionId || session.window?.sessionId || 'default'}`;
      } else {
        throw new Error(`Unsupported action "${action}" for manage_sessions`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage sessions ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_sessions ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

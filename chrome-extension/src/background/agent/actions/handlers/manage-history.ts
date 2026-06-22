import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageHistoryActionSchema } from '../schemas';

type ManageHistoryInput = z.infer<typeof manageHistoryActionSchema.schema>;

export class ManageHistoryHandler extends BaseHandler {
  async handleManageHistory(input: ManageHistoryInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing history with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';
      const daysAgo = input.daysAgo ?? 7;
      const maxResults = input.maxResults ?? 1000;
      const text = input.query ?? '';
      const startTime = Date.now() - daysAgo * 24 * 60 * 60 * 1000;

      if (action === 'getRecent') {
        const items = await browser.searchHistory({ text, startTime, maxResults });
        resultText = `Retrieved ${items.length} history items:\n` +
          items.map((item: chrome.history.HistoryItem) => `- [${item.title || 'Untitled'}](${item.url}) (Visits: ${item.visitCount})`).join('\n');
      } else if (action === 'getFrequentDomains') {
        const items = await browser.searchHistory({ text: '', startTime, maxResults: 10000 });
        const domainCounts: Record<string, { count: number; lastVisit: number }> = {};
        for (const item of items) {
          if (!item.url) continue;
          try {
            const domain = new URL(item.url).hostname;
            if (!domainCounts[domain]) domainCounts[domain] = { count: 0, lastVisit: 0 };
            domainCounts[domain].count += (item.visitCount ?? 1);
            domainCounts[domain].lastVisit = Math.max(domainCounts[domain].lastVisit, item.lastVisitTime ?? 0);
          } catch { continue; }
        }
        const minVisitCount = input.minVisitCount ?? 1;
        const insights = Object.entries(domainCounts)
          .map(([domain, data]) => ({ domain, ...data }))
          .filter((item: any) => item.count >= minVisitCount)
          .sort((a: any, b: any) => b.count - a.count);
        resultText = `Top frequent domains in history:\n` +
          insights.map((i: any) => `- ${i.domain}: ${i.count} visits`).join('\n');
      } else {
        throw new Error(`Unsupported action "${action}" for manage_history`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage history ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_history ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

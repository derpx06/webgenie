import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageHistoryActionSchema } from '../schemas';

type ManageHistoryInput = z.infer<typeof manageHistoryActionSchema.schema>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Most pages a listing returns, however many the model asks for: the rest would cost more than they tell. */
const MAX_PAGES = 200;
const when = (time?: number) => (time ? new Date(time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown');

export class ManageHistoryHandler extends BaseHandler {
  async handleManageHistory(input: ManageHistoryInput): Promise<ActionResult> {
    const action = input.action;
    const intent = `Managing history with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';
      const daysAgo = input.daysAgo ?? 7;
      const maxResults = Math.min(input.maxResults ?? 50, MAX_PAGES);
      const text = input.query ?? '';
      const startTime = Date.now() - daysAgo * DAY_MS;
      const endTime = input.endDaysAgo !== undefined ? Date.now() - input.endDaysAgo * DAY_MS : undefined;

      if (action === 'getRecent') {
        const items = await browser.searchHistory({ text, startTime, ...(endTime !== undefined ? { endTime } : {}), maxResults });
        const range = `${when(startTime)} to ${endTime !== undefined ? when(endTime) : 'now'}`;
        resultText =
          `${items.length} pages visited ${range}${text ? ` matching "${text}"` : ''}, newest first:\n` +
          items
            .map(item => `- ${item.title || 'Untitled'} (${item.url}) last visited ${when(item.lastVisitTime)}, ${item.visitCount ?? 1} visits`)
            .join('\n') +
          (items.length >= maxResults ? `\n(showing the newest ${maxResults}; narrow it with query, daysAgo or endDaysAgo for older pages)` : '');
      } else if (action === 'getFrequentDomains') {
        const items = await browser.searchHistory({ text, startTime, ...(endTime !== undefined ? { endTime } : {}), maxResults: 10000 });
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
        resultText =
          `Most visited sites since ${when(startTime)}:\n` +
          insights.slice(0, 25).map((i: any) => `- ${i.domain}: ${i.count} visits, last ${when(i.lastVisit)}`).join('\n');
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

export interface HistoryInsight {
  domain: string;
  visitCount: number;
  lastVisit: number;
}

/**
 * Queries browsing history with full search and limit options.
 */
export async function getRecentHistory(
  options: {
    daysAgo?: number;
    maxResults?: number;
    text?: string;
    startTime?: number;
    endTime?: number;
  } = {}
): Promise<chrome.history.HistoryItem[]> {
  const daysAgo = options.daysAgo ?? 7;
  const maxResults = options.maxResults ?? 1000;
  const text = options.text ?? '';
  const startTime = options.startTime ?? (Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const endTime = options.endTime;

  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.history) {
      resolve([]);
      return;
    }
    const query: chrome.history.HistoryQuery = { text, startTime, maxResults };
    if (endTime !== undefined) {
      query.endTime = endTime;
    }
    chrome.history.search(query, (items) => {
      resolve(items);
    });
  });
}

/**
 * Extracts and groups browsing frequency by hostname, with visit count threshold filtering.
 */
export async function getFrequentHistoryDomains(daysAgo = 7, minVisitCount = 1): Promise<HistoryInsight[]> {
  const items = await getRecentHistory({ daysAgo });
  const domainCounts: Record<string, { count: number; lastVisit: number }> = {};

  for (const item of items) {
    if (!item.url) continue;
    try {
      const domain = new URL(item.url).hostname;
      if (!domainCounts[domain]) {
        domainCounts[domain] = { count: 0, lastVisit: 0 };
      }
      domainCounts[domain].count += (item.visitCount ?? 1);
      domainCounts[domain].lastVisit = Math.max(domainCounts[domain].lastVisit, item.lastVisitTime ?? 0);
    } catch {
      continue;
    }
  }

  return Object.entries(domainCounts)
    .map(([domain, data]) => ({
      domain,
      visitCount: data.count,
      lastVisit: data.lastVisit,
    }))
    .filter(item => item.visitCount >= minVisitCount)
    .sort((a, b) => b.visitCount - a.visitCount);
}

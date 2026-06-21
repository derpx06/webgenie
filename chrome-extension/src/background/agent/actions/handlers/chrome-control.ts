import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { chromeControlActionSchema } from '../schemas';

type ChromeControlInput = z.infer<typeof chromeControlActionSchema.schema>;

export class ChromeControlHandler extends BaseHandler {
  async handleChromeControl(input: ChromeControlInput): Promise<ActionResult> {
    const subsystem = input.subsystem;
    const action = input.action;
    const intent = input.intent || `Controlling Chrome subsystem ${subsystem} with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      switch (subsystem) {
        case 'bookmarks': {
          if (action === 'getFlat') {
            const tree = await browser.getBookmarksTree();
            const flat: any[] = [];
            const flatten = (nodes: chrome.bookmarks.BookmarkTreeNode[], path = '') => {
              for (const node of nodes) {
                const currentPath = path ? `${path}/${node.title}` : node.title;
                if (node.url) {
                  if (!input.folderPath || currentPath.includes(input.folderPath)) {
                    flat.push({ ...node, folderPath: path });
                  }
                }
                if (node.children) flatten(node.children, currentPath);
              }
            };
            flatten(tree);
            resultText = `Retrieved ${flat.length} bookmarks:\n` +
              flat.map((b: any) => `- [${b.title}](${b.url}) in folder: "${b.folderPath}"`).join('\n');
          } else if (action === 'search') {
            if (!input.query && !input.url && !input.title) {
               throw new Error('At least one of query, url, or title is required for bookmarks search');
            }
            let finalQuery: any = input.query;
            if (input.url || input.title) {
               finalQuery = {};
               if (input.query) finalQuery.query = input.query;
               if (input.url) finalQuery.url = input.url;
               if (input.title) finalQuery.title = input.title;
            }
            const results = await browser.searchBookmarks(finalQuery);
            resultText = `Found ${results.length} bookmarks matching search criteria:\n` +
              results.map((b: chrome.bookmarks.BookmarkTreeNode) => `- [${b.title || 'Untitled'}](${b.url || ''})`).join('\n');
          } else if (action === 'create') {
            if (!input.title) throw new Error('Title parameter is required for bookmarks create');
            const bookmarkNode = await browser.createBookmark({ title: input.title, url: input.url, parentId: input.parentId });
            resultText = `Successfully created bookmark "${bookmarkNode.title}"`;
          } else {
            throw new Error(`Unsupported action "${action}" for bookmarks subsystem`);
          }
          break;
        }

        case 'readingList': {
          if (action === 'query') {
            const items = await browser.queryReadingList();
            resultText = `Retrieved ${items.length} reading list items:\n` +
              items.map((item: any) => `- [${item.title}](${item.url}) (Read: ${item.hasBeenRead})`).join('\n');
          } else if (action === 'getUnread') {
            const items = await browser.queryReadingList({ hasBeenRead: false });
            resultText = `Retrieved ${items.length} unread reading list items:\n` +
              items.map((item: any) => `- [${item.title}](${item.url})`).join('\n');
          } else if (action === 'add') {
            if (!input.url || !input.title) throw new Error('url and title are required for readingList add');
            await browser.addReadingListItem({ url: input.url, title: input.title, hasBeenRead: false });
            resultText = `Successfully added [${input.title}](${input.url}) to the reading list.`;
          } else if (action === 'markAsRead') {
            if (!input.url) throw new Error('URL is required for readingList markAsRead');
            await browser.updateReadingListItem({ url: input.url, hasBeenRead: true });
            resultText = `Successfully marked reading list item ${input.url} as read.`;
          } else {
            throw new Error(`Unsupported action "${action}" for readingList subsystem`);
          }
          break;
        }

        case 'history': {
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
            throw new Error(`Unsupported action "${action}" for history subsystem`);
          }
          break;
        }

        case 'downloads': {
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
            throw new Error(`Unsupported action "${action}" for downloads subsystem`);
          }
          break;
        }

        case 'tabGroups': {
          if (action === 'groupTabs') {
            if (!input.tabIds || input.tabIds.length === 0) throw new Error('tabIds array is required to group tabs');
            const groupId = await browser.groupTabs({ tabIds: input.tabIds });
            if (input.title || input.color || input.collapsed !== undefined) {
              await browser.updateTabGroup(groupId, { title: input.title, color: input.color as any, collapsed: input.collapsed });
            }
            resultText = `Successfully grouped tabs ${input.tabIds.join(', ')} into group ID: ${groupId}`;
          } else if (action === 'ungroupTabs') {
            if (!input.tabIds || input.tabIds.length === 0) throw new Error('tabIds array is required to ungroup tabs');
            await browser.ungroupTabs(input.tabIds);
            resultText = `Successfully ungrouped tabs ${input.tabIds.join(', ')}`;
          } else if (action === 'updateGroup') {
            if (input.groupId === undefined) throw new Error('groupId is required to update a group');
            await browser.updateTabGroup(input.groupId, { title: input.title, color: input.color as any, collapsed: input.collapsed });
            resultText = `Successfully updated group ${input.groupId}`;
          } else {
            throw new Error(`Unsupported action "${action}" for tabGroups subsystem`);
          }
          break;
        }

        case 'windows': {
          if (action === 'getAllWindows') {
            const windows = await browser.getAllWindows({ populate: true });
            resultText = `Retrieved ${windows.length} windows:\n` +
              windows.map((w: chrome.windows.Window) => `- Window ID: ${w.id}, State: ${w.state}, Tabs: ${w.tabs?.length || 0}`).join('\n');
          } else if (action === 'getCurrentWindow') {
            const w = await browser.getCurrentWindow();
            resultText = `Current window ID: ${w.id}, State: ${w.state}`;
          } else {
            throw new Error(`Unsupported action "${action}" for windows subsystem`);
          }
          break;
        }

        case 'privacy': {
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
            throw new Error(`Unsupported action "${action}" for privacy subsystem`);
          }
          break;
        }

        case 'extensions': {
          if (action === 'getAll') {
            const exts = await browser.getAllExtensions();
            resultText = `Retrieved ${exts.length} extensions:\n` +
              exts.map((e: chrome.management.ExtensionInfo) => `- [${e.enabled ? 'ENABLED' : 'DISABLED'}] ${e.name} (ID: ${e.id})`).join('\n');
          } else if (action === 'setEnabled') {
            if (!input.extensionId || input.extensionEnabled === undefined) throw new Error('extensionId and extensionEnabled are required');
            await browser.setExtensionEnabled(input.extensionId, input.extensionEnabled);
            resultText = `Successfully set extension ${input.extensionId} to ${input.extensionEnabled ? 'enabled' : 'disabled'}`;
          } else {
            throw new Error(`Unsupported action "${action}" for extensions subsystem`);
          }
          break;
        }

        case 'system': {
          if (action === 'getCpu') {
            const cpu = await browser.getSystemCpu();
            resultText = `CPU Info:\nModel Name: ${cpu.modelName}\nArch: ${cpu.archName}\nProcessors: ${cpu.numOfProcessors}`;
          } else if (action === 'getMemory') {
            const mem = await browser.getSystemMemory();
            const formatBytes = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
            resultText = `Memory Info:\nCapacity: ${formatBytes(mem.capacity)}\nAvailable: ${formatBytes(mem.availableCapacity)}`;
          } else {
            throw new Error(`Unsupported action "${action}" for system subsystem`);
          }
          break;
        }

        case 'sessions': {
          if (action === 'getRecentlyClosed') {
            const sessions = await browser.getRecentlyClosed();
            resultText = `Retrieved ${sessions.length} recently closed sessions:\n` +
              sessions.map((s: chrome.sessions.Session) => `- Session ID: ${s.tab?.sessionId || s.window?.sessionId} (${s.tab ? 'Tab: ' + s.tab.title : 'Window'})`).join('\n');
          } else if (action === 'restore') {
            const session = await browser.restoreSession(input.sessionId);
            resultText = `Successfully restored session ${session.tab?.sessionId || session.window?.sessionId || 'default'}`;
          } else {
            throw new Error(`Unsupported action "${action}" for sessions subsystem`);
          }
          break;
        }

        default:
          throw new Error(`Unsupported Chrome control subsystem: "${subsystem}"`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Chrome control ${subsystem} ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing chrome_control ${subsystem} ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

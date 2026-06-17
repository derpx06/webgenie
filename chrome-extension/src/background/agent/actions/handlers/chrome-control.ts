import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import {
  getFlatBookmarks,
  searchBookmarks,
  createBookmark,
  queryReadingList,
  getUnreadReadingList,
  addReadingListItem,
  markReadingListItemAsRead,
  getRecentHistory,
  getFrequentHistoryDomains,
  downloadFile,
  searchDownloads,
} from '@src/background/browser/chromium-apis';
import type { chromeControlActionSchema } from '../schemas';

type ChromeControlInput = z.infer<typeof chromeControlActionSchema.schema>;

export class ChromeControlHandler extends BaseHandler {
  async handleChromeControl(input: ChromeControlInput): Promise<ActionResult> {
    const subsystem = input.subsystem;
    const action = input.action;
    const intent = input.intent || `Controlling Chrome subsystem ${subsystem} with action ${action}`;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      switch (subsystem) {
        case 'bookmarks': {
          if (action === 'getFlat') {
            const minDateAdded = undefined; // We can add mapping if needed in the future
            const bookmarks = await getFlatBookmarks({
              folderPath: input.folderPath,
              minDateAdded,
            });
            resultText = `Retrieved ${bookmarks.length} bookmarks:\n` +
              bookmarks.map(b => `- [${b.title}](${b.url}) in folder: "${b.folderPath}"`).join('\n');
          } else if (action === 'search') {
            if (!input.query) {
              throw new Error('Query parameter is required for bookmarks search action');
            }
            const results = await searchBookmarks(input.query);
            resultText = `Found ${results.length} bookmarks matching query "${input.query}":\n` +
              results.map(b => `- [${b.title || 'Untitled'}](${b.url || ''})`).join('\n');
          } else if (action === 'create') {
            if (!input.title) {
              throw new Error('Title parameter is required for bookmarks create action');
            }
            const bookmarkNode = await createBookmark(input.title, input.url, input.parentId);
            resultText = `Successfully created bookmark "${bookmarkNode.title}" with ID ${bookmarkNode.id}${bookmarkNode.url ? ` for URL ${bookmarkNode.url}` : ''}`;
          } else {
            throw new Error(`Unsupported action "${action}" for bookmarks subsystem`);
          }
          break;
        }

        case 'readingList': {
          if (action === 'query') {
            const items = await queryReadingList();
            resultText = `Retrieved ${items.length} reading list items:\n` +
              items.map(item => `- [${item.title}](${item.url}) (Read: ${item.hasBeenRead})`).join('\n');
          } else if (action === 'getUnread') {
            const items = await getUnreadReadingList();
            resultText = `Retrieved ${items.length} unread reading list items:\n` +
              items.map(item => `- [${item.title}](${item.url}) (Added: ${new Date(item.creationTime).toLocaleString()})`).join('\n');
          } else if (action === 'add') {
            if (!input.url || !input.title) {
              throw new Error('Both url and title parameters are required for readingList add action');
            }
            await addReadingListItem(input.url, input.title);
            resultText = `Successfully added [${input.title}](${input.url}) to the reading list.`;
          } else if (action === 'markAsRead') {
            if (!input.url) {
              throw new Error('URL parameter is required for readingList markAsRead action');
            }
            await markReadingListItemAsRead(input.url);
            resultText = `Successfully marked reading list item ${input.url} as read.`;
          } else {
            throw new Error(`Unsupported action "${action}" for readingList subsystem`);
          }
          break;
        }

        case 'history': {
          if (action === 'getRecent') {
            const items = await getRecentHistory({
              daysAgo: input.daysAgo,
              maxResults: input.maxResults,
              text: input.query,
            });
            resultText = `Retrieved ${items.length} history items:\n` +
              items.map(item => `- [${item.title || 'Untitled'}](${item.url}) (Visits: ${item.visitCount}, Last Visited: ${new Date(item.lastVisitTime ?? 0).toLocaleString()})`).join('\n');
          } else if (action === 'getFrequentDomains') {
            const insights = await getFrequentHistoryDomains(input.daysAgo, input.minVisitCount);
            resultText = `Top frequent domains in history:\n` +
              insights.map(i => `- ${i.domain}: ${i.visitCount} visits (Last Visited: ${new Date(i.lastVisit).toLocaleString()})`).join('\n');
          } else {
            throw new Error(`Unsupported action "${action}" for history subsystem`);
          }
          break;
        }

        case 'downloads': {
          if (action === 'download') {
            if (!input.url) {
              throw new Error('URL parameter is required for downloads download action');
            }
            const downloadId = await downloadFile({
              url: input.url,
              filename: input.filename,
              conflictAction: input.conflictAction,
              saveAs: input.saveAs,
            });
            resultText = `Triggered download for ${input.url}. Download ID: ${downloadId}`;
          } else if (action === 'searchDownloads') {
            const items = await searchDownloads(input.query || {});
            resultText = `Found ${items.length} download items:\n` +
              items.map(item => `- [${item.filename}](${item.url}) (State: ${item.state}, Total Bytes: ${item.totalBytes})`).join('\n');
          } else {
            throw new Error(`Unsupported action "${action}" for downloads subsystem`);
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

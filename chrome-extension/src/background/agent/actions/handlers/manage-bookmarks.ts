import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageBookmarksActionSchema } from '../schemas';

type ManageBookmarksInput = z.infer<typeof manageBookmarksActionSchema.schema>;

export class ManageBookmarksHandler extends BaseHandler {
  async handleManageBookmarks(input: ManageBookmarksInput): Promise<ActionResult> {
    const action = input.action;
    const intent = input.intent || `Managing bookmarks with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      if (action === 'getRecent') {
        const count = input.count || 20;
        const recent = await browser.getRecentBookmarks(count);
        resultText = `Retrieved ${recent.length} recent bookmarks:\n` +
          recent.map((b: any) => `- [${b.title}](${b.url})`).join('\n');
      } else if (action === 'getFlat') {
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
        throw new Error(`Unsupported action "${action}" for manage_bookmarks`);
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Manage bookmarks ${action} completed successfully.`);
      return new ActionResult({ extractedContent: resultText, includeInMemory: true });

    } catch (error: any) {
      const errorMsg = `Error executing manage_bookmarks ${action}: ${error.message || error}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      throw error;
    }
  }
}

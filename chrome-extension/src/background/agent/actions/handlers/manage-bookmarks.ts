import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { manageBookmarksActionSchema } from '../schemas';

type ManageBookmarksInput = z.infer<typeof manageBookmarksActionSchema.schema>;

/** Lines a listing returns: a few hundred bookmarks would cost more than they tell. */
const MAX_LISTED = 200;

export class ManageBookmarksHandler extends BaseHandler {
  async handleManageBookmarks(input: ManageBookmarksInput): Promise<ActionResult> {
    const action = input.action;
    const intent = `Managing bookmarks with action ${action}`;
    const browser = this.context.browserContext.browser;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    try {
      let resultText = '';

      const line = (b: chrome.bookmarks.BookmarkTreeNode) =>
        `- [${b.id}] ${b.title || 'Untitled'}${b.url ? ` (${b.url})` : ' (folder)'}${b.parentId ? `, in folder ${b.parentId}` : ''}`;
      const capped = (nodes: chrome.bookmarks.BookmarkTreeNode[]) =>
        nodes.slice(0, MAX_LISTED).map(line).join('\n') +
        (nodes.length > MAX_LISTED ? `\n(${nodes.length - MAX_LISTED} more not shown: narrow it with query or folderPath)` : '');
      const needId = () => {
        if (!input.id) throw new Error(`id is required to ${action} a bookmark; search or listFolders gives the ids`);
        return input.id;
      };

      if (action === 'getRecent') {
        const recent = await browser.getRecentBookmarks(input.count || 20);
        resultText = `${recent.length} most recently added bookmarks:\n${capped(recent)}`;
      } else if (action === 'getFlat' || action === 'listFolders') {
        const tree = await browser.getBookmarksTree();
        const found: chrome.bookmarks.BookmarkTreeNode[] = [];
        const paths = new Map<string, string>();
        const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[], path = '') => {
          for (const node of nodes) {
            const here = path ? `${path}/${node.title}` : node.title;
            paths.set(node.id, here);
            const isFolder = !node.url;
            if (action === 'listFolders' ? isFolder && node.id !== '0' : !isFolder) {
              if (!input.folderPath || here.toLowerCase().includes(input.folderPath.toLowerCase())) found.push(node);
            }
            if (node.children) walk(node.children, here);
          }
        };
        walk(tree);
        resultText =
          action === 'listFolders'
            ? `${found.length} folders:\n` +
              found
                .slice(0, MAX_LISTED)
                .map(f => `- [${f.id}] ${paths.get(f.id)} (${f.children?.length ?? 0} items)`)
                .join('\n')
            : `${found.length} bookmarks:\n` +
              found
                .slice(0, MAX_LISTED)
                .map(b => `- [${b.id}] ${b.title || 'Untitled'} (${b.url}) in "${paths.get(b.parentId ?? '') ?? ''}"`)
                .join('\n') +
              (found.length > MAX_LISTED ? `\n(${found.length - MAX_LISTED} more not shown: narrow it with folderPath)` : '');
      } else if (action === 'search') {
        if (!input.query && !input.url && !input.title) {
          throw new Error('At least one of query, url, or title is required for bookmarks search');
        }
        const finalQuery =
          input.url || input.title
            ? { ...(input.query ? { query: input.query } : {}), ...(input.url ? { url: input.url } : {}), ...(input.title ? { title: input.title } : {}) }
            : input.query;
        const results = await browser.searchBookmarks(finalQuery as string | object);
        resultText = `${results.length} bookmarks match:\n${capped(results)}`;
      } else if (action === 'create') {
        if (!input.title) throw new Error('Title parameter is required for bookmarks create');
        const node = await browser.createBookmark({ title: input.title, url: input.url, parentId: input.parentId });
        resultText = `Created ${node.url ? 'bookmark' : 'folder'} [${node.id}] "${node.title}"${node.parentId ? ` in folder ${node.parentId}` : ''}`;
      } else if (action === 'update') {
        const node = await browser.updateBookmark(needId(), {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
        });
        resultText = `Updated [${node.id}] to "${node.title}"${node.url ? ` (${node.url})` : ''}`;
      } else if (action === 'move') {
        if (!input.parentId) throw new Error('parentId (the destination folder id from listFolders) is required to move a bookmark');
        const node = await browser.moveBookmark(needId(), { parentId: input.parentId });
        resultText = `Moved [${node.id}] "${node.title}" into folder ${node.parentId}`;
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

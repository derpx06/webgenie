export interface BookmarkItem {
  id: string;
  title: string;
  url?: string;
  folderPath: string;
  dateAdded?: number;
}

/**
 * Recursively flattens the bookmark tree, with optional path and date filtering.
 */
export async function getFlatBookmarks(filter?: {
  folderPath?: string;
  minDateAdded?: number;
}): Promise<BookmarkItem[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.bookmarks) {
      resolve([]);
      return;
    }
    chrome.bookmarks.getTree((nodes) => {
      const flatList: BookmarkItem[] = [];
      const traverse = (node: chrome.bookmarks.BookmarkTreeNode, currentPath: string) => {
        // Exclude root containers from folder names for cleaner paths
        const isRoot = node.id === '0' || node.id === '1' || node.id === '2';
        const nodeTitle = isRoot ? '' : node.title;
        const nextPath = currentPath
          ? nodeTitle
            ? `${currentPath}/${nodeTitle}`
            : currentPath
          : nodeTitle;

        if (node.url) {
          const item: BookmarkItem = {
            id: node.id,
            title: node.title,
            url: node.url,
            folderPath: currentPath || 'Root',
            dateAdded: node.dateAdded,
          };

          // Apply filters if provided
          let match = true;
          if (filter?.folderPath && !item.folderPath.toLowerCase().includes(filter.folderPath.toLowerCase())) {
            match = false;
          }
          if (filter?.minDateAdded && item.dateAdded && item.dateAdded < filter.minDateAdded) {
            match = false;
          }

          if (match) {
            flatList.push(item);
          }
        }
        if (node.children) {
          for (const child of node.children) {
            traverse(child, nextPath);
          }
        }
      };
      for (const rootNode of nodes) {
        traverse(rootNode, '');
      }
      resolve(flatList);
    });
  });
}

/**
 * Searches bookmarks by text query or query object.
 */
export async function searchBookmarks(
  query: string | { query?: string; url?: string; title?: string }
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.bookmarks) {
      resolve([]);
      return;
    }
    chrome.bookmarks.search(query as any, (results) => {
      resolve(results);
    });
  });
}

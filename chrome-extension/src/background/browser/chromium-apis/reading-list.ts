/**
 * Queries Chrome's Reading List with specific parameters.
 */
export async function queryReadingList(queryInfo: { hasBeenRead?: boolean } = {}): Promise<any[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.readingList) {
      resolve([]);
      return;
    }
    chrome.readingList.query(queryInfo, (items) => {
      resolve(items);
    });
  });
}

/**
 * Helper to retrieve only unread items from Chrome's Reading List.
 */
export async function getUnreadReadingList(): Promise<any[]> {
  return queryReadingList({ hasBeenRead: false });
}

/**
 * Adds an item to Chrome's Reading List with options.
 */
export async function addReadingListItem(url: string, title: string, hasBeenRead = false): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.readingList) {
      reject(new Error('chrome.readingList API not available'));
      return;
    }
    chrome.readingList.addEntry({ url, title, hasBeenRead }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Marks an item as read on Chrome's Reading List.
 */
export async function markReadingListItemAsRead(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.readingList) {
      reject(new Error('chrome.readingList API not available'));
      return;
    }
    chrome.readingList.updateEntry({ url, hasBeenRead: true }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

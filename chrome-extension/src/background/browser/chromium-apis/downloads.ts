/**
 * Triggers a chrome download with conflict action and prompt option overrides.
 */
export async function downloadFile(
  options: {
    url: string;
    filename?: string;
    conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
    saveAs?: boolean;
  }
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.downloads) {
      reject(new Error('chrome.downloads API not available'));
      return;
    }
    const downloadOptions: chrome.downloads.DownloadOptions = {
      url: options.url,
      filename: options.filename,
      conflictAction: options.conflictAction || 'overwrite',
      saveAs: options.saveAs,
    };
    chrome.downloads.download(downloadOptions, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(downloadId);
      }
    });
  });
}

/**
 * Searches current and completed downloads with query parameters.
 */
export async function searchDownloads(
  query: string | chrome.downloads.DownloadQuery = {}
): Promise<chrome.downloads.DownloadItem[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.downloads) {
      resolve([]);
      return;
    }
    const searchOptions = typeof query === 'string'
      ? { query: query ? [query] : undefined }
      : query;

    chrome.downloads.search(searchOptions, (items) => {
      resolve(items);
    });
  });
}

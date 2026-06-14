/**
 * Retrieves the list of user's most visited sites.
 */
export async function getTopSites(): Promise<chrome.topSites.MostVisitedURL[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.topSites) {
      resolve([]);
      return;
    }
    chrome.topSites.get((mostVisited) => {
      resolve(mostVisited);
    });
  });
}

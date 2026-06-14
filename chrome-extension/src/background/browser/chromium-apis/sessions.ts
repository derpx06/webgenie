/**
 * Retrieves recently closed sessions.
 */
export async function getRecentlyClosedSessions(options: chrome.sessions.Filter = {}): Promise<chrome.sessions.Session[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.sessions) {
      resolve([]);
      return;
    }
    chrome.sessions.getRecentlyClosed(options, (sessions) => {
      resolve(sessions);
    });
  });
}

/**
 * Restores a recently closed session by its ID.
 */
export async function restoreSession(sessionId: string): Promise<chrome.sessions.Session> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.sessions) {
      reject(new Error('chrome.sessions API not available'));
      return;
    }
    chrome.sessions.restore(sessionId, (session) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (!session) {
        reject(new Error('Session restore failed.'));
      } else {
        resolve(session);
      }
    });
  });
}

/**
 * Retrieves the synced devices with open sessions.
 */
export async function getSyncedDevices(options: chrome.sessions.Filter = {}): Promise<chrome.sessions.Device[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.sessions) {
      resolve([]);
      return;
    }
    chrome.sessions.getDevices(options, (devices) => {
      resolve(devices);
    });
  });
}

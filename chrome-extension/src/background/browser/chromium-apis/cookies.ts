/**
 * Gets details about a single cookie.
 */
export async function getCookie(url: string, name: string): Promise<chrome.cookies.Cookie | null> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      resolve(null);
      return;
    }
    chrome.cookies.get({ url, name }, (cookie) => {
      resolve(cookie);
    });
  });
}

/**
 * Gets all cookies matching the specified details.
 */
export async function getAllCookies(details: chrome.cookies.GetAllDetails = {}): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      resolve([]);
      return;
    }
    chrome.cookies.getAll(details, (cookies) => {
      resolve(cookies);
    });
  });
}

/**
 * Sets a cookie.
 */
export async function setCookie(details: chrome.cookies.SetDetails): Promise<chrome.cookies.Cookie | null> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      reject(new Error('chrome.cookies API not available'));
      return;
    }
    chrome.cookies.set(details, (cookie) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(cookie);
      }
    });
  });
}

/**
 * Removes a cookie.
 */
export async function removeCookie(url: string, name: string): Promise<any | null> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.cookies) {
      reject(new Error('chrome.cookies API not available'));
      return;
    }
    chrome.cookies.remove({ url, name }, (details) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(details);
      }
    });
  });
}

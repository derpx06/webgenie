import { getDomain } from 'tldts';

/**
 * Checks if a URL is allowed based on firewall configuration
 * @param url The URL to check
 * @param allowList The allow list
 * @param denyList The deny list
 * @returns True if the URL is allowed, false otherwise
 */
export function isUrlAllowed(url: string, allowList: string[], denyList: string[]): boolean {
  // Normalize and validate input
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return false;
  }

  const lowerCaseUrl = trimmedUrl.toLowerCase();

  // ALWAYS block dangerous/forbidden URLs, even if firewall is disabled
  const DANGEROUS_PREFIXES = [
    'https://chromewebstore.google.com', // scripts are not allowed to be injected into chrome web store
    'chrome-extension://',
    'chrome://',
    'javascript:',
    'data:',
    'file:',
    'vbscript:',
    'ws:',
    'wss:',
  ];

  if (DANGEROUS_PREFIXES.some(prefix => lowerCaseUrl.startsWith(prefix))) {
    return false;
  }

  // If firewall is disabled, allow all other URLs
  if (allowList.length === 0 && denyList.length === 0) {
    return true;
  }

  // Special case: Allow 'about:blank' explicitly
  if (trimmedUrl === 'about:blank') {
    return true;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);

    // 1. Remove protocol prefix for further comparisons
    const urlWithoutProtocol = lowerCaseUrl.replace(/^https?:\/\//, '');

    // 2. First check full URL against deny list
    for (const deniedEntry of denyList) {
      if (urlWithoutProtocol === deniedEntry) {
        return false;
      }
    }

    // 3. Check full URL against allow list
    for (const allowedEntry of allowList) {
      if (urlWithoutProtocol === allowedEntry) {
        return true;
      }
    }

    // 4. Extract domain for domain-based checks
    let domain = parsedUrl.hostname.toLowerCase();

    // Remove port number if present
    const portIndex = domain.indexOf(':');
    if (portIndex > -1) {
      domain = domain.substring(0, portIndex);
    }

    // 5. Check domain against deny list
    for (const deniedEntry of denyList) {
      if (domain === deniedEntry || domain.endsWith(`.${deniedEntry}`)) {
        return false;
      }
    }

    // 6. Check domain against allow list
    for (const allowedEntry of allowList) {
      if (domain === allowedEntry || domain.endsWith(`.${allowedEntry}`)) {
        return true;
      }
    }

    // Default policy
    return allowList.length === 0;
  } catch (error) {
    // Invalid URL format - deny by default
    return false;
  }
}

// Check if a URL is a new tab page (about:blank or chrome://new-tab-page).
export function isNewTabPage(url: string): boolean {
  return url === 'about:blank' || url === 'chrome://new-tab-page' || url === 'chrome://new-tab-page/';
}

export function capTextLength(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + '...';
  }
  return text;
}

/**
 * The site a host belongs to: its registrable domain on the Public Suffix List, private suffixes included, so
 * `alice.github.io` and `bob.github.io` are two sites. An IP address, localhost or a bare suffix is its own site.
 */
export function registrableDomain(host: string): string {
  const name = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return getDomain(name, { allowPrivateDomains: true }) ?? name.replace(/^www\./, '');
}

/**
 * What to tell the user when the debugger would not attach to a tab.
 *
 * The cause decides the fix, and the old message was one guess for all of them ("DevTools may be open on it"). Since
 * Chrome 155 a managed browser refuses `attach()` outright when an administrator has blocked hosts for this
 * extension or restricted screenshots, and no setting the user can reach changes that — telling them to close
 * DevTools sends them looking in the wrong place. `runtime_allowed_hosts` does not lift it either; Chrome treats it as
 * all or nothing because origin filtering cannot safely limit CDP.
 */
export function explainAttachFailure(raw: string): string {
  if (/host access is restricted by policy/i.test(raw)) {
    return "This browser's administrator has blocked this extension's access to sites (the ExtensionSettings runtime_blocked_hosts policy). WebGenie cannot control any page while that policy applies; it needs the policy removed or this extension exempted by whoever manages the browser.";
  }
  if (/screenshot capture is restricted by policy/i.test(raw)) {
    return "This browser's administrator has restricted screen capture (DisableScreenshots or a data-loss-prevention rule), and Chrome applies that to every debugger session. WebGenie cannot control any page while it applies; it needs the restriction lifted for this extension by whoever manages the browser.";
  }
  if (/another debugger is already attached/i.test(raw)) {
    return `Another tool is controlling this tab, either DevTools or another extension. Close it, or use a different tab. (${raw})`;
  }
  return `Cannot control this tab: ${raw}`;
}

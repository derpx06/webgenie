import fs from 'node:fs';
import deepmerge from 'deepmerge';

const packageJson = JSON.parse(fs.readFileSync('../package.json', 'utf8'));

const isFirefox = process.env.__FIREFOX__ === 'true';
const isOpera = process.env.__OPERA__ === 'true';

/**
 * If you want to disable the sidePanel, you can delete withSidePanel function and remove the sidePanel HoC on the manifest declaration.
 *
 * ```js
 * const manifest = { // remove `withSidePanel()`
 * ```
 */
function withSidePanel(manifest) {
  // Firefox does not support sidePanel
  if (isFirefox) {
    return manifest;
  }
  return deepmerge(manifest, {
    side_panel: {
      default_path: 'side-panel/index.html',
    },
    permissions: ['sidePanel'],
  });
}

/**
 * Adds Opera sidebar support using the sidebar_action API.
 * This is compatible with Chrome extensions and won't break Chrome Web Store validation.
 */
function withOperaSidebar(manifest) {
  // Only add Opera sidebar_action if building specifically for Opera
  if (isFirefox || !isOpera) {
    return manifest;
  }

  return deepmerge(manifest, {
    sidebar_action: {
      default_panel: 'side-panel/index.html',
      default_title: 'WebGenie',
      default_icon: 'webgenie-logo.png',
    },
  });
}

/**
 * After changing, please reload the extension at `chrome://extensions`
 * @type {chrome.runtime.ManifestV3}
 */
const manifest = withOperaSidebar(
  withSidePanel({
    manifest_version: 3,
    default_locale: 'en',
    /**
     * if you want to support multiple languages, you can use the following reference
     * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization
     */
    name: '__MSG_app_metadata_name__',
    version: packageJson.version,
    description: '__MSG_app_metadata_description__',
    host_permissions: ['<all_urls>'],
    /**
     * What the product is, and nothing it does not use.
     *
     * `debugger` and `<all_urls>` are the product: perception is the accessibility tree read over CDP, and the agent
     * works on whatever site the user is on. Both are declared plainly and justified in the listing.
     *
     * Removed: `activeTab`, which grants nothing beyond the `<all_urls>` host permission already held, and `alarms`,
     * which had no caller anywhere in the tree. Both are the shape a reviewer rejects as excessive.
     */
    permissions: [
      'storage',
      'unlimitedStorage',
      'scripting',
      'tabs',
      'tabGroups',
      'webNavigation',
      'debugger',
      'offscreen',
      'contextMenus',
    ],
    /**
     * Permissions for the browser-data tools, which are off by default.
     *
     * They are requested when the user turns those tools on, which is also the only moment there is a user gesture to
     * request them from. Declaring them at install meant a new user was asked, at install, for their bookmarks,
     * history, downloads and open sessions in order to run a browsing agent — unrelated functionality bundled into
     * one consent, which is exactly what the single-purpose rule prohibits.
     *
     * `system.memory` is new here: `manage_system` has always called it and no manifest ever declared it, so that
     * tool threw at runtime.
     */
    optional_permissions: [
      'bookmarks',
      'readingList',
      'history',
      'downloads',
      'browsingData',
      'sessions',
      'management',
      'system.cpu',
      'system.memory',
    ],
    /** `offscreen`, `sidePanel` and `readingList` all need it; `getContexts` wants it too. */
    minimum_chrome_version: '120',
    omnibox: {
      keyword: 'genie',
    },
    options_page: 'options/index.html',
    background: {
      service_worker: 'background.iife.js',
      type: 'module',
    },
    // Square, at the four sizes the store and the toolbar ask for. One 2400x1704 image used to serve all four, which
    // the store rejects as non-square, and it shipped twice (5.5 MB of a 9.1 MB package). The two small sizes are a
    // tighter crop on the lamp's globe: the whole lamp with its smoke plume is unreadable at 16px.
    action: {
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        128: 'icon-128.png',
      },
    },
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    content_scripts: [
      {
        // `<all_urls>` alongside the two schemes was redundant, and it pulled in file:// and ftp:// as well.
        matches: ['http://*/*', 'https://*/*'],
        all_frames: true,
        js: ['content/index.iife.js'],
      },
    ],
    /**
     * Nothing. There is deliberately no `web_accessible_resources` block.
     *
     * It used to expose every script, stylesheet and svg, the logo and the permission page to every http and https
     * page — which is to say the
     * whole service-worker bundle was fetchable by any page on the web, at a fixed URL, so any site could both
     * fingerprint the install and read the code. Nothing needed it: the logo is loaded from extension pages, which
     * may always read their own resources, the content script fetches nothing, and the microphone permission page is
     * an extension tab. The closed default is the right one.
     */
  }),
);

export default manifest;

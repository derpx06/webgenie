/**
 * chromium-apis — Chromium extension APIs used by the agent, plus page perception over CDP
 * (ax-tree-extractor.ts: the accessibility tree of every frame, read through puppeteer's sessions).
 */

export { getAXTreeState } from './ax-tree-extractor';
export type { AXNode } from './ax-tree-extractor';

// ── Scripting Tools ───────────────────────────────────────────────────────────
export {
  executeInMainWorld,
  executeInIsolatedWorld,
  executeInAllFrames,
  getReactComponentState,
  isFormValid,
  extractPageText,
  extractPageLinks,
  getLocalStorageItem,
  getInputValue,
  injectCSS,
  removeCSS,
  highlightElement,
  disableAnimations,
} from './scripting-tools';

// ── Navigation Tools ──────────────────────────────────────────────────────────
export {
  getAllFrames,
  getFrameTree,
  findFramesByUrl,
  getCrossOriginFrames,
  waitForNavigation,
  waitForSPANavigation,
  getFrameInfo,
  detectSPAFramework,
} from './navigation-tools';
export type { FrameInfo, FrameTreeNode } from './navigation-tools';

// ── Storage Session Tools ─────────────────────────────────────────────────────
export {
  sessionSet,
  sessionGet,
  sessionGetOrDefault,
  sessionRemove,
  sessionClear,
  sessionGetAllKeys,
  createTaskStore,
  recordSelectorSuccess,
  recordSelectorFailure,
  getSelectorReliability,
  writeScratchpad,
  readScratchpad,
  clearScratchpad,
  allowContentScriptAccess,
} from './storage-session-tools';

// ── Tab Group Tools ───────────────────────────────────────────────────────────
export {
  getAllGroups,
  getGroupsInWindow,
  findGroupByTitle,
  groupTabs,
  addTabsToGroup,
  renameGroup,
  recolorGroup,
  collapseGroup,
  expandGroup,
  ungroupTabs,
  createAgentWorkspaceGroup,
  getTabGroup,
  moveGroupToEnd,
} from './tab-group-tools';
export type { TabGroupInfo, GroupColor } from './tab-group-tools';

// ── User Activity Tools ───────────────────────────────────────────────────────
export { getFlatBookmarks, searchBookmarks, createBookmark } from './bookmarks';
export type { BookmarkItem } from './bookmarks';

export { queryReadingList, getUnreadReadingList, addReadingListItem, markReadingListItemAsRead } from './reading-list';

export { getRecentHistory, getFrequentHistoryDomains } from './history';
export type { HistoryInsight } from './history';

export { downloadFile, searchDownloads } from './downloads';

export { getRecentlyClosedSessions, restoreSession, getSyncedDevices } from './sessions';

export { getTopSites } from './top-sites';

export { getCookie, getAllCookies, setCookie, removeCookie } from './cookies';


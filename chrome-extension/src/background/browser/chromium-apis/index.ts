/**
 * chromium-apis — Complete Chromium Extension API toolkit.
 *
 * All tools are standalone and independently integrable into the agent pipeline.
 * None break or modify the existing agent behaviour — they are additive only.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * TOOL INVENTORY (by file)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * cdp-bridge.ts          — chrome.debugger CDP wrapper (permission: "debugger" ✅)
 *   Domains: Accessibility, DOM, Input, Runtime, Page, Emulation, Storage, Security
 *   Key methods: getFullAXTree, getBoxModel, cdpClick, cdpInsertText, cdpKeyPress,
 *                evaluate, captureFullPageScreenshot, searchDOM, setDOMAttribute,
 *                scrollIntoView, overrideGeolocation, overrideTimezone,
 *                emulateMobileDevice, clearOriginStorage, bypassSSLErrors
 *
 * ax-tree-extractor.ts   — CDP Accessibility tree → DOMState (permission: "debugger" ✅)
 *   Replaces injected DOM script with semantic AXTree. Pierces Shadow DOM + iframes.
 *   Key: getClickableElementsViaCDP()
 *
 * tab-tools.ts           — chrome.tabs full surface (permissions: "tabs", "activeTab" ✅)
 *   Key methods: captureTabScreenshot, createRollbackSnapshot, setTabZoom,
 *                tabGoBack, tabGoForward, createTab, navigateTab, closeTab,
 *                discardTab, activateTab, sendMessageToTab, waitForTabLoad
 *
 * scripting-tools.ts     — chrome.scripting injection (permission: "scripting" ✅)
 *   Key methods: executeInMainWorld, executeInIsolatedWorld, executeInAllFrames,
 *                getReactComponentState, isFormValid, extractPageText, extractPageLinks,
 *                getLocalStorageItem, getInputValue, injectCSS, removeCSS,
 *                highlightElement, disableAnimations
 *
 * navigation-tools.ts    — chrome.webNavigation events (permission: "webNavigation" ✅)
 *   Key methods: getAllFrames, getFrameTree, findFramesByUrl, getCrossOriginFrames,
 *                waitForNavigation, waitForSPANavigation, detectSPAFramework
 *
 * storage-session-tools.ts — chrome.storage.session (permission: "storage" ✅)
 *   Key methods: sessionSet, sessionGet, sessionGetOrDefault, createTaskStore,
 *                recordSelectorSuccess, getSelectorReliability,
 *                writeScratchpad, readScratchpad, allowContentScriptAccess
 *
 * tab-group-tools.ts     — chrome.tabGroups (permissions: "tabGroups", "tabs" ✅)
 *   Key methods: getAllGroups, groupTabs, addTabsToGroup, renameGroup, collapseGroup,
 *                expandGroup, createAgentWorkspaceGroup, getTabGroup
 *
 * built-in-ai-tools.ts   — Chrome AI APIs / Gemini Nano (no permission needed, Chrome 138+)
 *   Key methods: checkBuiltInAIAvailability, promptLocalAI, compactStepsLocally,
 *                summarizeText, detectLanguage, isEnglish, translateText,
 *                writeContent, rewriteContent
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * INTEGRATION ROADMAP
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Phase 1 — CDP Bridge  →  browser/page.ts  (expose cdpBridge.send alongside Puppeteer)
 * Phase 2 — AXTree      →  browser/page.ts _updateState()  (replace getClickableElements)
 * Phase 3 — CDP Input   →  agent/actions/handlers/interaction.ts  (replace .click())
 * Phase 4 — Tab Tools   →  agent/agents/navigator.ts  (rollback before risky actions)
 * Phase 5 — Session Mem →  agent/messages/service.ts  (replace in-memory MessageManager)
 * Phase 6 — Scripting   →  agent/actions/handlers/content.ts  (MAIN world extraction)
 * Phase 7 — Built-in AI →  agent/messages/service.ts  (local step compaction)
 */

// ── CDP Bridge + AXTree ───────────────────────────────────────────────────────
export { cdpBridge, CDPBridge } from './cdp-bridge';
export type { AXNode, BoxModel } from './cdp-bridge';

export { getClickableElementsViaCDP } from './ax-tree-extractor';

// ── Tab Tools ─────────────────────────────────────────────────────────────────
export {
  captureTabScreenshot,
  createRollbackSnapshot,
  setTabZoom,
  getTabZoom,
  resetTabZoom,
  tabGoBack,
  tabGoForward,
  getTabInfo,
  queryTabs,
  createTab,
  navigateTab,
  closeTab,
  discardTab,
  activateTab,
  sendMessageToTab,
  isTabLoaded,
  waitForTabLoad,
  isTabAudible,
} from './tab-tools';
export type { ScreenshotResult, RollbackHandle, TabInfo } from './tab-tools';

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

// ── Chrome Built-in AI Tools ──────────────────────────────────────────────────
export {
  checkBuiltInAIAvailability,
  isBuiltInAIAvailable,
  promptLocalAI,
  compactStepsLocally,
  summarizeText,
  detectLanguage,
  isEnglish,
  translateText,
  writeContent,
  rewriteContent,
} from './built-in-ai-tools';
export type {
  AIAvailability,
  LanguageDetectionResult,
  SummaryType,
  SummaryFormat,
  SummaryLength,
} from './built-in-ai-tools';

/**
 * chromium-apis — Barrel export for all Phase 1–5 Chromium API tools.
 *
 * Each module is standalone and independently integrable.
 * None of these are wired into the main pipeline yet.
 *
 * Integration roadmap:
 *
 *   Phase 1 — CDP Bridge (cdp-bridge.ts)
 *     Wires into: browser/page.ts — expose getCDPSession() as cdpBridge.send()
 *
 *   Phase 2 — AX Tree Extractor (ax-tree-extractor.ts)
 *     Wires into: browser/page.ts _updateState() — replaces getClickableElements()
 *
 *   Phase 3 — OS-Level Input (cdp-bridge.ts cdpClick / cdpInsertText)
 *     Wires into: agent/actions/handlers/interaction.ts handleClickElement()
 *
 *   Phase 4 — Network Watcher (network-watcher.ts)
 *     Wires into: agent/agents/navigator.ts doMultiAction() — pre/post action
 *
 *   Phase 5 — Session Memory (future: session-memory.ts)
 *     Wires into: agent/messages/service.ts MessageManager
 */

export { cdpBridge, CDPBridge } from './cdp-bridge';
export type { AXNode, BoxModel } from './cdp-bridge';

export { getClickableElementsViaCDP } from './ax-tree-extractor';

export { watchNextNonGetRequest, monitorRequestsDuring } from './network-watcher';
export type { NetworkResult } from './network-watcher';

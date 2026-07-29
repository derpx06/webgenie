import { ActionResult } from '../types';
import type { DOMElementNode } from '../../browser/dom/views';
import type { BrowserState } from '../../browser/views';
import type { BrowserObservation, Retryability, TargetFingerprint, ValidationEvidence, ValidationStatus } from './types';
import { ensureBrowserObservation, fingerprintFailureKey } from './observation';

export interface NormalizedIndexedAction {
  ok: boolean;
  actionResult?: ActionResult;
  targetFingerprint?: TargetFingerprint;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function normalizeIndexedAction(
  actionName: string,
  actionArgs: unknown,
  observation: BrowserObservation,
): NormalizedIndexedAction {
  if (!isObject(actionArgs) || typeof actionArgs.index !== 'number') {
    return { ok: true };
  }

  const suppliedTarget = actionTargetFingerprint(actionArgs);
  if (suppliedTarget?.actionType && suppliedTarget.actionType !== actionName) {
    return {
      ok: false,
      actionResult: new ActionResult({
        executed: false,
        executionStatus: 'not_attempted',
        validated: 'unknown',
        retryability: 'retry_reobserve',
        failureReason: `Target fingerprint belongs to ${suppliedTarget.actionType}, not ${actionName}`,
        extractedContent: 'The selected target metadata belongs to a different action; re-observe before acting.',
        includeInMemory: true,
        observationId: observation.id,
      }),
    };
  }

  // Numeric indexes are presentation labels, not stable element identities. If
  // the model supplied a fingerprint, use it to remap a reused index before
  // stamping the action with the current observation.
  const target = suppliedTarget
    ? observation.targets.find(candidate => targetIdentityMatches(suppliedTarget, candidate))
    : observation.targets.find(candidate => candidate.index === actionArgs.index);
  if (!target) {
    return {
      ok: false,
      actionResult: new ActionResult({
        executed: false,
        executionStatus: 'not_attempted',
        validated: 'unknown',
        retryability: 'retry_reobserve',
        failureReason: suppliedTarget
          ? `Target fingerprint for element index ${actionArgs.index} is not present in observation ${observation.id}`
          : `Element index ${actionArgs.index} is not present in observation ${observation.id}`,
        extractedContent: suppliedTarget
          ? 'The page changed and the previously selected target is no longer present; re-observe before acting.'
          : `Element index ${actionArgs.index} is stale; re-observe before acting.`,
        includeInMemory: true,
        observationId: observation.id,
      }),
    };
  }

  const stampedTarget = { ...target, actionType: actionName };
  const staleObservation = typeof actionArgs.observationId === 'string' && actionArgs.observationId !== observation.id;
  if (staleObservation && suppliedTarget && !sameTargetFingerprint(suppliedTarget, stampedTarget)) {
    return {
      ok: false,
      actionResult: new ActionResult({
        executed: false,
        executionStatus: 'not_attempted',
        validated: 'unknown',
        retryability: 'retry_reobserve',
        failureReason: `Stale observation id ${actionArgs.observationId}; current target was not confirmed in observation ${observation.id}`,
        extractedContent: 'The selected browser observation is stale; re-observe before acting.',
        includeInMemory: true,
        observationId: observation.id,
        targetFingerprint: stampedTarget,
      }),
    };
  }

  // Keep the action arguments aligned with the remapped target so handlers and
  // postcondition validation resolve the same element.
  actionArgs.index = target.index;
  actionArgs.observationId = observation.id;
  actionArgs.targetFingerprint = stampedTarget;
  return { ok: true, targetFingerprint: stampedTarget };
}

function evidence(kind: ValidationEvidence['kind'], passed: boolean, message: string, before?: unknown, after?: unknown): ValidationEvidence {
  return { kind, passed, message, before, after };
}

function cloneWithValidation(
  result: ActionResult,
  validated: ValidationStatus,
  retryability: Retryability,
  validationEvidence: ValidationEvidence[],
  failureReason: string | null = null,
): ActionResult {
  return new ActionResult({
    ...result,
    validated,
    retryability,
    evidence: [...(result.evidence ?? []), ...validationEvidence],
    failureReason,
  });
}

function tabIds(state: BrowserState): Set<number> {
  return new Set(state.tabs.map(tab => tab.id));
}

function hasNewTab(before: BrowserState, after: BrowserState): boolean {
  const beforeIds = tabIds(before);
  return after.tabs.some(tab => !beforeIds.has(tab.id));
}

function activeTabUrl(state: BrowserState): string {
  return state.tabs.find(tab => tab.id === state.tabId)?.url ?? state.url;
}

function sameDocument(before: BrowserState, after: BrowserState): boolean {
  const beforeObservation = ensureBrowserObservation(before);
  const afterObservation = ensureBrowserObservation(after);
  return beforeObservation.documentFingerprint === afterObservation.documentFingerprint;
}

function sameLayout(before: BrowserState, after: BrowserState): boolean {
  const beforeObservation = ensureBrowserObservation(before);
  const afterObservation = ensureBrowserObservation(after);
  return beforeObservation.layoutFingerprint === afterObservation.layoutFingerprint;
}

function targetValue(state: BrowserState, index: number, targetFingerprint?: TargetFingerprint | null): string | undefined {
  const node = findTargetNode(state, index, targetFingerprint);
  if (!node) return undefined;
  return node.attributes.value ?? node.attributes['data-value'] ?? node.attributes['aria-valuetext'];
}

function selectedValue(state: BrowserState, index: number, targetFingerprint?: TargetFingerprint | null): string | undefined {
  const node = findTargetNode(state, index, targetFingerprint);
  if (!node) return undefined;
  return node.attributes.value ?? node.attributes['data-value'] ?? node.attributes['aria-label'];
}

function targetState(state: BrowserState, index: number, targetFingerprint?: TargetFingerprint | null): string {
  const node = findTargetNode(state, index, targetFingerprint);
  if (!node) return '';
  const attrs = node.attributes ?? {};
  return [
    attrs['aria-label'],
    attrs['aria-description'],
    attrs['aria-pressed'],
    attrs['aria-expanded'],
    attrs['aria-selected'],
    attrs['aria-current'],
    attrs['data-state'],
    attrs['data-value'],
    attrs.value,
    attrs.title,
    node.getAllTextTillNextClickableElement(1),
  ].filter(value => typeof value === 'string' && value.trim()).join(' | ').trim();
}

function fingerprintMatchesNode(node: DOMElementNode, target: TargetFingerprint): boolean {
  const attributes = node.attributes ?? {};
  const accessibleName = attributes['aria-label'] ?? attributes.title ?? attributes.placeholder;
  const stableMatches = [
    target.backendNodeId != null && node.backendNodeId === target.backendNodeId,
    Boolean(target.xpath && node.xpath === target.xpath),
    Boolean(target.cssSelector && node.getEnhancedCssSelector?.() === target.cssSelector),
    Boolean(target.role && attributes.role === target.role && target.accessibleName && accessibleName === target.accessibleName),
  ];
  return stableMatches.some(Boolean);
}

function targetIdentityMatches(a: TargetFingerprint, b: TargetFingerprint): boolean {
  if (a.tabId !== undefined && b.tabId !== undefined && a.tabId !== b.tabId) return false;
  if (a.frameId && b.frameId && a.frameId !== b.frameId) return false;

  // When the model provides more than one stable identity, conflicting values
  // are evidence of a stale target rather than an alternative match. This is
  // intentionally conservative: acting on the wrong element is worse than
  // asking the model to observe again.
  if (a.backendNodeId != null && b.backendNodeId != null && a.backendNodeId !== b.backendNodeId) return false;
  if (a.xpath && b.xpath && a.xpath !== b.xpath) return false;
  if (a.cssSelector && b.cssSelector && a.cssSelector !== b.cssSelector) return false;
  if (a.role && b.role && a.accessibleName && b.accessibleName &&
    (a.role !== b.role || a.accessibleName !== b.accessibleName)) return false;

  return Boolean(
    (a.backendNodeId != null && b.backendNodeId != null && a.backendNodeId === b.backendNodeId) ||
    (a.xpath && b.xpath && a.xpath === b.xpath) ||
    (a.cssSelector && b.cssSelector && a.cssSelector === b.cssSelector) ||
    (a.role && b.role && a.accessibleName && b.accessibleName &&
      a.role === b.role && a.accessibleName === b.accessibleName &&
      (!a.tagName || !b.tagName || a.tagName === b.tagName))
  );
}

function findTargetNode(
  state: BrowserState,
  index: number,
  targetFingerprint?: TargetFingerprint | null,
): DOMElementNode | undefined {
  const direct = state.selectorMap.get(index);
  if (direct && (!targetFingerprint || fingerprintMatchesNode(direct, targetFingerprint))) return direct;
  if (!targetFingerprint) return undefined;
  return Array.from(state.selectorMap.values()).find(node => fingerprintMatchesNode(node, targetFingerprint));
}

function hasAuthBlocker(state: BrowserState): boolean {
  const blockerPattern = /\b(sign in to continue|log in to continue|login to continue|authentication required|permission required|authorize to continue|verify your identity|verification required|two-factor|2fa|captcha)\b/i;

  return Array.from(state.selectorMap.values()).some(node => {
    if (node.isVisible === false) return false;
    const attrs = node.attributes ?? {};
    const text = targetState(state, node.highlightIndex ?? -1);
    const isDialog = attrs.role === 'dialog' || attrs['aria-modal'] === 'true';
    return blockerPattern.test(text) || (isDialog && /\b(sign in|log in|login|password|passcode|authorize|authentication|verify)\b/i.test(text));
  });
}

function actionTargetFingerprint(actionArgs: unknown): TargetFingerprint | null {
  if (!isObject(actionArgs)) return null;
  const target = actionArgs.targetFingerprint;
  return target && typeof target === 'object' ? target as TargetFingerprint : null;
}

function sameTargetFingerprint(a: TargetFingerprint | null, b: TargetFingerprint | null): boolean {
  if (!a || !b) return false;
  return a.actionType === b.actionType && targetIdentityMatches(a, b);
}

function isStaleElementError(message: string): boolean {
  return /element (with index \d+ )?(is )?(no longer available|does not exist|not present|stale)/i.test(message);
}

export function shouldBlockRepeatedAction(input: {
  actionName: string;
  actionArgs: unknown;
  contractId: string | null;
  recentResults: ActionResult[];
  maxAttempts?: number;
}): boolean {
  const currentTarget = actionTargetFingerprint(input.actionArgs);
  if (!currentTarget || !input.contractId) return false;
  const maxAttempts = input.maxAttempts ?? 1;
  const matchingAttempts = input.recentResults.filter(result =>
    result.executed &&
    result.contractId === input.contractId &&
    result.validated !== 'passed' &&
    sameTargetFingerprint(result.targetFingerprint, currentTarget) &&
    result.targetFingerprint?.actionType === input.actionName
  );
  return matchingAttempts.length >= maxAttempts;
}

function scrollBoundary(state: BrowserState, direction: 'top' | 'bottom'): boolean {
  if (direction === 'top') return state.scrollY <= 0;
  const maxScroll = Math.max(0, state.scrollHeight - state.visualViewportHeight);
  return state.scrollY >= maxScroll - 2;
}

export function hasActionPostconditionSatisfied(input: {
  actionName: string;
  actionArgs: unknown;
  before: BrowserState;
  after: BrowserState;
}): boolean {
  const { actionName, actionArgs, before, after } = input;
  const args = isObject(actionArgs) ? actionArgs : {};
  const index = typeof args.index === 'number' ? args.index : undefined;
  const urlChanged = before.url !== after.url || activeTabUrl(before) !== activeTabUrl(after);
  const docChanged = !sameDocument(before, after);
  const layoutChanged = !sameLayout(before, after);
  const openedNewTab = hasNewTab(before, after);

  if (['go_to_url', 'search_web', 'search_google', 'go_back'].includes(actionName)) {
    return urlChanged || docChanged;
  }
  if (actionName === 'open_tab') return openedNewTab || before.tabId !== after.tabId;
  if (actionName === 'switch_tab') return typeof args.tab_id === 'number' && after.tabId === args.tab_id;
  if (actionName === 'close_tab') return typeof args.tab_id === 'number' && !after.tabs.some(tab => tab.id === args.tab_id);
  if (actionName === 'input_text' && index !== undefined) {
    return targetValue(after, index, actionTargetFingerprint(actionArgs)) === args.text;
  }
  if (actionName === 'select_dropdown_option' && index !== undefined) {
    const selected = selectedValue(after, index, actionTargetFingerprint(actionArgs));
    return selected === args.text;
  }
  if (['scroll_to_percent', 'scroll_to_top', 'scroll_to_bottom', 'next_page', 'previous_page'].includes(actionName)) {
    const delta = after.scrollY - before.scrollY;
    const boundary =
      actionName === 'scroll_to_top' || actionName === 'previous_page'
        ? scrollBoundary(after, 'top')
        : actionName === 'scroll_to_bottom' || actionName === 'next_page'
          ? scrollBoundary(after, 'bottom')
          : false;
    return delta !== 0 || boundary;
  }
  if (['click_element', 'hover_element', 'right_click_element'].includes(actionName)) {
    if (urlChanged || docChanged || layoutChanged || openedNewTab || hasAuthBlocker(after)) return true;
    if (index === undefined) return false;
    const targetFingerprint = actionTargetFingerprint(actionArgs);
    const beforeTargetState = targetState(before, index, targetFingerprint);
    const afterTargetState = targetState(after, index, targetFingerprint);
    return Boolean(beforeTargetState && afterTargetState && beforeTargetState !== afterTargetState);
  }
  return true;
}

export interface ValidateActionOutcomeInput {
  actionName: string;
  actionArgs: unknown;
  before: BrowserState;
  after: BrowserState;
  result: ActionResult;
  recentResults?: ActionResult[];
}

export function isMutatingAction(actionName: string): boolean {
  return [
    'go_to_url',
    'search_web',
    'search_google',
    'go_back',
    'open_tab',
    'switch_tab',
    'close_tab',
    'click_element',
    'hover_element',
    'right_click_element',
    'input_text',
    'select_dropdown_option',
    'scroll_to_percent',
    'scroll_to_top',
    'scroll_to_bottom',
    'next_page',
    'previous_page',
    'done',
  ].includes(actionName);
}

export function validateActionOutcome(input: ValidateActionOutcomeInput): ActionResult {
  const { actionName, actionArgs, before, after, result, recentResults = [] } = input;

  if (result.error) {
    const staleElement = isStaleElementError(result.error);
    return cloneWithValidation(
      result,
      'failed',
      staleElement ? 'replan' : 'retry_reobserve',
      [evidence('error', false, result.error)],
      staleElement
        ? `${result.error}. The DOM changed after this index was selected; re-observe and choose a current target instead of retrying the same index.`
        : result.error,
    );
  }

  if (!isMutatingAction(actionName)) {
    return cloneWithValidation(result, 'not_applicable', 'none', []);
  }

  const args = isObject(actionArgs) ? actionArgs : {};
  const index = typeof args.index === 'number' ? args.index : undefined;
  const urlChanged = before.url !== after.url || activeTabUrl(before) !== activeTabUrl(after);
  const docChanged = !sameDocument(before, after);
  const layoutChanged = !sameLayout(before, after);
  const openedNewTab = hasNewTab(before, after);

  if (['go_to_url', 'search_web', 'search_google', 'go_back'].includes(actionName)) {
    const passed = urlChanged || docChanged;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [
        evidence('url_change', passed, passed ? 'Navigation changed the active URL.' : 'Navigation did not change the active URL.', before.url, after.url),
        evidence('document_change', docChanged, docChanged ? 'Navigation changed the document fingerprint.' : 'Document fingerprint did not change.'),
      ],
      passed ? null : 'Navigation produced no observable URL or document change.',
    );
  }

  if (actionName === 'open_tab') {
    const passed = openedNewTab || before.tabId !== after.tabId;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [evidence('new_tab', passed, passed ? 'A new tab or active tab transition was observed.' : 'No new tab or active tab transition was observed.')],
      passed ? null : 'Open-tab action did not create or activate a tab.',
    );
  }

  if (actionName === 'switch_tab') {
    const expected = typeof args.tab_id === 'number' ? args.tab_id : undefined;
    const passed = expected !== undefined && after.tabId === expected;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [evidence('active_tab', passed, passed ? 'Requested tab is active.' : 'Requested tab is not active.', before.tabId, after.tabId)],
      passed ? null : 'Switch-tab action did not activate the requested tab.',
    );
  }

  if (actionName === 'close_tab') {
    const expected = typeof args.tab_id === 'number' ? args.tab_id : undefined;
    const passed = expected !== undefined && !after.tabs.some(tab => tab.id === expected);
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [evidence('active_tab', passed, passed ? 'Requested tab is closed.' : 'Requested tab still exists.')],
      passed ? null : 'Close-tab action did not close the requested tab.',
    );
  }

  if (actionName === 'input_text' && index !== undefined) {
    const actual = targetValue(after, index, actionTargetFingerprint(actionArgs));
    const expected = typeof args.text === 'string' ? args.text : undefined;
    const passed = expected !== undefined && actual === expected;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_same',
      [evidence('target_value', passed, passed ? 'Input value read-back matched requested text.' : 'Input value read-back did not match requested text.', expected, actual)],
      passed ? null : 'Input read-back did not match requested text.',
    );
  }

  if (actionName === 'select_dropdown_option' && index !== undefined) {
    const actual = selectedValue(after, index, actionTargetFingerprint(actionArgs));
    const expected = typeof args.text === 'string' ? args.text : undefined;
    const passed = expected !== undefined && (actual === expected || result.extractedContent?.includes(`"${expected}"`) === true);
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_same',
      [evidence('selection', passed, passed ? 'Dropdown selection was verified.' : 'Dropdown selection read-back did not match requested option.', expected, actual)],
      passed ? null : 'Dropdown selection did not match requested option.',
    );
  }

  if (['scroll_to_percent', 'scroll_to_top', 'scroll_to_bottom', 'next_page', 'previous_page'].includes(actionName)) {
    const delta = after.scrollY - before.scrollY;
    const boundary =
      actionName === 'scroll_to_top' || actionName === 'previous_page'
        ? scrollBoundary(after, 'top')
        : actionName === 'scroll_to_bottom' || actionName === 'next_page'
          ? scrollBoundary(after, 'bottom')
          : false;
    const passed = delta !== 0 || boundary;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [
        evidence('scroll_delta', delta !== 0, delta !== 0 ? 'Scroll position changed.' : 'Scroll position did not change.', before.scrollY, after.scrollY),
        evidence('scroll_boundary', boundary, boundary ? 'Requested scroll boundary is verified.' : 'Requested scroll boundary was not verified.'),
      ],
      passed ? null : 'Scroll produced no delta and no verified boundary.',
    );
  }

  if (['click_element', 'hover_element', 'right_click_element'].includes(actionName)) {
    const observableChange = urlChanged || docChanged || layoutChanged || openedNewTab;
    if (actionName === 'click_element' && hasAuthBlocker(after)) {
      return cloneWithValidation(
        new ActionResult({
          ...result,
          isWaitingForHuman: true,
          includeInMemory: true,
          extractedContent: result.extractedContent ?? 'Action reached an authentication or permission blocker.',
        }),
        'unknown',
        'ask_human',
        [evidence('auth_blocker', true, 'Authentication, verification, or permission blocker is visible after the click.')],
        'Action requires human authentication or permission.',
      );
    }
  if (actionName === 'click_element' && index !== undefined) {
      const targetFingerprint = actionTargetFingerprint(actionArgs);
      const beforeTargetState = targetState(before, index, targetFingerprint);
      const afterTargetState = targetState(after, index, targetFingerprint);
      if (beforeTargetState && afterTargetState && beforeTargetState !== afterTargetState) {
        return cloneWithValidation(
          result,
          'passed',
          'none',
          [evidence('target_state', true, 'Selected target state changed after the click.', beforeTargetState, afterTargetState)],
        );
      }
    }
    if (observableChange) {
      return cloneWithValidation(
        result,
        'passed',
        'none',
        [
          evidence('url_change', urlChanged, urlChanged ? 'Action changed URL.' : 'URL did not change.', before.url, after.url),
          evidence('document_change', docChanged || layoutChanged, docChanged || layoutChanged ? 'Action changed document/layout fingerprint.' : 'Document/layout did not change.'),
          evidence('new_tab', openedNewTab, openedNewTab ? 'Action opened a new tab.' : 'No new tab opened.'),
        ],
      );
    }
    const status = actionName === 'click_element' ? 'failed' : 'unknown';
    return cloneWithValidation(
      result,
      status,
      actionName === 'click_element' ? 'replan' : 'retry_reobserve',
      [evidence('document_change', false, 'No URL, document, layout, or tab change was observed after the action.')],
      `${actionName} produced no observable postcondition.`,
    );
  }

  if (actionName === 'done') {
    const unresolved = recentResults.some(previous =>
      previous.executed && (previous.validated === 'unknown' || previous.validated === 'failed')
    );
    const success = args.success === true;
    if (!success) {
      return cloneWithValidation(
        result,
        'passed',
        'none',
        [evidence('done_blocked', true, 'Done reports an explicit unsuccessful or blocked final state.')],
      );
    }
    const hasSupport = recentResults.some(previous => previous.validated === 'passed');
    const passed = !unresolved && hasSupport;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'replan',
      [evidence('done_supported', passed, passed ? 'Done is supported by recent validated evidence.' : 'Done lacks recent successful validated evidence or has unresolved failures.')],
      passed ? null : 'Done cannot be accepted without validated success evidence.',
    );
  }

  return cloneWithValidation(result, 'not_applicable', 'none', []);
}

export function shouldStopAfterValidation(result: ActionResult, actionName: string): boolean {
  return isMutatingAction(actionName) && (result.validated === 'failed' || result.validated === 'unknown');
}

export { fingerprintFailureKey };

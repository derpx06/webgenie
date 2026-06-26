import { ActionResult } from '../types';
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

  const target = observation.targets.find(candidate => candidate.index === actionArgs.index);
  if (!target) {
    return {
      ok: false,
      actionResult: new ActionResult({
        executed: false,
        executionStatus: 'not_attempted',
        validated: 'unknown',
        retryability: 'retry_reobserve',
        failureReason: `Element index ${actionArgs.index} is not present in observation ${observation.id}`,
        extractedContent: `Element index ${actionArgs.index} is stale; re-observe before acting.`,
        includeInMemory: true,
        observationId: observation.id,
      }),
    };
  }

  if (typeof actionArgs.observationId === 'string' && actionArgs.observationId !== observation.id) {
    return {
      ok: false,
      actionResult: new ActionResult({
        executed: false,
        executionStatus: 'not_attempted',
        validated: 'unknown',
        retryability: 'retry_reobserve',
        failureReason: `Stale observation id ${actionArgs.observationId}; current observation is ${observation.id}`,
        extractedContent: 'The selected browser observation is stale; re-observe before acting.',
        includeInMemory: true,
        observationId: observation.id,
        targetFingerprint: { ...target, actionType: actionName },
      }),
    };
  }

  const stampedTarget = { ...target, actionType: actionName };
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

function targetValue(state: BrowserState, index: number): string | undefined {
  const node = state.selectorMap.get(index);
  if (!node) return undefined;
  return node.attributes.value ?? node.attributes['data-value'] ?? node.attributes['aria-valuetext'];
}

function selectedValue(state: BrowserState, index: number): string | undefined {
  const node = state.selectorMap.get(index);
  if (!node) return undefined;
  return node.attributes.value ?? node.attributes['data-value'] ?? node.attributes['aria-label'];
}

function scrollBoundary(state: BrowserState, direction: 'top' | 'bottom'): boolean {
  if (direction === 'top') return state.scrollY <= 0;
  const maxScroll = Math.max(0, state.scrollHeight - state.visualViewportHeight);
  return state.scrollY >= maxScroll - 2;
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
    return cloneWithValidation(
      result,
      'failed',
      'retry_reobserve',
      [evidence('error', false, result.error)],
      result.error,
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
    const actual = targetValue(after, index);
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
    const actual = selectedValue(after, index);
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

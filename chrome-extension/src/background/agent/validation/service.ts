import { ActionResult } from '../types';
import type { DOMElementNode } from '../../browser/dom/views';
import type { BrowserState } from '../../browser/views';
import type { BrowserObservation, Retryability, TargetFingerprint, ValidationEvidence, ValidationStatus } from './types';
import { ensureBrowserObservation } from './observation';

export interface NormalizedIndexedAction {
  ok: boolean;
  actionResult?: ActionResult;
  targetFingerprint?: TargetFingerprint;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Stamps an indexed action with the observation it was chosen from. An index missing from that observation is stale. */
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
        failureReason: `Element index ${actionArgs.index} is not on the current page; re-observe before acting.`,
        extractedContent: `Element index ${actionArgs.index} is stale; re-observe before acting.`,
        includeInMemory: true,
        observationId: observation.id,
      }),
    };
  }

  const targetFingerprint = { ...target, actionType: actionName };
  actionArgs.observationId = observation.id;
  actionArgs.targetFingerprint = targetFingerprint;
  return { ok: true, targetFingerprint };
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

function hasNewTab(before: BrowserState, after: BrowserState): boolean {
  const beforeIds = new Set(before.tabs.map(tab => tab.id));
  return after.tabs.some(tab => !beforeIds.has(tab.id));
}

function activeTabUrl(state: BrowserState): string {
  return state.tabs.find(tab => tab.id === state.tabId)?.url ?? state.url;
}

/** An empty URL (a read taken mid-navigation) is never a change. */
function urlChanged(before: BrowserState, after: BrowserState): boolean {
  const changed = (a: string, b: string) => Boolean(b) && a !== b;
  return changed(before.url, after.url) || changed(activeTabUrl(before), activeTabUrl(after));
}

function sameUrl(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || !a || !b) return false;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
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
    attrs['aria-checked'],
    attrs.checked,
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
  return [
    target.backendNodeId != null && node.backendNodeId === target.backendNodeId,
    Boolean(target.xpath && node.xpath === target.xpath),
    Boolean(target.role && attributes.role === target.role && target.accessibleName && accessibleName === target.accessibleName),
  ].some(Boolean);
}

/** The element at the index if it is still the chosen target, else the same element (by identity) wherever it moved. */
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

function actionTargetFingerprint(actionArgs: unknown): TargetFingerprint | null {
  if (!isObject(actionArgs)) return null;
  const target = actionArgs.targetFingerprint;
  return target && typeof target === 'object' ? target as TargetFingerprint : null;
}

function isStaleElementError(message: string): boolean {
  return /element (with index \d+ )?(is )?(no longer available|does not exist|not present|stale)/i.test(message);
}

const NAVIGATION_ACTIONS = ['go_to_url', 'search_web', 'search_google', 'go_back'];
const SCROLL_ACTIONS = ['scroll_to_percent', 'scroll_to_top', 'scroll_to_bottom', 'next_page', 'previous_page'];
const POINTER_ACTIONS = ['click_element', 'hover_element', 'right_click_element', 'send_keys'];
const MUTATING_ACTIONS = new Set([
  ...NAVIGATION_ACTIONS,
  ...SCROLL_ACTIONS,
  ...POINTER_ACTIONS,
  'open_tab',
  'switch_tab',
  'close_tab',
  'input_text',
  'select_dropdown_option',
]);

export interface ValidateActionOutcomeInput {
  actionName: string;
  actionArgs: unknown;
  before: BrowserState;
  after: BrowserState;
  result: ActionResult;
}

/** Actions that can change the page; they get a settle read and a validation. */
export function isMutatingAction(actionName: string): boolean {
  return MUTATING_ACTIONS.has(actionName);
}

export function validateActionOutcome(input: ValidateActionOutcomeInput): ActionResult {
  const { actionName, actionArgs, before, after, result } = input;

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
  const beforeObservation = ensureBrowserObservation(before);
  const afterObservation = ensureBrowserObservation(after);
  // A read with no URL was taken mid-navigation; nothing in it is evidence of a change.
  const readable = Boolean(after.url);
  const changedUrl = urlChanged(before, after);
  const docChanged = readable && beforeObservation.documentFingerprint !== afterObservation.documentFingerprint;
  const layoutChanged = readable && beforeObservation.layoutFingerprint !== afterObservation.layoutFingerprint;
  const openedNewTab = hasNewTab(before, after);

  if (NAVIGATION_ACTIONS.includes(actionName)) {
    const alreadyThere = actionName === 'go_to_url' && sameUrl(args.url, after.url);
    const passed = changedUrl || docChanged || alreadyThere;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [
        evidence('url_change', passed, passed ? 'The page is at the requested location.' : 'Navigation did not change the active URL.', before.url, after.url),
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
    const expected = typeof args.text === 'string' ? args.text : '';
    const actual = targetValue(after, index, actionTargetFingerprint(actionArgs));
    // Only lengths are kept as evidence: typed text can be a password.
    const lengths = { expectedLength: expected.length, actualLength: actual?.length ?? null };
    if (actual === undefined) {
      return cloneWithValidation(
        result,
        'unknown',
        'retry_reobserve',
        [evidence('target_value', false, 'The field value could not be read back.', lengths)],
        'The field value could not be read back; check the page before typing again.',
      );
    }
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    // Password fields read back as one mask character per typed character.
    const masked = expected.length > 0 && actual.length === expected.length && /^[•●*]+$/.test(actual);
    if (masked || normalize(actual) === normalize(expected)) {
      return cloneWithValidation(result, 'passed', 'none', [evidence('target_value', true, 'The field contains the typed text.', lengths)]);
    }
    if (!actual && expected) {
      return cloneWithValidation(
        result,
        'failed',
        'retry_reobserve',
        [evidence('target_value', false, 'The field is still empty after typing.', lengths)],
        'The field is still empty after typing.',
      );
    }
    // A different value is often the site reformatting the input (dates, phone numbers), so it is not a failure.
    return cloneWithValidation(
      result,
      'unknown',
      'retry_reobserve',
      [evidence('target_value', false, 'The field shows a different value than the typed text.', lengths)],
      `The field now shows "${actual.slice(0, 80)}"; check whether that is acceptable before typing again.`,
    );
  }

  if (actionName === 'select_dropdown_option' && index !== undefined) {
    const actual = selectedValue(after, index, actionTargetFingerprint(actionArgs));
    const expected = typeof args.text === 'string' ? args.text : undefined;
    const passed = expected !== undefined && (actual === expected || result.extractedContent?.includes(`"${expected}"`) === true);
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [evidence('selection', passed, passed ? 'Dropdown selection was verified.' : 'Dropdown selection read-back did not match requested option.', expected, actual)],
      passed ? null : 'Dropdown selection did not match requested option.',
    );
  }

  if (SCROLL_ACTIONS.includes(actionName)) {
    // Scrolling inside an element leaves the window position unchanged; only the page content can show it.
    if (index !== undefined) {
      return layoutChanged
        ? cloneWithValidation(result, 'passed', 'none', [evidence('scroll_delta', true, 'The scrolled content changed.')])
        : cloneWithValidation(
          result,
          'unknown',
          'retry_reobserve',
          [evidence('scroll_delta', false, 'No change was visible after scrolling the element.')],
          'No change was visible after scrolling the element.',
        );
    }
    const delta = after.scrollY - before.scrollY;
    const maxScroll = Math.max(0, after.scrollHeight - after.visualViewportHeight);
    const towardsTop = actionName === 'scroll_to_top' || actionName === 'previous_page';
    const towardsBottom = actionName === 'scroll_to_bottom' || actionName === 'next_page';
    const boundary = (towardsTop && after.scrollY <= 2) || (towardsBottom && after.scrollY >= maxScroll - 2);
    const atTarget =
      actionName === 'scroll_to_percent' &&
      typeof args.yPercent === 'number' &&
      Math.abs(after.scrollY - (maxScroll * args.yPercent) / 100) <= 2;
    const passed = delta !== 0 || boundary || atTarget;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [
        evidence('scroll_delta', delta !== 0, delta !== 0 ? 'Scroll position changed.' : 'Scroll position did not change.', before.scrollY, after.scrollY),
        evidence('scroll_boundary', boundary || atTarget, boundary || atTarget ? 'The page is at the requested scroll position.' : 'The requested scroll position was not reached.'),
      ],
      passed ? null : 'Scroll produced no movement and the page is not at the requested position.',
    );
  }

  if (POINTER_ACTIONS.includes(actionName)) {
    if (index !== undefined) {
      const targetFingerprint = actionTargetFingerprint(actionArgs);
      const beforeTargetState = targetState(before, index, targetFingerprint);
      const afterTargetState = targetState(after, index, targetFingerprint);
      if (beforeTargetState && afterTargetState && beforeTargetState !== afterTargetState) {
        return cloneWithValidation(
          result,
          'passed',
          'none',
          [evidence('target_state', true, 'The target element changed state.', beforeTargetState, afterTargetState)],
        );
      }
    }
    if (changedUrl || docChanged || layoutChanged || openedNewTab) {
      return cloneWithValidation(
        result,
        'passed',
        'none',
        [
          evidence('url_change', changedUrl, changedUrl ? 'Action changed URL.' : 'URL did not change.', before.url, after.url),
          evidence('document_change', docChanged || layoutChanged, docChanged || layoutChanged ? 'Action changed the page content.' : 'Page content did not change.'),
          evidence('new_tab', openedNewTab, openedNewTab ? 'Action opened a new tab.' : 'No new tab opened.'),
        ],
      );
    }
    // Many valid actions change nothing visible (focusing, closing an already closed menu); the planner decides after two.
    return cloneWithValidation(
      result,
      'unknown',
      'retry_reobserve',
      [evidence('document_change', false, 'No URL, content, element state or tab change was observed after the action.')],
      `${actionName} was sent, but the page did not visibly change. Check the page state before repeating it.`,
    );
  }

  return cloneWithValidation(result, 'not_applicable', 'none', []);
}

export function shouldStopAfterValidation(result: ActionResult, actionName: string): boolean {
  return isMutatingAction(actionName) && (result.validated === 'failed' || result.validated === 'unknown');
}

import { ActionResult } from '../types';
import type { DOMElementNode } from '../../browser/dom/views';
import type { FormCommitInfo } from '../../browser/page';
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

/**
 * Wording of a control whose activation commits money or an account change (placing an order, paying, subscribing,
 * deleting an account). English only: other languages and icon buttons rely on the model's `commits` flag and on
 * the payment-form check.
 */
const COMMIT_LABEL = /^((place|submit) (my |the |your )?order|order now|buy (it )?now|purchase( now)?$|pay( now)?( \S*\d\S*)?$|complete (purchase|order|payment|checkout)|confirm (and pay|order|purchase|payment)|submit (order and )?payment|subscribe( now)?$|start (my |your |a )?(free )?(trial|subscription)|(delete|close) (my |your )?account|transfer (funds|money)|donate( now)?$)/i;

const isCommitLabel = (text: string) => text.length <= 60 && COMMIT_LABEL.test(text.trim());

/** The element's names, each on its own: a long combined label must not hide a commit wording. */
function labelParts(node: DOMElementNode | undefined): string[] {
  if (!node) return [];
  const parts = [node.attributes['aria-label'], node.attributes.value, node.attributes.title, node.getAllTextTillNextClickableElement(2)]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map(part => part.replace(/\s+/g, ' ').trim());
  return [...new Set(parts)];
}

export interface CommitTarget {
  /** Identifies the confirmation: the same action on the same page needs the same approval. */
  key: string;
  label: string;
  /** Host and path, as shown to the user. */
  place: string;
}

const PRESSES_ENTER = /enter|return/i;

/** Whether an action presses Enter: a key press of Enter or Return, or typing with submit. */
function pressesEnter(actionName: string, args: Record<string, unknown>): boolean {
  return (actionName === 'send_keys' && PRESSES_ENTER.test(String(args.keys ?? ''))) || (actionName === 'input_text' && args.submit === true);
}

/** Whether an action could submit a form, so its form must be inspected before the gate decides. */
export function mayCommitThroughForm(actionName: string, args: Record<string, unknown>): boolean {
  return actionName === 'click_element' || pressesEnter(actionName, args);
}

/**
 * An action the user must confirm before it runs: a click or Enter that places an order, pays, subscribes or changes an
 * account (by its wording, by submitting a form that takes payment details, or because the model set `commits`), or a
 * browser tool that erases the user's data. Null for everything else.
 */
export function commitTarget(
  actionName: string,
  args: Record<string, unknown>,
  url: string,
  node?: DOMElementNode,
  form?: FormCommitInfo | null,
): CommitTarget | null {
  const commitsForm = !!form?.inForm && (form.paymentFields || form.submitLabels.some(isCommitLabel));
  const modelSaysCommit = typeof args.commits === 'string' && args.commits !== 'none';
  let label: string | undefined;
  if (actionName === 'click_element') {
    const parts = labelParts(node);
    label = parts.find(isCommitLabel);
    if (!label && ((form?.isSubmitter && commitsForm) || modelSaysCommit)) label = parts[0] ?? form?.submitLabels[0] ?? 'this button';
  } else if (actionName === 'send_keys' || actionName === 'input_text') {
    // Typing with submit presses Enter, so it is gated exactly like the key press.
    if (commitsForm && pressesEnter(actionName, args)) label = `Enter, which submits "${form?.submitLabels[0] ?? 'the form'}"`;
    else if (modelSaysCommit && actionName === 'send_keys') label = String(args.keys);
    else if (modelSaysCommit && args.submit === true) label = 'Enter after typing, which submits the form';
  } else if (actionName === 'manage_privacy' && args.action === 'clearData') {
    label = `Clear browsing data (${(args.clearTypes as string[] | undefined)?.join(', ') || 'all types'})`;
  } else if (actionName === 'manage_extensions' && args.action === 'setEnabled') {
    label = `${args.extensionEnabled ? 'Enable' : 'Disable'} extension ${String(args.extensionId ?? '')}`.trim();
  }
  if (!label) return null;
  let place = url;
  try {
    const parsed = new URL(url);
    place = `${parsed.host}${parsed.pathname}`;
  } catch {
    // not a web address: show it as it is
  }
  label = label.slice(0, 80);
  return { key: `${place}|${label.toLowerCase()}`, label, place };
}

const AMOUNT = /[$€£¥₹]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£¥₹]|\b(?:EUR|USD|GBP|INR|JPY|CHF)\b)/g;

/** The last amount of money the page shows before the element with this index (anywhere on the page without one). */
export function amountBefore(pageText: string, index?: number): string | null {
  const end = index === undefined ? -1 : pageText.indexOf(`[${index}]`);
  return (end >= 0 ? pageText.slice(0, end) : pageText).match(AMOUNT)?.at(-1)?.trim() ?? null;
}

/** The question the system asks before a commit; no model writes it, so a page cannot word it. */
export function commitQuestion(target: CommitTarget, amount: string | null): string {
  return `Confirm before I continue: "${target.label}" on ${target.place}${amount ? ` (amount shown: ${amount})` : ''}. This may place an order, make a payment, or change an account or your data. Should I do it?`;
}

const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;
const PHONE_OR_CARD = /\+?\d[\d\s().-]{5,}\d/g;
const digitsOf = (value: string) => value.replace(/\D/g, '');

/**
 * Personal values from the user's own messages that appear in an action's arguments: email addresses, and phone or card
 * numbers (7+ digits). Passwords have placeholders of their own.
 * ponytail: names and street addresses are not detected; a model check would be needed for those.
 */
export function userPersonalData(actionText: string, userText: string): string[] {
  const userEmails = new Set((userText.match(EMAIL) ?? []).map(email => email.toLowerCase()));
  const userNumbers = new Set((userText.match(PHONE_OR_CARD) ?? []).map(digitsOf).filter(digits => digits.length >= 7));
  const found = [
    ...(actionText.match(EMAIL) ?? []).filter(email => userEmails.has(email.toLowerCase())),
    ...(actionText.match(PHONE_OR_CARD) ?? []).filter(number => userNumbers.has(digitsOf(number))),
  ];
  return [...new Set(found)];
}

/**
 * Email addresses and phone or card numbers (7+ digits) in an action's arguments that appear nowhere in `knownText` (the
 * user's messages, tool results and the page): values the model made up. Numbers are compared by their digits, so a
 * reformatted value still counts as known. H6: after looking at the page the planner filled in "555-123-4567" itself.
 */
export function inventedPersonalData(actionText: string, knownText: string): string[] {
  const knownEmails = new Set((knownText.match(EMAIL) ?? []).map(email => email.toLowerCase()));
  const knownNumbers = new Set((knownText.match(PHONE_OR_CARD) ?? []).map(digitsOf));
  const invented = [
    ...(actionText.match(EMAIL) ?? []).filter(email => !knownEmails.has(email.toLowerCase())),
    ...(actionText.match(PHONE_OR_CARD) ?? []).filter(number => digitsOf(number).length >= 7 && !knownNumbers.has(digitsOf(number))),
  ];
  return [...new Set(invented)];
}

/** Host (without www.) and path (without a trailing slash), lowercased; query and fragment ignored. Empty when not an address. */
export function urlKey(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return `${parsed.host.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
}

export function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').host;
  } catch {
    return '';
  }
}

/** Whether two hosts belong to the same site (registrable domain). */
export function sameSite(a: string, b: string): boolean {
  const site = (host: string) => {
    const name = host.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
    if (/^[\d.]+$/.test(name) || name.includes(':') || !name.includes('.')) return name;
    const labels = name.split('.');
    // ponytail: no public-suffix list; two-part suffixes such as co.uk are guessed from their short labels.
    const take = labels.length > 2 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3 ? 3 : 2;
    return labels.slice(-take).join('.');
  };
  return !!a && site(a) === site(b);
}

/**
 * Whether typing `next` into a field replaces `previous`, a value the user gave (it appears in their messages), with
 * one of the agent's own. A reformat (the same letters and digits in another order or with other punctuation) or a
 * value that also appears in the user's messages is not a replacement.
 */
export function changesUserValue(previous: string | undefined, next: string, userText: string): boolean {
  const before = previous?.trim().toLowerCase() ?? '';
  const after = next.trim().toLowerCase();
  const text = userText.toLowerCase();
  if (before.length < 3 || before === after || !text.includes(before) || text.includes(after)) return false;
  // Whitespace and ASCII punctuation are formatting; letters and digits in any script are the value.
  const chars = (value: string) => [...value.replace(/[\s!-/:-@[-`{-~]/g, '')].sort().join('');
  return chars(before) !== chars(after);
}

/**
 * The entries of a list in the user's task (lines, ";"-separated items or numbered items) that contain `value` as a whole
 * word or phrase, with their position. Empty when the task has fewer than three entries or none contains the value.
 * ponytail: entries are split by punctuation only; a list written as prose ("Ada from London and Alan from Madrid") is one entry.
 */
export function taskEntriesWith(taskText: string, value: string): Array<{ index: number; text: string }> {
  const wanted = value.trim().toLowerCase();
  if (wanted.length < 2) return [];
  const entries = taskText.split(/\n|;|\s(?=\d{1,3}[.)]\s)/).map(entry => entry.trim()).filter(Boolean);
  if (entries.length < 3) return [];
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
  return entries.flatMap((text, index) => (word.test(text.toLowerCase()) ? [{ index, text }] : []));
}

/** Whether an answer quotes the agent's own action results ("Clicked button with index 2", "Input … into index 3") instead of page text. */
export function echoesActionResult(text: string): boolean {
  return /\b(with|into) index \d+\b|\belement \d+ \(|\byou (double-clicked|right-clicked|clicked|hovered over|dragged|typed)\b[^.]*\[\d+\]|in this note/i.test(text);
}

/** Affirmative answers to a confirmation; anything else counts as no. */
export function isApproval(answer: string): boolean {
  return /^\s*(yes|y|yeah|yep|ok|okay|sure|confirm(ed)?|approve(d)?|go ahead|proceed|do it|place it|buy it|pay)\b/i.test(answer);
}

export function staleIndexResult(index: number, observationId: string): ActionResult {
  return new ActionResult({
    executed: false,
    executionStatus: 'not_attempted',
    validated: 'unknown',
    retryability: 'retry_reobserve',
    failureReason: `Element index ${index} is not on the current page; re-observe before acting.`,
    extractedContent: `Element index ${index} is stale; re-observe before acting.`,
    includeInMemory: true,
    observationId,
  });
}

/**
 * The index, in the current read, of the element the model chose from the page in its prompt. Reads after an
 * action can number elements differently; the element is matched by frame and backendNodeId. Null when gone.
 */
export function currentIndexFor(promptState: BrowserState | undefined, current: BrowserState, index: number): number | null {
  if (!promptState || promptState.selectorMap === current.selectorMap) {
    return current.selectorMap.has(index) ? index : null;
  }
  const chosen = promptState.selectorMap.get(index);
  if (!chosen) return null;
  for (const [candidateIndex, node] of current.selectorMap) {
    if (node === chosen) return candidateIndex;
    if (
      chosen.backendNodeId !== undefined &&
      node.backendNodeId === chosen.backendNodeId &&
      node.frameKey === chosen.frameKey &&
      node.tagName === chosen.tagName
    ) {
      return candidateIndex;
    }
  }
  return null;
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
    return { ok: false, actionResult: staleIndexResult(actionArgs.index, observation.id) };
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

/**
 * The element an action targeted was removed or replaced by the page after it was read: re-read the page, do not count it
 * as the agent's failure. Puppeteer reports a node a single-page app re-rendered as "Node is detached from document".
 */
/**
 * The page's doing rather than a wrong move: the pointer check refused a target the page covers or hides (nothing was
 * clicked), or the site's connection failed. Online-Mind2Web: 3 of 39 tasks ended on three of these within seconds.
 */
export function isPageSideError(message: string): boolean {
  return /is covered by <|no visible area|net::ERR_(HTTP2_PROTOCOL_ERROR|CONNECTION_(RESET|CLOSED|REFUSED)|TIMED_OUT|EMPTY_RESPONSE|NETWORK_CHANGED)/i.test(message);
}

export function isStaleElementError(message: string): boolean {
  return /element (with index \d+ )?(is )?(no longer available|does not exist|not present|stale)|node is detached|detached from (the )?document/i.test(message);
}

const NAVIGATION_ACTIONS = ['go_to_url', 'search_web', 'go_back', 'go_forward'];
const SCROLL_ACTIONS = ['scroll'];
const POINTER_ACTIONS = ['click_element', 'hover_element', 'right_click_element', 'send_keys', 'drag_element'];
const MUTATING_ACTIONS = new Set([
  ...NAVIGATION_ACTIONS,
  ...SCROLL_ACTIONS,
  ...POINTER_ACTIONS,
  'open_tab',
  'switch_tab',
  'close_tab',
  'input_text',
  'select_dropdown_option',
  'handle_dialog',
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
  // Clicking scrolls the target into view first, so layout alone always moves: a click passes on content changes only.
  const contentChanged = readable && beforeObservation.contentFingerprint !== afterObservation.contentFingerprint;
  const openedNewTab = hasNewTab(before, after);

  if (after.dialog && !before.dialog) {
    return cloneWithValidation(result, 'passed', 'none', [
      evidence('modal_or_menu_change', true, `A JavaScript ${after.dialog.type} dialog opened.`),
    ]);
  }

  if (actionName === 'handle_dialog') {
    const passed = !after.dialog;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [evidence('modal_or_menu_change', passed, passed ? 'The dialog is closed.' : 'The dialog is still open.')],
      passed ? null : 'The dialog is still open.',
    );
  }

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

  // Typing and selecting are verified by the handler on the live element; the accessibility tree masks passwords
  // and lags behind framework-controlled inputs.
  if (actionName === 'input_text') {
    const readBack = result.evidence.find(item => item.kind === 'target_value');
    if (!readBack) {
      return cloneWithValidation(result, 'unknown', 'retry_reobserve', [], 'The field value was not read back; check the page before typing again.');
    }
    if (readBack.passed) {
      return cloneWithValidation(result, 'passed', 'none', []);
    }
    const shown = readBack.after as { actualLength?: number; actual?: string } | undefined;
    if (shown?.actualLength === 0) {
      return cloneWithValidation(result, 'failed', 'retry_reobserve', [], 'The field is still empty after typing.');
    }
    // A different value is usually the site reformatting the input (dates, phone numbers), so it is not a failure.
    return cloneWithValidation(
      result,
      'unknown',
      'retry_reobserve',
      [],
      shown?.actual !== undefined
        ? `The field now shows "${shown.actual}"; check whether that is acceptable before typing again.`
        : 'The field shows a different value than the typed text; check the page before typing again.',
    );
  }

  if (actionName === 'select_dropdown_option') {
    const selection = result.evidence.find(item => item.kind === 'selection');
    return selection?.passed
      ? cloneWithValidation(result, 'passed', 'none', [])
      : cloneWithValidation(result, 'unknown', 'retry_reobserve', [], 'The selection could not be confirmed; check the dropdown.');
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
    const towardsTop = args.direction === 'up' || args.direction === 'top';
    const towardsBottom = args.direction === 'down' || args.direction === 'bottom';
    const boundary = (towardsTop && after.scrollY <= 2) || (towardsBottom && after.scrollY >= maxScroll - 2);
    const passed = delta !== 0 || boundary;
    return cloneWithValidation(
      result,
      passed ? 'passed' : 'failed',
      passed ? 'none' : 'retry_reobserve',
      [
        evidence('scroll_delta', delta !== 0, delta !== 0 ? 'Scroll position changed.' : 'Scroll position did not change.', before.scrollY, after.scrollY),
        evidence('scroll_boundary', boundary, boundary ? 'The page is at the requested scroll position.' : 'The requested scroll position was not reached.'),
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
    if (changedUrl || docChanged || contentChanged || openedNewTab) {
      return cloneWithValidation(
        result,
        'passed',
        'none',
        [
          evidence('url_change', changedUrl, changedUrl ? 'Action changed URL.' : 'URL did not change.', before.url, after.url),
          evidence('document_change', docChanged || contentChanged, docChanged || contentChanged ? 'Action changed the page content.' : 'Page content did not change.'),
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

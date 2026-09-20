import { ActionResult } from '../types';
import { record } from '@src/background/trace';
import type { AgentContext } from '../types';
import { resolveByIdentity, type DOMElementNode } from '../../browser/dom/views';
import type { FormCommitInfo } from '../../browser/page';
import type { BrowserState } from '../../browser/views';
import type { BrowserObservation, Retryability, TargetFingerprint, ValidationEvidence, ValidationStatus } from './types';
import { elementKey, elementLabel, ensureBrowserObservation, listElements, visibleContentKey, visibleText } from './observation';
import { routeKey } from '../memory/global/memory-store';

/** What a guard decided about one action: it let it through, refused it, or put it to the user. */
export type GuardVerdict = 'allowed' | 'refused' | 'asked';

/**
 * One guard's verdict on one action, as a trace span of its own. Every refusal carries the guard's name and its
 * reason, so a run's traces give each guard's refusal count, and the refusals inside tasks that still passed are
 * that guard's false refusals (Operator reports 46 of 13,704 benign screens that way).
 */
export function traceGuard(guard: string, verdict: GuardVerdict, actionName: string, reason = ''): void {
  record({
    level: verdict === 'allowed' ? 'info' : 'warning',
    kind: 'span',
    component: 'Guard',
    msg: `guard ${guard}: ${verdict}`,
    data: { guard, verdict, action: actionName, reason: reason.slice(0, 300) },
  });
}

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

/**
 * A link to another address, or a control that opens a menu or dialog: activating it only shows a page or a form, so
 * its wording alone does not gate it ("Order now" linking to a menu, "Subscribe" opening a sign-up dialog). The submit
 * that follows is gated.
 */
function onlyOpens(node: DOMElementNode | undefined): boolean {
  if (!node) return false;
  const { href, 'aria-haspopup': popup, 'aria-expanded': expanded } = node.attributes;
  const link = node.tagName?.toLowerCase() === 'a' && !!href && !/^\s*(#|javascript:)/i.test(href);
  return link || (!!popup && popup !== 'false') || expanded !== undefined;
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
  return (actionName === 'send_keys' && PRESSES_ENTER.test(String(args.keys ?? ''))) || ((actionName === 'input_text' || actionName === 'fill_form') && args.submit === true);
}

/** Tools that press an element: the commit gate treats them alike, so a purchase cannot slip through the one it forgot. */
const CLICKING_TOOLS = new Set(['click_element', 'download']);

/** Whether an action could submit a form, so its form must be inspected before the gate decides. */
export function mayCommitThroughForm(actionName: string, args: Record<string, unknown>): boolean {
  return CLICKING_TOOLS.has(actionName) || pressesEnter(actionName, args);
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
  if (CLICKING_TOOLS.has(actionName)) {
    const parts = labelParts(node);
    label = onlyOpens(node) ? undefined : parts.find(isCommitLabel);
    if (!label && ((form?.isSubmitter && commitsForm) || modelSaysCommit)) label = parts[0] ?? form?.submitLabels[0] ?? 'this button';
  } else if (actionName === 'send_keys' || actionName === 'input_text' || actionName === 'fill_form') {
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
 * Where a personal value may come from: the user's task and answers, the page read and the last full page-text read.
 * Never the agent's own words (plans, findings, tool results): a refusal quoting a made-up email made that email known,
 * and the next attempt typed it.
 */
export function personalDataSources(context: AgentContext, page: BrowserState | undefined): string {
  return [
    ...context.messageManager
      .getTranscript()
      .filter(entry => entry.type === 'task' || entry.type === 'human_answer')
      .map(entry => String(entry.message.content)),
    page?.elementTree.clickableElementsToString(context.options.includeAttributes) ?? '',
    context.pageRead?.text ?? '',
  ].join('\n');
}

/**
 * Email addresses and phone or card numbers (7+ digits) in an action's arguments that appear nowhere in `knownText` (see
 * personalDataSources): values the model made up. Numbers are compared by their digits, so a
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

/**
 * How far from an edge a page still counts as at that edge. Real pages stop short of scrollHeight - viewport by a
 * scrollbar or sticky footer (15 px in live runs), so an edge is anything within 3% of the viewport (24 px at least).
 */
export function scrollEdgeSlack(viewportHeight: number): number {
  return Math.max(24, viewportHeight * 0.03);
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

/** An address as the site sees it: urlKey plus the query; http or https, www., a trailing slash and the fragment aside. */
export function addressKey(url: string, base?: string): string {
  const key = urlKey(url, base);
  return key && `${key}${new URL(url, base).search}`;
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

/** Names of CAPTCHA and bot-check widgets and of the controls inside them. */
const CHALLENGE_NAME = /captcha|turnstile|security challenge|not a robot|verify (that )?you('re| are) (a )?human|are you (a )?(robot|human)|human verification|press (and|&) hold/i;
/** Addresses of frames that serve CAPTCHA and bot-check widgets. */
const CHALLENGE_FRAME = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|captcha|arkoselabs|funcaptcha/i;
/** Wording of a page that blocks automated visitors until a check is passed. A footer naming a CAPTCHA provider is not one. */
const CHALLENGE_PAGE = /verify (that )?you('re| are) (a )?human|i'?m not a robot|unusual traffic|press (and|&) hold|are you a robot|checking (if the site connection is secure|your browser)|complete the security check|confirm you are human/i;

/**
 * Whether an element is (inside) a CAPTCHA or bot-check widget: its name or an ancestor's says so, or it sits in a frame
 * served by a challenge provider. Live runs clicked "I'm not a robot" boxes and challenge buttons themselves.
 */
export function isChallengeElement(node: DOMElementNode | undefined): boolean {
  if (!node) return false;
  try {
    if (CHALLENGE_FRAME.test(node.frame?.url() ?? '')) return true;
  } catch {
    // a detached frame: judge by names only
  }
  if (CHALLENGE_NAME.test(node.getAllTextTillNextClickableElement(2))) return true;
  for (let current: DOMElementNode | null = node; current; current = current.parent) {
    const names = [current.attributes['aria-label'], current.attributes.title, current.attributes.name, current.attributes.placeholder];
    if (names.some(name => name && CHALLENGE_NAME.test(name))) return true;
  }
  return false;
}

/**
 * The wording of a verification challenge the page shows ("verify you are human"), or null. Judged by text only: the
 * invisible CAPTCHA badge many sign-in pages carry is a widget but blocks nothing.
 */
export function challengeOnPage(state: BrowserState): string | null {
  return CHALLENGE_PAGE.exec(visibleText(state))?.[0] ?? null;
}

/** Whether a question to the user is about a CAPTCHA or bot check. */
export function isChallengeQuestion(question: string): boolean {
  return /captcha|not a robot|verification challenge|bot (check|detection)|security (check|challenge)|verify (that )?you('re| are) (a )?human|press (and|&) hold|human verification/i.test(question);
}

/** A question as compared for repeats: lowercase words only. */
export function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(new RegExp('[^\\p{L}\\p{N}]+', 'gu'), ' ').trim();
}

/**
 * Elements of a read that carry the same name as the one an action could not use: the copy that is visible, the
 * button the page rendered again. They are the candidates the refusal hands back, so the next call needs no guess.
 */
export function namedLike(chosen: DOMElementNode | undefined, state: BrowserState | null | undefined, max = 5): DOMElementNode[] {
  const wanted = chosen ? elementLabel(chosen).toLowerCase() : '';
  if (!wanted || !state) return [];
  const chosenKey = elementKey(chosen!);
  return [...state.selectorMap.values()]
    .filter(node => elementLabel(node).toLowerCase() === wanted && (chosenKey === null || elementKey(node) !== chosenKey))
    .slice(0, max);
}

export function staleIndexResult(index: number, observationId: string, candidates: DOMElementNode[] = []): ActionResult {
  // The page has been read again since this was chosen and the element is gone from it, so there is nothing to
  // retry: name the fix and hand back what is on the page now rather than only that the index is stale.
  const fix = candidates.length > 0
    ? ` Elements named like it on the current page: ${listElements(candidates)}.`
    : ' If what you want is not in it, open the section, menu or dialog that holds it first.';
  const msg = `[${index}] is not on the current page; the list below is current.${fix}`;
  return new ActionResult({
    executed: false,
    executionStatus: 'not_attempted',
    validated: 'unknown',
    retryability: 'retry_reobserve',
    failureReason: msg,
    extractedContent: msg,
    includeInMemory: true,
    observationId,
  });
}

/**
 * The index, in the current read, of the element the model chose from the page in its prompt. Reads after an
 * action can number elements differently, so the element is followed by identity (`resolveByIdentity`), not by its
 * number. Null when it is gone from the read, or when two elements would fit it equally well.
 */
export function currentIndexFor(promptState: BrowserState | undefined, current: BrowserState, index: number): number | null {
  if (!promptState || promptState.selectorMap === current.selectorMap) {
    return current.selectorMap.has(index) ? index : null;
  }
  const chosen = promptState.selectorMap.get(index);
  return chosen ? resolveByIdentity(chosen, current.selectorMap) : null;
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

/**
 * The href of a clicked link to another address when the page only gained a new fragment: the signature of an overlay
 * (an ad interstitial) that took the click, which the content change alone would pass as a navigation.
 */
function interceptedLink(before: BrowserState, after: BrowserState, index: number, actionArgs: unknown): string | null {
  const href = findTargetNode(before, index, actionTargetFingerprint(actionArgs))?.attributes?.href;
  if (!href || !before.url || !after.url || before.url === after.url) return null;
  try {
    const page = (url: string) => {
      const parsed = new URL(url, before.url);
      parsed.hash = '';
      return parsed.href;
    };
    return page(after.url) === page(before.url) && page(href) !== page(before.url) ? href : null;
  } catch {
    return null;
  }
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
  return /is covered by <|no visible area|still moving|net::ERR_(HTTP2_PROTOCOL_ERROR|CONNECTION_(RESET|CLOSED|REFUSED)|TIMED_OUT|EMPTY_RESPONSE|NETWORK_CHANGED)/i.test(message);
}

/**
 * The guard that refused a dispatch, by the wording `page.ts` refuses it with, or null for any other failure: the
 * name a trace needs to count how often each actionability check fires.
 */
export function dispatchGuard(message: string): string | null {
  if (/is covered by/i.test(message)) return 'covered';
  if (/no visible area/i.test(message)) return 'invisible';
  if (/still moving/i.test(message)) return 'moving';
  if (/is disabled/i.test(message)) return 'disabled';
  if (/is read-only/i.test(message)) return 'read-only';
  return isStaleElementError(message) ? 'stale-index' : null;
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
  'fill_form',
  'select_dropdown_option',
  'handle_dialog',
]);

/** Actions the loop detector counts by what they do rather than by their arguments. */
const POINTING_TOOLS = new Set([...POINTER_ACTIONS, 'select_dropdown_option']);

/** The words of a text, lowercased and sorted: two searches for the same thing in another order are one move. */
function sortedWords(text: string): string {
  return text
    .toLowerCase()
    .split(new RegExp('[^\\p{L}\\p{N}]+', 'u'))
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * One action as the loop detector reads it: what it does, not how it was written. A click or selection is its
 * element's role and name (not its index, which changes with every read), a navigation is its host and path
 * template, and typing or searching is the sorted words of its text. 94 of 157 repeated failures in one live run
 * were the identical action on the identical index.
 */
export function actionSignature(actionName: string, actionArgs: unknown, node?: DOMElementNode): string {
  const args = isObject(actionArgs) ? actionArgs : {};
  const target = node ? `${node.attributes.role || node.tagName || ''} ${elementLabel(node).toLowerCase()}` : `#${args.index ?? ''}`;
  if (POINTING_TOOLS.has(actionName)) {
    return `${actionName}|${target}|${sortedWords(String(args.text ?? ''))}`;
  }
  if (actionName === 'input_text' || actionName === 'fill_form') {
    return `${actionName}|${target}|${sortedWords(String(args.text ?? JSON.stringify(args.fields ?? '')))}`;
  }
  if (actionName === 'search_web' || actionName === 'find_in_page' || actionName === 'scroll_to_text') {
    return `${actionName}|${sortedWords(String(args.query ?? args.text ?? args.find ?? ''))}`;
  }
  if (typeof args.url === 'string' || typeof args.target === 'string') {
    const url = String(args.url ?? args.target ?? '');
    return `${actionName}|${routeKey(url) ?? url}`;
  }
  const { memory: _memory, observationId: _observation, targetFingerprint: _target, ...rest } = args;
  return `${actionName}|${JSON.stringify(rest)}`;
}

/** Actions the loop detector keeps in view; browser-use uses the same window. */
export const LOOP_WINDOW = 20;

/**
 * What to tell the model when the same move keeps coming back, or the page has not changed over a run of actions:
 * a hint at 5, a plain warning at 8, and at 12 the instruction to stop. Null at every other count, so each threshold
 * is said once instead of on every step.
 */
export function loopNudge(repeats: number, stagnant: number): string | null {
  if (repeats === 5 || (repeats < 5 && stagnant === 5)) {
    return repeats === 5
      ? `That is the same move ${repeats} times in your last ${LOOP_WINDOW} actions (the same element or the same address, whatever index it has now). If it were going to work it would have worked: try another way to the goal.`
      : `The page has not changed over your last ${stagnant} actions. What you are doing is not moving the task: try another route.`;
  }
  if (repeats === 8 || (repeats < 8 && stagnant === 8)) {
    return `${repeats === 8 ? `That is ${repeats} times for the same move` : `The page has not changed over your last ${stagnant} actions`}. Change the approach: another element, the site's own search or filters, get_complete_page_content with find, or another page.`;
  }
  if (repeats === 12 || (repeats < 12 && stagnant === 12)) {
    return `${repeats === 12 ? `${repeats} times for the same move` : `${stagnant} actions without a change on the page`}. Stop repeating it: take a completely different route, or finish with done (success: false) and say plainly what blocks you.`;
  }
  return null;
}

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
  if (actionName === 'input_text' || actionName === 'fill_form') {
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
    // A select that switches views can navigate away, so the option cannot be read back; the new address confirms it.
    if (!selection?.passed && changedUrl) {
      return cloneWithValidation(result, 'passed', 'none', [evidence('url_change', true, 'The selection opened a new address.', before.url, after.url)]);
    }
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
    const slack = scrollEdgeSlack(after.visualViewportHeight);
    const atTop = towardsTop && after.scrollY <= slack;
    const atBottom = towardsBottom && after.scrollY >= maxScroll - slack;
    const boundary = atTop || atBottom;
    const scrollEvidence = [
      evidence('scroll_delta', delta !== 0, delta !== 0 ? 'Scroll position changed.' : 'Scroll position did not change.', before.scrollY, after.scrollY),
      evidence('scroll_boundary', boundary, boundary ? 'The page is at the requested scroll position.' : 'The requested scroll position was not reached.'),
    ];
    if (delta !== 0) return cloneWithValidation(result, 'passed', 'none', scrollEvidence);
    // A scroll that cannot move changed nothing on the page, so it costs no failure budget; the model is told why.
    if (boundary) {
      const edge = atBottom ? 'bottom' : 'top';
      return new ActionResult({
        ...cloneWithValidation(result, 'passed', 'none', scrollEvidence),
        extractedContent: `The page is already at the ${edge}; scrolling ${args.direction} changed nothing.`,
      });
    }
    return cloneWithValidation(
      result,
      'unknown',
      'retry_reobserve',
      scrollEvidence,
      'The page did not scroll: it may be locked behind an open dialog or scroll only inside an element. Use the listed elements by index or scroll that element.',
    );
  }

  if (POINTER_ACTIONS.includes(actionName)) {
    const intercepted = actionName === 'click_element' && index !== undefined ? interceptedLink(before, after, index, actionArgs) : null;
    if (intercepted) {
      return cloneWithValidation(
        result,
        'unknown',
        'retry_reobserve',
        [evidence('url_change', false, 'The link did not open its address; only the fragment changed.', before.url, after.url)],
        `The link points to ${intercepted}, but the page stayed at the same address: an overlay or interstitial probably intercepted the click. Close it, then check whether the link opened.`,
      );
    }
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
    // A click that only moved the address fragment (an in-page anchor, an overlay's #hash) or reloaded the same address
    // into the same content did nothing the task can use; passing it hid that from the model in live runs.
    if (actionName === 'click_element' && readable && !openedNewTab && (changedUrl || docChanged)) {
      const withoutFragment = (url: string) => url.split('#')[0];
      const sameAddress = withoutFragment(before.url) === withoutFragment(after.url)
        && withoutFragment(activeTabUrl(before)) === withoutFragment(activeTabUrl(after));
      if (sameAddress && visibleContentKey(before) === visibleContentKey(after)) {
        const fragment = (url: string) => (url.includes('#') ? url.slice(url.indexOf('#')) : 'none');
        const message = changedUrl
          ? `The click only changed the address fragment (${fragment(before.url)} to ${fragment(after.url)}); the page content did not change.`
          : 'The click left the page at the same address with the same content as before (it was re-rendered or reloaded, nothing else).';
        const unchanged = cloneWithValidation(
          result,
          'unknown',
          'retry_reobserve',
          [evidence(changedUrl ? 'url_change' : 'document_change', false, message, before.url, after.url)],
          `${message} Do not count it as progress; check the page and try another element or route.`,
        );
        unchanged.extractedContent = `${result.extractedContent ?? ''} ${message}`.trim();
        return unchanged;
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

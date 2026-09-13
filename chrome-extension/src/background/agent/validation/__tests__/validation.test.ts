import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../types';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import type { BrowserState } from '../../../browser/views';
import { appearedText, createBrowserObservation } from '../observation';
import type { ValidationEvidence } from '../types';
import {
  amountBefore,
  changesUserValue,
  taskEntriesWith,
  inventedPersonalData,
  commitQuestion,
  commitTarget,
  echoesActionResult,
  currentIndexFor,
  isApproval,
  mayCommitThroughForm,
  normalizeIndexedAction,
  sameSite,
  urlKey,
  userPersonalData,
  validateActionOutcome,
} from '../service';
import type { FormCommitInfo } from '../../../browser/page';

function element(index: number, params: Partial<ConstructorParameters<typeof DOMElementNode>[0]> = {}) {
  return new DOMElementNode({
    tagName: params.tagName ?? 'button',
    xpath: params.xpath ?? `/html/body/button[${index}]`,
    attributes: params.attributes ?? { 'aria-label': `Button ${index}` },
    children: params.children ?? [],
    isVisible: true,
    isInteractive: true,
    isTopElement: true,
    isInViewport: true,
    highlightIndex: index,
    backendNodeId: params.backendNodeId ?? index + 100,
    viewportCoordinates: params.viewportCoordinates,
  });
}

function state(overrides: Partial<BrowserState> = {}): BrowserState {
  const root = new DOMElementNode({
    tagName: 'root',
    xpath: '',
    attributes: {},
    children: [],
    isVisible: true,
  });
  const selectorMap = overrides.selectorMap ?? new Map([[1, element(1)]]);
  const base: BrowserState = {
    elementTree: root,
    selectorMap,
    tabId: 7,
    url: 'https://example.com/start',
    title: 'Start',
    screenshot: null,
    scrollY: 0,
    scrollHeight: 1000,
    visualViewportHeight: 500,
    tabs: [{ id: 7, url: 'https://example.com/start', title: 'Start' }],
  };
  return { ...base, ...overrides };
}

describe('ActionResult validation fields', () => {
  it('preserves old defaults while exposing typed validation defaults', () => {
    const result = new ActionResult();

    expect(result.isDone).toBe(false);
    expect(result.error).toBeNull();
    expect(result.executed).toBe(false);
    expect(result.executionStatus).toBe('not_attempted');
    expect(result.validated).toBe('not_applicable');
    expect(result.evidence).toEqual([]);
    expect(result.retryability).toBe('none');
    expect(result.failureReason).toBeNull();
    expect(result.observationId).toBeNull();
    expect(result.targetFingerprint).toBeNull();
  });
});

describe('browser observations', () => {
  it('creates compact target fingerprints and changes document fingerprint when URL changes', () => {
    const first = createBrowserObservation(state(), 1000);
    const second = createBrowserObservation(state({ url: 'https://example.com/next' }), 1000);

    expect(first.id).toContain('obs_7_');
    expect(first.targets).toHaveLength(1);
    expect(first.targets[0]).toMatchObject({
      index: 1,
      tabId: 7,
      backendNodeId: 101,
      xpath: '/html/body/button[1]',
      tagName: 'button',
      accessibleName: 'Button 1',
    });
    expect(first.documentFingerprint).not.toBe(second.documentFingerprint);
  });

  it('changes the layout fingerprint when only page text or an element state changes', () => {
    const withText = (text: string) => {
      const root = new DOMElementNode({ tagName: 'root', xpath: '', attributes: {}, children: [], isVisible: true });
      root.children.push(new DOMTextNode(text, true, root));
      return state({ elementTree: root });
    };
    const checkbox = (checked: string) =>
      state({ selectorMap: new Map([[1, element(1, { tagName: 'input', attributes: { 'aria-checked': checked } })]]) });

    expect(createBrowserObservation(withText('Added 1')).layoutFingerprint).not.toBe(createBrowserObservation(withText('Added 2')).layoutFingerprint);
    expect(createBrowserObservation(checkbox('false')).layoutFingerprint).not.toBe(createBrowserObservation(checkbox('true')).layoutFingerprint);
    expect(createBrowserObservation(withText('same')).layoutFingerprint).toBe(createBrowserObservation(withText('same')).layoutFingerprint);
  });

});

describe('indexed action normalization', () => {
  it('attaches current observation id and target fingerprint when the model omits them', () => {
    const observation = createBrowserObservation(state(), 1000);
    const args = { index: 1 };

    const result = normalizeIndexedAction('click_element', args, observation);

    expect(result.ok).toBe(true);
    expect(args).toMatchObject({
      observationId: observation.id,
      targetFingerprint: {
        ...observation.targets[0],
        actionType: 'click_element',
      },
    });
  });

  it('restamps stale observation ids when the current target is still present', () => {
    const observation = createBrowserObservation(state(), 1000);

    const result = normalizeIndexedAction('click_element', { index: 1, observationId: 'old' }, observation);

    expect(result.ok).toBe(true);
  });

  it('reports an index missing from the observation as stale without executing', () => {
    const observation = createBrowserObservation(state(), 1000);

    const result = normalizeIndexedAction('click_element', { index: 9 }, observation);

    expect(result.ok).toBe(false);
    expect(result.actionResult?.executed).toBe(false);
    expect(result.actionResult?.validated).toBe('unknown');
    expect(result.actionResult?.retryability).toBe('retry_reobserve');
  });
});

describe('prompt index mapping', () => {
  it('follows the chosen element to its index in a later read, and reports it gone otherwise', () => {
    const save = element(3, { backendNodeId: 555, attributes: { 'aria-label': 'Save' } });
    const prompt = state({ selectorMap: new Map([[3, save]]) });
    const inserted = element(3, { backendNodeId: 777 });
    const later = state({ selectorMap: new Map([[3, inserted], [4, element(4, { backendNodeId: 555 })]]) });

    expect(currentIndexFor(prompt, prompt, 3)).toBe(3);
    expect(currentIndexFor(prompt, later, 3)).toBe(4);
    expect(currentIndexFor(prompt, state({ selectorMap: new Map([[3, inserted]]) }), 3)).toBeNull();
    expect(currentIndexFor(undefined, later, 4)).toBe(4);
  });
});

describe('action outcome validation', () => {
  it('passes click validation on URL change and reports a no-op click as unknown', () => {
    const before = state();
    const changed = state({ url: 'https://example.com/next' });
    const unchanged = state();

    const pass = validateActionOutcome({
      actionName: 'click_element',
      actionArgs: { index: 1 },
      before,
      after: changed,
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });
    const fail = validateActionOutcome({
      actionName: 'click_element',
      actionArgs: { index: 1 },
      before,
      after: unchanged,
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(pass.validated).toBe('passed');
    expect(pass.evidence.some(e => e.kind === 'url_change' && e.passed)).toBe(true);
    expect(fail.validated).toBe('unknown');
    expect(fail.retryability).toBe('retry_reobserve');
  });

  it('passes a click that toggles aria-checked', () => {
    const toggle = (checked: string) =>
      state({ selectorMap: new Map([[1, element(1, { attributes: { role: 'checkbox', 'aria-label': 'Remember me', 'aria-checked': checked } })]]) });

    const result = validateActionOutcome({
      actionName: 'click_element',
      actionArgs: { index: 1 },
      before: toggle('false'),
      after: toggle('true'),
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(result.validated).toBe('passed');
  });

  it('never treats an empty URL read mid-navigation as a change', () => {
    const result = validateActionOutcome({
      actionName: 'click_element',
      actionArgs: { index: 1 },
      before: state(),
      after: state({ url: '', tabs: [{ id: 7, url: '', title: 'Start' }] }),
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(result.validated).toBe('unknown');
  });

  it('passes navigation to the URL the page is already on', () => {
    const result = validateActionOutcome({
      actionName: 'go_to_url',
      actionArgs: { url: 'https://example.com/start' },
      before: state(),
      after: state(),
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(result.validated).toBe('passed');
  });

  it('passes a scroll that moved or is at the end it went towards, and fails one that did neither', () => {
    const at = (scrollY: number) => state({ scrollY, scrollHeight: 1500, visualViewportHeight: 500 });
    const scroll = (direction: string, before: number, after: number, index?: number) =>
      validateActionOutcome({
        actionName: 'scroll',
        actionArgs: { direction, ...(index !== undefined ? { index } : {}) },
        before: at(before),
        after: at(after),
        result: new ActionResult({ executed: true, executionStatus: 'executed' }),
      }).validated;

    expect(scroll('down', 0, 500)).toBe('passed');
    expect(scroll('up', 0, 0)).toBe('passed');
    expect(scroll('top', 1, 1)).toBe('passed');
    expect(scroll('bottom', 1000, 1000)).toBe('passed');
    expect(scroll('down', 1000, 1000)).toBe('passed');
    expect(scroll('down', 400, 400)).toBe('failed');
    expect(scroll('up', 400, 400)).toBe('failed');
    // Inside an element the window does not move; only a content change shows the scroll.
    expect(scroll('down', 0, 0, 1)).toBe('unknown');
  });

  it('passes click validation when the selected target state changes', () => {
    const before = state({
      selectorMap: new Map([[1, element(1, { attributes: { 'aria-label': 'Follow @example' } })]]),
    });
    const after = state({
      selectorMap: new Map([[1, element(1, { attributes: { 'aria-label': 'Following @example' } })]]),
    });

    const result = validateActionOutcome({
      actionName: 'click_element',
      actionArgs: { index: 1 },
      before,
      after,
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(result.validated).toBe('passed');
    expect(result.evidence.some(e => e.kind === 'target_state' && e.passed)).toBe(true);
  });

  it('passes click validation when a SPA rerender moves the target index', () => {
    const before = state({
      selectorMap: new Map([[1, element(1, {
        attributes: { 'aria-label': 'Follow @example' },
        xpath: '/html/body/button[1]',
      })]]),
    });
    const after = state({
      selectorMap: new Map([[2, element(2, {
        attributes: { 'aria-label': 'Following @example' },
        xpath: '/html/body/button[1]',
      })]]),
    });

    const result = validateActionOutcome({
      actionName: 'click_element',
      actionArgs: {
        index: 1,
        targetFingerprint: {
          index: 1,
          actionType: 'click_element',
          xpath: '/html/body/button[1]',
          accessibleName: 'Follow @example',
        },
      },
      before,
      after,
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(result.validated).toBe('passed');
    expect(result.evidence.some(e => e.kind === 'target_state' && e.passed)).toBe(true);
  });

  it('does not classify unrelated login text as an authentication blocker', () => {
    const before = state({
      selectorMap: new Map([[1, element(1, { attributes: { 'aria-label': 'Follow @example' } })]]),
    });
    const after = state({
      selectorMap: new Map([
        [1, element(1, { attributes: { 'aria-label': 'Following @example' } })],
        [2, element(2, { attributes: { 'aria-label': 'Log in' } })],
      ]),
    });

    const result = validateActionOutcome({
      actionName: 'click_element',
      actionArgs: { index: 1 },
      before,
      after,
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(result.validated).toBe('passed');
    expect(result.isWaitingForHuman).toBe(false);
  });

  it('validates typed text from the handler read-back', () => {
    const validate = (evidence: ValidationEvidence[]) => validateActionOutcome({
      actionName: 'input_text',
      actionArgs: { index: 1, text: '05/20/2024' },
      before: state(),
      after: state(),
      result: new ActionResult({ executed: true, executionStatus: 'executed', evidence }),
    });
    const readBack = (passed: boolean, after: Record<string, unknown>): ValidationEvidence[] => [
      { kind: 'target_value', passed, message: '', after },
    ];

    expect(validate(readBack(true, { actualLength: 10 })).validated).toBe('passed');
    expect(validate(readBack(false, { actualLength: 0 })).validated).toBe('failed');
    const reformatted = validate(readBack(false, { actualLength: 10, actual: '2024-05-20' }));
    expect(reformatted.validated).toBe('unknown');
    expect(reformatted.failureReason).toContain('2024-05-20');
    expect(validate([]).validated).toBe('unknown');
  });

  it('passes an action that opened a JavaScript dialog, and handle_dialog once the dialog is gone', () => {
    const dialog = { type: 'confirm', message: 'Are you sure?' };
    const executed = new ActionResult({ executed: true, executionStatus: 'executed' });

    expect(validateActionOutcome({ actionName: 'click_element', actionArgs: { index: 1 }, before: state(), after: state({ dialog }), result: executed }).validated).toBe('passed');
    expect(validateActionOutcome({ actionName: 'handle_dialog', actionArgs: { accept: false }, before: state({ dialog }), after: state(), result: executed }).validated).toBe('passed');
    expect(validateActionOutcome({ actionName: 'handle_dialog', actionArgs: { accept: false }, before: state({ dialog }), after: state({ dialog }), result: executed }).validated).toBe('failed');
  });

  it('leaves done to the planner instead of validating it against earlier actions', () => {
    const outcome = validateActionOutcome({
      actionName: 'done',
      actionArgs: { success: true, text: 'finished' },
      before: state(),
      after: state(),
      result: new ActionResult({ isDone: true, executed: true, executionStatus: 'executed' }),
    });

    expect(outcome.validated).toBe('not_applicable');
    expect(outcome.retryability).toBe('none');
  });

  it('classifies stale element errors as replan failures', () => {
    const result = validateActionOutcome({
      actionName: 'click_element',
      actionArgs: { index: 1 },
      before: state(),
      after: state(),
      result: new ActionResult({
        executed: true,
        executionStatus: 'executed',
        error: 'Element with index 1 is no longer available',
      }),
    });

    expect(result.validated).toBe('failed');
    expect(result.retryability).toBe('replan');
    expect(result.failureReason).toContain('re-observe');
  });
});

describe('committing actions', () => {
  const button = (label: string) => element(1, { attributes: { 'aria-label': label } });

  const click = (node: DOMElementNode, args: Record<string, unknown> = {}, form: FormCommitInfo | null = null) =>
    commitTarget('click_element', { index: 1, ...args }, 'https://shop.test/checkout?step=2', node, form);
  const noForm: FormCommitInfo = { inForm: false, isSubmitter: false, paymentFields: false, submitLabels: [] };

  it('recognises orders, payments, subscriptions and account deletion by the element label', () => {
    for (const label of ['Place order', 'Submit order', 'Buy now', 'Pay $40.00', 'Complete purchase', 'Confirm order', 'Subscribe', 'Delete account']) {
      expect(click(button(label))?.label).toBe(label);
    }
    for (const label of ['Add to cart', 'Checkout', 'Send', 'Submit', 'Delete', 'Log in', 'Order history', 'Payment methods', 'Buy', 'Purchase history', 'Subscribe to our newsletter']) {
      expect(click(button(label), {}, noForm)).toBeNull();
    }
  });

  it('keys a commit by page and label, so the same button needs the same approval', () => {
    const target = click(button('Place order'));
    expect(target).toEqual({ key: 'shop.test/checkout|place order', label: 'Place order', place: 'shop.test/checkout' });
  });

  it('tests each label part on its own, so a long accessible name cannot hide the commit wording', () => {
    const node = element(1, { attributes: { 'aria-label': 'Place order' }, children: [] });
    node.getAllTextTillNextClickableElement = () => 'Your order of 3 items will be shipped to the address on file within five working days';
    expect(click(node)?.label).toBe('Place order');
  });

  it('gates a submit in a payment form whatever its wording, and any action the model marks as a commit', () => {
    const paymentForm: FormCommitInfo = { inForm: true, isSubmitter: true, paymentFields: true, submitLabels: ['Continue to payment'] };
    expect(click(button('Continue to payment'), {}, paymentForm)?.label).toBe('Continue to payment');
    expect(click(button('Continue'), {}, { ...paymentForm, isSubmitter: false })).toBeNull();
    expect(click(button('Zahlungspflichtig bestellen'), { commits: 'order' })?.label).toBe('Zahlungspflichtig bestellen');
    expect(click(button('Zahlungspflichtig bestellen'), {}, noForm)).toBeNull();
    expect(click(button('In den Warenkorb'), { commits: 'none' }, noForm)).toBeNull();
    expect(commitTarget('send_keys', { keys: 'Control+Enter', commits: 'payment' }, 'https://a.test/pay')?.label).toBe('Control+Enter');
  });

  it('gates Enter in a form that orders or pays, and browser tools that erase data', () => {
    const orderForm: FormCommitInfo = { inForm: true, isSubmitter: false, paymentFields: false, submitLabels: ['Place order'] };
    expect(commitTarget('send_keys', { keys: 'Enter' }, 'https://shop.test/promo', undefined, orderForm)?.label).toBe('Enter, which submits "Place order"');
    expect(commitTarget('send_keys', { keys: 'Enter' }, 'https://shop.test/search', undefined, { ...orderForm, submitLabels: ['Search'] })).toBeNull();
    expect(commitTarget('send_keys', { keys: 'Tab' }, 'https://shop.test/promo', undefined, orderForm)).toBeNull();
    expect(commitTarget('manage_privacy', { action: 'clearData', clearTypes: ['cookies'] }, 'https://a.test/')?.label).toBe('Clear browsing data (cookies)');
    expect(commitTarget('manage_extensions', { action: 'getAll' }, 'https://a.test/')).toBeNull();
  });

  it('gates typing with submit exactly like Enter: in a payment or order form, or when the model marks it', () => {
    const field = element(1, { tagName: 'input', attributes: { 'aria-label': 'Promo code' } });
    const paymentForm: FormCommitInfo = { inForm: true, isSubmitter: false, paymentFields: true, submitLabels: ['Continue'] };
    const orderForm: FormCommitInfo = { ...paymentForm, paymentFields: false, submitLabels: ['Place order'] };
    const type = (args: Record<string, unknown>, form: FormCommitInfo | null) =>
      commitTarget('input_text', { index: 1, text: 'SAVE10', ...args }, 'https://shop.test/checkout', field, form);

    expect(mayCommitThroughForm('input_text', { index: 1, text: 'SAVE10', submit: true })).toBe(true);
    expect(mayCommitThroughForm('input_text', { index: 1, text: 'SAVE10' })).toBe(false);
    expect(type({ submit: true }, paymentForm)?.label).toBe('Enter, which submits "Continue"');
    expect(type({ submit: true }, orderForm)?.label).toBe('Enter, which submits "Place order"');
    expect(type({ submit: true }, { ...orderForm, submitLabels: ['Search'] })).toBeNull();
    expect(type({}, orderForm)).toBeNull();
    expect(type({ submit: true, commits: 'order' }, noForm)?.label).toBe('Enter after typing, which submits the form');
    expect(type({ commits: 'order' }, noForm)).toBeNull();
  });

  it('asks with the amount shown before the button, in words no page can write', () => {
    const page = '[0]<a>Cart</a>\nAlex — $30.00\n[1]<button>Place order</button>\nSam — 20,00 €\n[2]<button>Place order</button>';
    expect(amountBefore(page, 1)).toBe('$30.00');
    expect(amountBefore(page, 2)).toBe('20,00 €');
    expect(amountBefore('no prices', 1)).toBeNull();
    const question = commitQuestion({ key: 'k', label: 'Place order', place: 'shop.test/checkout' }, '$40.00');
    expect(question).toContain('"Place order" on shop.test/checkout (amount shown: $40.00)');
  });

  it("finds the user's own emails and phone or card numbers in an action, whatever their formatting", () => {
    const user = 'My email is Jamie.Rivera@example.com and my phone is (555) 010-0199. Card 4242 4242 4242 4242.';
    expect(userPersonalData('{"text":"jamie.rivera@example.com"}', user)).toEqual(['jamie.rivera@example.com']);
    expect(userPersonalData('{"url":"https://x.test/?p=555-010-0199"}', user)).toEqual(['555-010-0199']);
    expect(userPersonalData('{"text":"4242424242424242"}', user)).toEqual(['4242424242424242']);
    expect(userPersonalData('{"text":"someone@else.com 555-0100 12/30"}', user)).toEqual([]);
    expect(userPersonalData('{"text":"Web Genie"}', user)).toEqual([]);
  });

  it('keys addresses by host and path, resolving relative links', () => {
    expect(urlKey('https://www.Example.com/Wiki/Alan_Turing/?x=1#top')).toBe('example.com/wiki/alan_turing');
    expect(urlKey('/wiki/Alonzo_Church', 'https://en.wikipedia.org/wiki/Alan_Turing')).toBe('en.wikipedia.org/wiki/alonzo_church');
    expect(urlKey('https://example.com/')).toBe('example.com');
    expect(urlKey('javascript:alert(1)')).toBe('');
    expect(urlKey('not a url')).toBe('');
  });

  it('treats subdomains of one site as the same site, and nothing else', () => {
    expect(sameSite('accounts.example.com', 'www.example.com')).toBe(true);
    expect(sameSite('shop.example.co.uk', 'example.co.uk')).toBe(true);
    expect(sameSite('example.co.uk', 'evil.co.uk')).toBe(false);
    expect(sameSite('example.com', 'example.com.evil.net')).toBe(false);
    expect(sameSite('127.0.0.1:8080', '127.0.0.1:9090')).toBe(true);
    expect(sameSite('10.0.0.1', '127.0.0.1')).toBe(false);
    expect(sameSite('', 'example.com')).toBe(false);
  });

  it('reads yes-like answers as approval and anything else as a decline', () => {
    for (const answer of ['Yes', 'yes please', 'OK', 'Go ahead', 'Confirm']) expect(isApproval(answer)).toBe(true);
    for (const answer of ['No', "Don't", 'not now', 'Cancel', '']) expect(isApproval(answer)).toBe(false);
  });
});

describe('inventedPersonalData', () => {
  const known = 'Book a delivery for Web Genie to 1 Main Street.\nAnswer from the user: Phone: 555 0100, email web@genie.test';

  it('flags emails and phone or card numbers that appear nowhere the agent read', () => {
    expect(inventedPersonalData('555-123-4567', known)).toEqual(['555-123-4567']);
    expect(inventedPersonalData('someone@else.test', known)).toEqual(['someone@else.test']);
  });

  it('accepts known values in another format, and short numbers', () => {
    expect(inventedPersonalData('(555) 0100', known)).toEqual([]);
    expect(inventedPersonalData('WEB@genie.test', known)).toEqual([]);
    expect(inventedPersonalData('Flat 12', known)).toEqual([]);
  });
});

describe('taskEntriesWith', () => {
  const task = 'Guests (name, city, colour): 1. Katherine Johnson, Oslo, white; 2. Ada Lovelace, London, green; 14. Katherine Backus, Oslo, blue';

  it('finds the list entries that hold a value as a whole word', () => {
    // Entry 0 is the list's heading ("Guests (name, city, colour):").
    expect(taskEntriesWith(task, 'Oslo').map(entry => entry.index)).toEqual([1, 3]);
    expect(taskEntriesWith(task, 'blue')).toEqual([{ index: 3, text: '14. Katherine Backus, Oslo, blue' }]);
    expect(taskEntriesWith(task, 'Lon')).toEqual([]);
  });

  it('finds nothing in a task that is not a list', () => {
    expect(taskEntriesWith('Send Alex the message "Running late"; thanks', 'Alex')).toEqual([]);
  });
});

describe('changesUserValue', () => {
  const user = 'Sign up with the email "someone@example" and the date 05/20/2024. Answer from the user: use someone@example.org';

  it('flags replacing a value the user gave with one the agent made up', () => {
    expect(changesUserValue('someone@example', 'someone@example.com', user)).toBe(true);
  });

  it('allows reformatting, values the user gave, first entries and agent-chosen values', () => {
    expect(changesUserValue('05/20/2024', '2024-05-20', user)).toBe(false);
    expect(changesUserValue('someone@example', 'someone@example.org', user)).toBe(false);
    expect(changesUserValue(undefined, 'anything', user)).toBe(false);
    expect(changesUserValue('draft text', 'better text', user)).toBe(false);
  });
});

describe('echoesActionResult', () => {
  it('recognises action-result wording and leaves page text alone', () => {
    expect(echoesActionResult('The status message is: Clicked button with index 1: Save')).toBe(true);
    expect(echoesActionResult('Input WebGenie into index 3')).toBe(true);
    expect(echoesActionResult("The page shows 'Dragged element 2 (A) onto element 1 (B)'")).toBe(true);
    expect(echoesActionResult('The message is: You clicked [2] "Remove"; the page\'s response is in the browser state, not in this note.')).toBe(true);
    expect(echoesActionResult('You clicked the Remove button and the page shows "It\'s gone!"')).toBe(false);
    expect(echoesActionResult('Saved: hello frames')).toBe(false);
    expect(echoesActionResult('The book index lists 3 chapters')).toBe(false);
  });
});

describe('appearedText', () => {
  const page = (...texts: string[]) => {
    const root = new DOMElementNode({ tagName: 'body', xpath: '', attributes: {}, children: [], isVisible: true });
    for (const text of texts) root.children.push(new DOMTextNode(text, true, root));
    return state({ elementTree: root });
  };

  it('returns short text that appeared after an action and nothing that was already there', () => {
    const before = page('Login Page', 'Username');
    const after = page('Login Page', 'Username', '  Your password is invalid!  ', 'ok', 'x'.repeat(300), 'Login Page');
    expect(appearedText(before, after)).toEqual(['Your password is invalid!']);
  });
});

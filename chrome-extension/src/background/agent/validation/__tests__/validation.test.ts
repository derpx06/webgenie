import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../types';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import type { BrowserState } from '../../../browser/views';
import { appearedText, createBrowserObservation, listElements, revealedControls } from '../observation';
import type { ValidationEvidence } from '../types';
import {
  challengeOnPage,
  changesUserValue,
  isChallengeElement,
  isChallengeQuestion,
  normalizeQuestion,
  taskEntriesWith,
  inventedPersonalData,
  commitQuestion,
  handoverNotice,
  commitTarget,
  echoesActionResult,
  currentIndexFor,
  dispatchGuard,
  isApproval,
  isPageSideError,
  mayCommitThroughForm,
  namedLike,
  normalizeIndexedAction,
  requirementsInQuery,
  sameBrand,
  sameSite,
  staleIndexResult,
  suggestionCommitted,
  taskNamesSite,
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

  it('passes a scroll that moved or is at the end it went towards, and never charges one that could not move', () => {
    const at = (scrollY: number) => state({ scrollY, scrollHeight: 1500, visualViewportHeight: 500 });
    const run = (direction: string, before: number, after: number, index?: number) =>
      validateActionOutcome({
        actionName: 'scroll',
        actionArgs: { direction, ...(index !== undefined ? { index } : {}) },
        before: at(before),
        after: at(after),
        result: new ActionResult({ executed: true, executionStatus: 'executed', extractedContent: 'Scrolled down 1 page.' }),
      });
    const scroll = (direction: string, before: number, after: number, index?: number) => run(direction, before, after, index).validated;

    expect(scroll('down', 0, 500)).toBe('passed');
    expect(scroll('up', 0, 0)).toBe('passed');
    expect(scroll('top', 1, 1)).toBe('passed');
    expect(scroll('bottom', 1000, 1000)).toBe('passed');
    expect(scroll('down', 1000, 1000)).toBe('passed');
    // Pages stop short of the computed maximum by a scrollbar or sticky footer.
    expect(scroll('down', 985, 985)).toBe('passed');
    expect(run('down', 985, 985).extractedContent).toBe('The page is already at the bottom; scrolling down changed nothing.');
    expect(run('up', 10, 10).extractedContent).toContain('already at the top');
    // Stuck mid-page (a scroll-locked page behind a dialog) is unconfirmed, not a failure.
    expect(scroll('down', 400, 400)).toBe('unknown');
    expect(scroll('up', 400, 400)).toBe('unknown');
    expect(run('down', 400, 400).failureReason).toContain('did not scroll');
    // Inside an element the window does not move; only a content change shows the scroll.
    expect(scroll('down', 0, 0, 1)).toBe('unknown');
  });

  it('does not pass a link click that an overlay intercepted, but passes an in-page anchor', () => {
    const link = (href: string) => state({ selectorMap: new Map([[1, element(1, { tagName: 'a', attributes: { href } })]]) });
    const click = (href: string, afterUrl: string) =>
      validateActionOutcome({
        actionName: 'click_element',
        actionArgs: { index: 1 },
        before: link(href),
        after: state({ url: afterUrl, title: 'Advertisement', selectorMap: new Map([[1, element(1, { attributes: { 'aria-label': 'Close' } })]]) }),
        result: new ActionResult({ executed: true, executionStatus: 'executed' }),
      });

    const intercepted = click('https://example.com/hourly', 'https://example.com/start#ad');
    expect(intercepted.validated).toBe('unknown');
    expect(intercepted.failureReason).toContain('https://example.com/hourly');
    expect(click('https://example.com/start#details', 'https://example.com/start#details').validated).toBe('passed');
    expect(click('https://example.com/hourly', 'https://example.com/hourly').validated).toBe('passed');
  });

  /**
   * A live questionnaire routes each "Next" in place: the address stays, the content is replaced. Reading that as an
   * intercepted click cost one run twelve false verdicts, two re-plans and a question to the user about a navigation
   * bar that was never in the way.
   */
  it('passes an in-place route that replaces the page, and still catches an overlay that covers it', () => {
    // A page read: the "Next" link, the options it shows, and the words on it.
    const page = (url: string, options: string[], lines: string[]) => {
      const selectorMap = new Map([[1, element(1, { tagName: 'a', attributes: { href: '/question/3' } })]]);
      options.forEach((label, i) => selectorMap.set(i + 2, element(i + 2, { attributes: { 'aria-label': label } })));
      const built = state({ url, selectorMap });
      for (const line of lines) built.elementTree.children.push(new DOMTextNode(line, true, built.elementTree));
      return built;
    };
    const asked = ['What size dog suits your home best?', 'Small, up to 20 pounds of dog', 'Medium, a dog you can still lift', 'Large, a dog that leans on you'];
    const next = ['How much grooming will you take on?', 'Weekly brushing at most, nothing more', 'A trim every couple of months is fine', 'Daily coat care is no trouble at all'];

    const click = (before: BrowserState, after: BrowserState) =>
      validateActionOutcome({
        actionName: 'click_element',
        actionArgs: { index: 1 },
        before,
        after,
        result: new ActionResult({ executed: true, executionStatus: 'executed' }),
      });

    // Routed in place: same address, the questions before it are gone.
    const routed = click(page('https://example.com/quiz#2', asked.slice(1), asked), page('https://example.com/quiz#3', next.slice(1), next));
    expect(routed.validated).toBe('passed');
    expect(routed.failureReason ?? '').not.toContain('overlay');

    // Covered instead: everything that was there is still there, with the overlay on top.
    const covered = click(
      page('https://example.com/quiz#2', asked.slice(1), asked),
      page('https://example.com/quiz#ad', [...asked.slice(1), 'Close'], [...asked, 'Subscribe for our newsletter now']),
    );
    expect(covered.validated).toBe('unknown');
    expect(covered.failureReason).toContain('/question/3');
  });

  it('passes a selection that navigated away, where the option can no longer be read back', () => {
    const select = (afterUrl: string) =>
      validateActionOutcome({
        actionName: 'select_dropdown_option',
        actionArgs: { index: 1, text: '2023' },
        before: state(),
        after: state({ url: afterUrl }),
        result: new ActionResult({ executed: true, executionStatus: 'executed', evidence: [{ kind: 'selection', passed: false, message: 'not confirmed' }] }),
      }).validated;

    expect(select('https://example.com/start/2023')).toBe('passed');
    expect(select('https://example.com/start')).toBe('unknown');
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

  it('asks when the page would not let the form be read, and not when there was no form to read', () => {
    const unreadable: FormCommitInfo = { inForm: true, isSubmitter: true, paymentFields: false, submitLabels: [], unreadable: true };
    // The gate protects the user's money: a form it could not inspect is one that may take it.
    expect(click(button('Continue'), {}, unreadable)).not.toBeNull();
    // `null` is the other case entirely: this tool cannot commit through a form, so nothing was inspected.
    expect(click(button('Continue'), {}, null)).toBeNull();
    expect(click(button('Continue'), {}, noForm)).toBeNull();
  });

  it('recognises orders, payments, subscriptions and account deletion by the element label', () => {
    for (const label of ['Place order', 'Submit order', 'Buy now', 'Pay $40.00', 'Complete purchase', 'Confirm order', 'Subscribe', 'Delete account']) {
      expect(click(button(label))?.label).toBe(label);
    }
    for (const label of ['Add to cart', 'Checkout', 'Send', 'Submit', 'Delete', 'Log in', 'Order history', 'Payment methods', 'Buy', 'Purchase history', 'Subscribe to our newsletter']) {
      expect(click(button(label), {}, noForm)).toBeNull();
    }
  });

  it('gates a download the same way, so a purchase cannot slip through the tool the gate forgot', () => {
    expect(commitTarget('download', { index: 1 }, 'https://shop.test/checkout', button('Place order'))?.label).toBe('Place order');
    expect(commitTarget('download', { index: 1 }, 'https://shop.test/orders', button('Download invoice'), noForm)).toBeNull();
    expect(mayCommitThroughForm('download', { index: 1 })).toBe(true);
  });

  // Markup is the page's to write. A page that wanted a click ungated only had to make the submit a GET link or
  // put aria-expanded="false" on the buy button. Commit wording now wins over markup; the markup only softens
  // how the question is worded.
  it('gates commit wording whatever the markup says, and softens rather than skips for a link', () => {
    const link = element(1, { tagName: 'a', attributes: { href: 'https://order.shop.test/' } });
    link.getAllTextTillNextClickableElement = () => 'Order Now';
    const gatedLink = click(link, { commits: 'none' }, noForm);
    expect(gatedLink?.label).toBe('Order Now');
    expect(gatedLink?.opens).toBe(true);
    expect(gatedLink?.what).toBe('a link');

    // "Place your order" as an <a href>, which the previous gate let through entirely.
    const orderLink = element(1, { tagName: 'a', attributes: { href: '/cart/submit', 'aria-label': 'Place your order' } });
    expect(click(orderLink, { commits: 'none' }, noForm)?.label).toBe('Place your order');

    // aria-expanded="false" on a buy button: disclosure markup on a control that charges.
    const expanded = element(1, { tagName: 'button', attributes: { 'aria-label': 'Buy now', 'aria-expanded': 'false' } });
    expect(click(expanded, { commits: 'none' }, noForm)?.label).toBe('Buy now');

    // An address that commits by being fetched, with innocuous wording.
    const getCommit = element(1, { tagName: 'a', attributes: { href: '/orders/confirm?confirm=yes', 'aria-label': 'Continue' } });
    expect(click(getCommit, { commits: 'none' }, noForm)?.label).toBe('Continue');

    // Ordinary navigation is still ungated: no commit wording, no commit address.
    const plain = element(1, { tagName: 'a', attributes: { href: '/help', 'aria-label': 'Help centre' } });
    expect(click(plain, { commits: 'none' }, noForm)).toBeNull();
    expect(click(element(1, { tagName: 'button', attributes: { 'aria-label': 'Filters', 'aria-haspopup': 'dialog' } }), {}, noForm)).toBeNull();

    // A plain button still gates by wording; a payment form gates whatever the element.
    expect(click(element(1, { tagName: 'button', attributes: { 'aria-label': 'Subscribe' } }), {}, noForm)?.label).toBe('Subscribe');
    const paymentForm: FormCommitInfo = { inForm: true, isSubmitter: true, paymentFields: true, submitLabels: ['Pay now'] };
    expect(click(element(1, { tagName: 'button', attributes: { 'aria-label': 'Pay now', 'aria-expanded': 'false' } }), {}, paymentForm)?.label).toBe('Pay now');
  });

  it('keys a commit by page and label, so the same button needs the same approval', () => {
    const target = click(button('Place order'));
    // "Place order" spends money, so it is a handover rather than a question.
    expect(target).toEqual({
      key: 'shop.test/checkout|place order',
      label: 'Place order',
      place: 'shop.test/checkout',
      what: 'a button',
      handover: true,
      pageWords: true,
    });
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

  /**
   * Two classes, because they carry different liabilities. Spending money or opening an account the agent does not do
   * at all; other account changes are a question the user may well want to answer yes to.
   */
  it('separates what it hands back from what it asks about', () => {
    for (const words of ['Place order', 'Buy now', 'Pay now', 'Complete purchase', 'Confirm and pay', 'Transfer funds']) {
      expect(click(button(words), { commits: 'none' }, noForm)?.handover).toBe(true);
    }
    for (const words of ['Subscribe', 'Start free trial', 'Delete my account']) {
      const target = click(button(words), { commits: 'none' }, noForm);
      expect(target?.label).toBe(words);
      expect(target?.handover).toBeUndefined();
    }
  });

  /**
   * Typing a card, CVC or bank detail is itself what the agent does not do, with or without a submit after it. The form
   * was only ever inspected when an action pressed Enter, so typing a card number alone passed without a look.
   */
  it('hands back on typing into a card field, whether or not it presses Enter', () => {
    const cardField: FormCommitInfo = { inForm: true, isSubmitter: false, paymentFields: true, submitLabels: [], targetIsPaymentField: true };
    const typed = commitTarget('input_text', { index: 3, text: '4242 4242 4242 4242' }, 'https://shop.test/pay', element(3, { tagName: 'input' }), cardField);
    expect(typed?.handover).toBe(true);
    expect(commitTarget('fill_form', { fields: [{ index: 3, value: '4242' }] }, 'https://shop.test/pay', undefined, cardField)?.handover).toBe(true);

    // An ordinary field in the same form is not a card, and typing in it asks nothing.
    const other: FormCommitInfo = { ...cardField, targetIsPaymentField: false };
    expect(commitTarget('input_text', { index: 1, text: 'Alex' }, 'https://shop.test/pay', element(1, { tagName: 'input' }), other)).toBeNull();
  });

  it('hands back on pressing Enter on a payment page, as a click would', () => {
    const payment: FormCommitInfo = { inForm: true, isSubmitter: false, paymentFields: false, submitLabels: [], paymentContext: true };
    expect(commitTarget('fill_form', { fields: [{ index: 1, value: 'x' }], submit: true }, 'https://shop.test/pay', undefined, payment)?.handover).toBe(true);
    expect(commitTarget('input_text', { index: 1, text: 'x', submit: true }, 'https://shop.test/pay', element(1, { tagName: 'input' }), payment)?.handover).toBe(true);
  });

  // Opening an account is in the same class as placing an order: the agent hands the browser back. Live, the sign-up task
  // used to stop and ask "Confirm before I continue: Create account" only when the model happened to flag the button; the
  // wording was in neither list.
  it('hands back on creating an account, by its wording', () => {
    for (const words of ['Create account', 'Create an account', 'Open an account', 'Register an account', 'Sign up for an account', 'Set up your account']) {
      expect(click(button(words), { commits: 'none' }, noForm)?.handover, words).toBe(true);
    }
  });

  // A link that only opens something spends nothing and opens nothing in the user's name, so it stays a question: a login
  // page's "Create account" link, or "Order now" pointing at a menu. Unless the address is itself the commit.
  it('asks, rather than refuses, for a link that only opens a page', () => {
    const link = (text: string, href: string) => {
      const node = element(1, { tagName: 'a', attributes: { href } });
      node.getAllTextTillNextClickableElement = () => text;
      return node;
    };
    const signupLink = click(link('Create account', '/signup'), { commits: 'none' }, noForm);
    expect(signupLink?.label).toBe('Create account');
    expect(signupLink?.opens).toBe(true);
    expect(signupLink?.handover).toBeUndefined();

    // The same wording on an address that is itself the order submit is still refused.
    expect(click(link('Place your order', '/checkout/place-order'), { commits: 'none' }, noForm)?.handover).toBe(true);
  });

  /** A hosted checkout keeps its card field in a frame nobody can read, and labels the submit "Continue". */
  it('hands back on a payment page even with no card field and no commit wording', () => {
    const hosted: FormCommitInfo = {
      inForm: true,
      isSubmitter: true,
      paymentFields: false,
      submitLabels: ['Continue'],
      paymentContext: true,
    };
    const target = click(button('Continue'), { commits: 'none' }, hosted);
    expect(target?.handover).toBe(true);
    expect(handoverNotice(target!)).toContain('I do not place orders, make payments or open accounts');
  });

  it('asks in words no page can write, and never quotes an amount it cannot vouch for', () => {
    const question = commitQuestion({ key: 'k', label: 'Place order', place: 'shop.test/checkout', what: 'a submit button', pageWords: true });
    expect(question).toContain('a submit button on shop.test/checkout that the page labels "Place order"');
    // The label is the page's and is attributed to the page; the identity is read from the markup.
    expect(question).toContain('the page labels');
    // No amount, ever. It used to be the last currency string before the element in the page text, so a hidden
    // "$0.00" ahead of the button made the gate offer a $4,000 order as free.
    expect(question).not.toMatch(/[$€£¥₹]/);
    expect(question).not.toContain('amount shown');

    // A control that may only disclose asks rather than asserts, but it still asks.
    const softened = commitQuestion({ key: 'k', label: 'Order now', place: 'shop.test/menu', what: 'a link', opens: true, pageWords: true });

    // A phrase the system composed is not attributed to the page.
    const composed = commitQuestion({ key: 'k', label: 'Enter, which submits "Place order"', place: 'shop.test/checkout', what: 'an input field' });
    expect(composed).not.toContain('the page labels');
    expect(composed).toContain('"Enter, which submits "Place order"" on shop.test/checkout');
    expect(softened).toContain('may only open a page');
    expect(softened).toContain('Order now');
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

  it('reads the site from the Public Suffix List, private suffixes included', () => {
    const table: Array<[string, string, boolean]> = [
      // Private suffixes: every user's pages are their own site.
      ['alice.github.io', 'bob.github.io', false],
      ['alice.github.io', 'www.alice.github.io', true],
      ['app.vercel.app', 'evil.vercel.app', false],
      ['me.blogspot.com', 'you.blogspot.com', false],
      ['github.io', 'alice.github.io', false],
      // ccTLDs with a second level.
      ['shop.example.co.uk', 'www.example.co.uk', true],
      ['example.co.uk', 'evil.co.uk', false],
      ['a.example.com.au', 'example.com.au', true],
      ['example.com.au', 'other.com.au', false],
      // IPs, localhost, ports, www.
      ['127.0.0.1:3000', '127.0.0.1', true],
      ['localhost:3000', 'localhost:4000', true],
      ['localhost', '127.0.0.1', false],
      ['[::1]:8080', '[::1]', true],
      ['WWW.Example.com', 'example.com:443', true],
      ['example.com', 'michaels.com', false],
    ];
    for (const [a, b, same] of table) expect([a, b, sameSite(a, b)]).toEqual([a, b, same]);
  });

  it('counts the same brand under another public suffix as the same brand, never as the same site', () => {
    expect(sameBrand('www.michaels.com', 'michaels.ca')).toBe(true);
    expect(sameSite('www.michaels.com', 'michaels.ca')).toBe(false);
    expect(sameBrand('shop.example.co.uk', 'example.com')).toBe(true);
    expect(sameBrand('accounts.example.com', 'www.example.com')).toBe(true);
    expect(sameBrand('example.com', 'evil.com')).toBe(false);
    expect(sameBrand('example.com', 'example.com.evil.net')).toBe(false);
    expect(sameBrand('127.0.0.1', '127.0.0.2')).toBe(false);
    expect(sameBrand('localhost', 'localhost.com')).toBe(false);
    expect(sameBrand('', '')).toBe(false);
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

describe('click outcomes that change nothing useful', () => {
  const click = (before: BrowserState, after: BrowserState) =>
    validateActionOutcome({
      actionName: 'click_element',
      actionArgs: { index: 1 },
      before,
      after,
      result: new ActionResult({ executed: true, executionStatus: 'executed', extractedContent: 'You clicked [1]' }),
    });

  it('does not pass a click that only changed the address fragment, and says so', () => {
    const moved = 'https://example.com/start#vignette';
    const result = click(state(), state({ url: moved, tabs: [{ id: 7, url: moved, title: 'Start' }] }));

    expect(result.validated).toBe('unknown');
    expect(result.extractedContent).toContain('only changed the address fragment (none to #vignette)');
    expect(result.failureReason).toContain('Do not count it as progress');
  });

  it('does not pass a reload into the same address and content, but passes one whose content changed', () => {
    const reloaded = state({ selectorMap: new Map([[1, element(1, { backendNodeId: 555 })]]) });
    expect(click(state(), reloaded).validated).toBe('unknown');
    expect(click(state(), reloaded).extractedContent).toContain('same address with the same content');

    const updated = state({ selectorMap: new Map([[1, element(1, { backendNodeId: 555, attributes: { 'aria-label': 'Added' } })]]) });
    expect(click(state(), updated).validated).toBe('passed');
  });
});

describe('revealed controls', () => {
  it('sorts new elements into options, dialog content and new fields, ignoring a re-rendered field', () => {
    const name = element(1, { tagName: 'input', attributes: { 'aria-label': 'Name' } });
    const before = state({ selectorMap: new Map([[1, name]]) });
    const dialog = new DOMElementNode({ tagName: 'div', xpath: null, attributes: { role: 'dialog' }, children: [], isVisible: true });
    const inDialog = element(5, { attributes: { 'aria-label': 'Close' } });
    inDialog.parent = dialog;
    const revealed = [
      element(2, { tagName: 'li', attributes: { role: 'option', 'aria-label': 'Paris' } }),
      element(3, { tagName: 'input', attributes: { 'aria-label': 'Name' }, backendNodeId: 900 }),
      element(4, { tagName: 'input', attributes: { 'aria-label': 'Email' } }),
      inDialog,
      element(6, { tagName: 'a', attributes: { 'aria-label': 'Help' } }),
    ];

    const controls = revealedControls(before, revealed);

    expect(controls.options.map(node => node.highlightIndex)).toEqual([2]);
    expect(controls.fields.map(node => node.highlightIndex)).toEqual([4]);
    expect(controls.dialog.map(node => node.highlightIndex)).toEqual([5]);
    expect(listElements(revealed, 2)).toBe('[2] "Paris", [3] "Name" and 3 more');
  });
});

describe('verification challenges', () => {
  it('recognises challenge widgets by their names, their ancestors and their frames', () => {
    expect(isChallengeElement(element(1, { attributes: { role: 'checkbox', 'aria-label': "I'm not a robot" } }))).toBe(true);
    const frame = new DOMElementNode({
      tagName: 'iframe',
      xpath: null,
      attributes: { 'aria-label': 'Widget containing a Cloudflare security challenge' },
      children: [],
      isVisible: true,
    });
    const inside = element(2, { attributes: { 'aria-label': 'Verify' } });
    inside.parent = frame;
    expect(isChallengeElement(inside)).toBe(true);
    const framed = element(3, { attributes: { 'aria-label': 'Check' } });
    framed.frame = { url: () => 'https://www.google.com/recaptcha/api2/anchor?k=1' } as unknown as DOMElementNode['frame'];
    expect(isChallengeElement(framed)).toBe(true);
    expect(isChallengeElement(element(4, { attributes: { 'aria-label': 'Search' } }))).toBe(false);
    expect(isChallengeElement(undefined)).toBe(false);
  });

  it('finds challenge wording on a page, but not a footer naming a CAPTCHA provider', () => {
    const withText = (text: string) => {
      const root = new DOMElementNode({ tagName: 'body', xpath: '', attributes: {}, children: [], isVisible: true });
      root.children.push(new DOMTextNode(text, true, root));
      return state({ elementTree: root });
    };
    expect(challengeOnPage(withText('Our systems have detected unusual traffic from your computer network.'))).toBe('unusual traffic');
    expect(challengeOnPage(withText('This site is protected by reCAPTCHA and the Google Privacy Policy applies.'))).toBeNull();
  });

  it('recognises questions about a challenge, and compares questions by their words', () => {
    expect(isChallengeQuestion('Could you please solve the CAPTCHA in the browser?')).toBe(true);
    expect(isChallengeQuestion('Which size do you want?')).toBe(false);
    expect(normalizeQuestion('Which colour,  do you want?')).toBe(normalizeQuestion('which colour do you want'));
  });
});

describe('A site the user named themselves', () => {
  it('is recognised by its host, its domain or its own label, whatever suffix it wears', () => {
    expect(taskNamesSite('shop.michaels.com', 'Sign up for Michaels rewards with my email')).toBe(true);
    expect(taskNamesSite('www.michaels.ca', 'order from michaels.com')).toBe(true);
    expect(taskNamesSite('help.test', 'Tell me what help.test says')).toBe(true);
  });

  it('is not recognised from an email address or from a site the user never mentions', () => {
    expect(taskNamesSite('example.com', 'My email is jamie@example.com. What does this article say?')).toBe(false);
    expect(taskNamesSite('collect.test', 'Tell me what the FAQ says')).toBe(false);
  });
});

describe('A criterion typed into a search box', () => {
  const pending = (requirement: string) => ({ requirement, status: 'pending' as const });

  it('is reported for every pending requirement whose value the query repeats', () => {
    const carried = requirementsInQuery('red running shoes under 50', [pending('price under $50'), pending('colour red'), pending('free delivery')]);
    expect(carried.map(item => item.requirement)).toEqual(['price under $50', 'colour red']);
  });

  it('is not reported for a requirement already applied, nor for a query that is only the criterion', () => {
    expect(requirementsInQuery('red running shoes', [{ requirement: 'colour red', status: 'applied' }])).toEqual([]);
    expect(requirementsInQuery('4 stars', [pending('rating 4 stars and up')])).toEqual([]);
    expect(requirementsInQuery('running shoes', [pending('price under $50')])).toEqual([]);
  });
});

describe('Text typed into a field that offers suggestions', () => {
  const field = (attributes: Record<string, string>) => element(1, { attributes: { role: 'combobox', 'aria-label': 'City', ...attributes } });
  const entry = { key: ':101', label: 'City', text: 'Paris', options: ['Paris, France', 'Paris, Texas'], url: 'https://travel.test/search' };
  const page = (node: DOMElementNode, url = entry.url) => state({ selectorMap: new Map([[1, node]]), url });

  it('counts as taken once a suggestion is chosen', () => {
    const option = element(2, { attributes: { role: 'option', 'aria-label': 'Paris, France' } });
    expect(suggestionCommitted(entry, page(field({})), option)).toBe(true);
    expect(suggestionCommitted(entry, page(field({})), element(3, { attributes: { 'aria-label': 'Search' } }))).toBe(false);
  });

  it('counts as taken when the list closed on an option, or the address gained a parameter', () => {
    expect(suggestionCommitted(entry, page(field({ 'aria-expanded': 'false', value: 'Paris, France' })))).toBe(true);
    expect(suggestionCommitted(entry, page(field({ 'aria-expanded': 'true', value: 'Paris, France' })))).toBe(false);
    expect(suggestionCommitted(entry, page(field({ value: 'Paris' }), 'https://travel.test/search?city=paris'))).toBe(true);
  });

  it('stays untaken while the field only holds what was typed', () => {
    expect(suggestionCommitted(entry, page(field({ value: 'Paris' })))).toBe(false);
  });
});

describe('An action refused before it is dispatched', () => {
  it('names the fix and hands back the elements named like the one it could not use', () => {
    const current = state({
      selectorMap: new Map([
        [2, element(2, { attributes: { 'aria-label': 'Apply filters' } })],
        [3, element(3, { attributes: { 'aria-label': 'Reset' } })],
      ]),
    });
    const chosen = element(9, { attributes: { 'aria-label': 'Apply filters' } });

    const candidates = namedLike(chosen, current);
    expect(candidates.map(node => node.highlightIndex)).toEqual([2]);

    const refusal = staleIndexResult(9, 'obs-1', candidates);
    expect(refusal.extractedContent).toContain('[9] is not on the current page; the list below is current.');
    expect(refusal.extractedContent).toContain('Elements named like it on the current page: [2] "Apply filters"');
    expect(refusal.executed).toBe(false);
  });

  it('leaves the fix general when nothing on the page carries that name', () => {
    expect(namedLike(element(9, { attributes: { 'aria-label': 'Apply filters' } }), state())).toEqual([]);
    expect(staleIndexResult(9, 'obs-1').extractedContent).toContain('open the section, menu or dialog that holds it first');
  });

  it('names the guard behind every actionability refusal, and lets the rest through', () => {
    expect(dispatchGuard('The element is covered by <div> "Cookie choices"')).toBe('covered');
    expect(dispatchGuard('The element has no visible area: it is hidden')).toBe('invisible');
    expect(dispatchGuard('The element is still moving (an animation, a sliding panel or a list still loading).')).toBe('moving');
    expect(dispatchGuard('The element is disabled: the page turns it on once')).toBe('disabled');
    expect(dispatchGuard('The field is read-only: the page fills it through its own control')).toBe('read-only');
    expect(dispatchGuard('That element is no longer available: the page replaced it')).toBe('stale-index');
    expect(dispatchGuard('net::ERR_CONNECTION_RESET')).toBeNull();
  });

  it("counts a target that will not hold still as the page's doing, not the agent's", () => {
    expect(isPageSideError('The element is still moving (an animation, a sliding panel or a list still loading).')).toBe(true);
  });
});

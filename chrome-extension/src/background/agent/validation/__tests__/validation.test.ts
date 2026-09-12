import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../types';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import type { BrowserState } from '../../../browser/views';
import { createBrowserObservation } from '../observation';
import { normalizeIndexedAction, validateActionOutcome } from '../service';

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

  it('passes scroll_to_percent when the page is already within 2px of the target', () => {
    const at = (scrollY: number) => state({ scrollY, scrollHeight: 1500, visualViewportHeight: 500 });

    const result = validateActionOutcome({
      actionName: 'scroll_to_percent',
      actionArgs: { yPercent: 50 },
      before: at(501),
      after: at(501),
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });
    const missed = validateActionOutcome({
      actionName: 'scroll_to_percent',
      actionArgs: { yPercent: 50 },
      before: at(100),
      after: at(100),
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(result.validated).toBe('passed');
    expect(missed.validated).toBe('failed');
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

  it('validates typed text by read-back without keeping the text as evidence', () => {
    const field = (attributes: Record<string, string>) =>
      state({ selectorMap: new Map([[1, element(1, { tagName: 'input', attributes })]]) });
    const validate = (after: BrowserState, text = 'hello') => validateActionOutcome({
      actionName: 'input_text',
      actionArgs: { index: 1, text },
      before: field({ value: '' }),
      after,
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    });

    expect(validate(field({ value: 'hello' })).validated).toBe('passed');
    expect(validate(field({ value: '' })).validated).toBe('failed');
    expect(validate(field({ value: 'HELLO!' })).validated).toBe('unknown');
    expect(validate(field({})).validated).toBe('unknown');
    // A password field reads back as mask characters.
    const password = validate(field({ value: '••••••••' }), 'S3cret!!');
    expect(password.validated).toBe('passed');
    expect(JSON.stringify(password)).not.toContain('S3cret!!');
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

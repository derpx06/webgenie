import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../types';
import { DOMElementNode } from '../../../browser/dom/views';
import type { BrowserState } from '../../../browser/views';
import { createBrowserObservation, fingerprintFailureKey } from '../observation';
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

  it('uses stable target fingerprint keys instead of generic tag names', () => {
    const observation = createBrowserObservation(state(), 1000);
    const key = fingerprintFailureKey(observation.targets[0], 'https://example.com/start');

    expect(key).toContain('https://example.com/start');
    expect(key).toContain('backend:101');
    expect(key).not.toBe('https://example.com/start|button');
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

  it('blocks stale observation ids before execution', () => {
    const observation = createBrowserObservation(state(), 1000);

    const result = normalizeIndexedAction('click_element', { index: 1, observationId: 'old' }, observation);

    expect(result.ok).toBe(false);
    expect(result.actionResult?.validated).toBe('unknown');
    expect(result.actionResult?.retryability).toBe('retry_reobserve');
  });
});

describe('action outcome validation', () => {
  it('passes click validation on URL change and fails a true no-op click', () => {
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
    expect(fail.validated).toBe('failed');
    expect(fail.retryability).toBe('replan');
  });

  it('passes input validation only when post-action read-back matches', () => {
    const before = state({
      selectorMap: new Map([[1, element(1, { tagName: 'input', attributes: { value: '' } })]]),
    });
    const after = state({
      selectorMap: new Map([[1, element(1, { tagName: 'input', attributes: { value: 'hello' } })]]),
    });
    const mismatch = state({
      selectorMap: new Map([[1, element(1, { tagName: 'input', attributes: { value: 'bye' } })]]),
    });

    expect(validateActionOutcome({
      actionName: 'input_text',
      actionArgs: { index: 1, text: 'hello' },
      before,
      after,
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    }).validated).toBe('passed');
    expect(validateActionOutcome({
      actionName: 'input_text',
      actionArgs: { index: 1, text: 'hello' },
      before,
      after: mismatch,
      result: new ActionResult({ executed: true, executionStatus: 'executed' }),
    }).validated).toBe('failed');
  });

  it('rejects successful done after unresolved unknown or failed mutating actions', () => {
    const rejected = validateActionOutcome({
      actionName: 'done',
      actionArgs: { success: true, text: 'finished' },
      before: state(),
      after: state(),
      result: new ActionResult({ isDone: true, executed: true, executionStatus: 'executed' }),
      recentResults: [new ActionResult({ executed: true, validated: 'unknown', retryability: 'retry_reobserve' })],
    });

    expect(rejected.validated).toBe('failed');
    expect(rejected.retryability).toBe('replan');
  });
});

import { describe, expect, it } from 'vitest';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import type { BrowserState } from '../../../browser/views';
import { createBrowserObservation } from '../observation';
import { validateActionOutcome } from '../service';
import { ActionResult } from '../../types';

function page({ scrollY = 0, status = 'Not saved', top = 10 }: { scrollY?: number; status?: string; top?: number } = {}): BrowserState {
  const body = new DOMElementNode({ tagName: 'body', xpath: '/body', attributes: {}, children: [], isVisible: true });
  const button = new DOMElementNode({
    tagName: 'button',
    xpath: '/body/button',
    attributes: {},
    children: [],
    isVisible: true,
    isInteractive: true,
    highlightIndex: 0,
    backendNodeId: 7,
    parent: body,
    viewportCoordinates: { topLeft: { x: 10, y: top }, center: { x: 50, y: top + 10 }, width: 80, height: 20 } as never,
  });
  button.children.push(new DOMTextNode('Save', true, button));
  body.children.push(button, new DOMTextNode(status, true, body));
  return {
    tabId: 1,
    url: 'https://example.test/editor',
    title: 'Editor',
    elementTree: body,
    selectorMap: new Map([[0, button]]),
    scrollY,
    scrollHeight: 2000,
    visualViewportHeight: 800,
    tabs: [],
    screenshot: null,
  } as unknown as BrowserState;
}

describe('contentFingerprint', () => {
  it('ignores scrolling and element positions, which a click that scrolls its target into view always changes', () => {
    const before = createBrowserObservation(page());
    const scrolled = createBrowserObservation(page({ scrollY: 400, top: -390 }));
    expect(scrolled.layoutFingerprint).not.toBe(before.layoutFingerprint);
    expect(scrolled.contentFingerprint).toBe(before.contentFingerprint);
  });

  it('changes when the page says something new', () => {
    const before = createBrowserObservation(page());
    const saved = createBrowserObservation(page({ status: 'Saved: hello' }));
    expect(saved.contentFingerprint).not.toBe(before.contentFingerprint);
  });

  it('does not count a click that only scrolled its target into view as working', () => {
    const click = (after: BrowserState) =>
      validateActionOutcome({
        actionName: 'click_element',
        actionArgs: { index: 0 },
        before: page(),
        after,
        result: new ActionResult({ executed: true, executionStatus: 'executed' }),
      }).validated;
    expect(click(page({ scrollY: 400, top: -390 }))).toBe('unknown');
    expect(click(page({ scrollY: 400, top: -390, status: 'Saved: hello' }))).toBe('passed');
  });
});

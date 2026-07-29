import { describe, expect, it } from 'vitest';
import { DOMElementNode, type DOMState } from '../../../browser/dom/views';
import { ContextRouter } from '../global/context-router';

function createState(elementCount: number): DOMState {
  const root = new DOMElementNode({
    tagName: 'DIV',
    xpath: '/div',
    attributes: {},
    children: [],
    isVisible: true,
    isInViewport: true,
  });
  const selectorMap = new Map<number, DOMElementNode>();

  for (let index = 0; index < elementCount; index++) {
    const isRelevant = index < 15;
    const element = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: `/div/button[${index + 1}]`,
      attributes: { 'aria-label': isRelevant ? `target action ${index}` : `unrelated action ${index}` },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: index,
      parent: root,
    });
    root.children.push(element);
    selectorMap.set(index, element);
  }

  return {
    elementTree: root,
    selectorMap,
  };
}

describe('ContextRouter attention mask', () => {
  it('keeps selectorMap aligned with indexes still visible to the navigator', () => {
    const state = createState(30);

    ContextRouter.applyAttentionMask(state, 'target');

    expect(state.selectorMap.size).toBeLessThan(30);
    expect([...state.selectorMap.entries()].every(([index, element]) => element.highlightIndex === index)).toBe(true);
    expect([...state.selectorMap.values()].every(element => element.highlightIndex !== null)).toBe(true);
  });

  it('compacts indexes when the relevant elements are later in the DOM', () => {
    const state = createState(30);
    let index = 0;
    for (const element of state.selectorMap.values()) {
      element.attributes['aria-label'] = index >= 15 ? `target action ${index}` : `unrelated action ${index}`;
      index++;
    }

    ContextRouter.applyAttentionMask(state, 'target');

    expect([...state.selectorMap.keys()]).toEqual([...Array(state.selectorMap.size).keys()]);
    expect([...state.selectorMap.entries()].every(([key, element]) => element.highlightIndex === key)).toBe(true);
  });
});

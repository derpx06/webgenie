import { describe, it, expect } from 'vitest';
import { pruneAXTree } from '../ax-tree-pruner';
import { DOMElementNode, DOMTextNode } from '../views';
import type { DOMState } from '../views';

describe('AXTreePruner V2 - Goal-Directed Pruning', () => {
  it('should keep interactive in-viewport elements even if they do not match the goal', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });

    const child = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button',
      attributes: { 'aria-label': 'unrelated label' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 1,
      parent: root,
    });
    root.children.push(child);

    const selectorMap = new Map<number, DOMElementNode>([[1, child]]);
    const state: DOMState = {
      elementTree: root,
      selectorMap,
    };

    const pruned = pruneAXTree(state, 'Search shipping cost');
    expect(pruned.selectorMap.has(1)).toBe(true);
    expect(child.highlightIndex).toBe(1);
  });

  it('should keep off-screen interactive elements that match the goal', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });

    const child = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button',
      attributes: { 'aria-label': 'Check shipping cost details' },
      children: [],
      isVisible: true,
      isInViewport: false,
      highlightIndex: 2,
      parent: root,
    });
    root.children.push(child);

    const selectorMap = new Map<number, DOMElementNode>([[2, child]]);
    const state: DOMState = {
      elementTree: root,
      selectorMap,
    };

    const pruned = pruneAXTree(state, 'Find the shipping cost');
    expect(pruned.selectorMap.has(2)).toBe(true);
    expect(child.highlightIndex).toBe(2);
  });

  it('should prune off-screen interactive elements that do not match the goal', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });

    // Supply pageCoordinates to simulate a *confirmed* off-screen element.
    // Without coordinates the pruner cannot know the element is off-screen
    // (getBoxModel may have simply failed), so it leaves the element alone.
    const offscreenCoords = {
      topLeft: { x: 0, y: 5000 }, topRight: { x: 100, y: 5000 },
      bottomLeft: { x: 0, y: 5050 }, bottomRight: { x: 100, y: 5050 },
      center: { x: 50, y: 5025 }, width: 100, height: 50,
    };

    const child = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button',
      attributes: { 'aria-label': 'Random unrelated stuff' },
      children: [],
      isVisible: true,
      isInViewport: false,
      highlightIndex: 3,
      parent: root,
      pageCoordinates: offscreenCoords,
    });
    root.children.push(child);

    const selectorMap = new Map<number, DOMElementNode>([[3, child]]);
    const state: DOMState = {
      elementTree: root,
      selectorMap,
    };

    const pruned = pruneAXTree(state, 'Find the shipping cost');
    // It should be pruned from selectorMap and its highlightIndex set to null/or return false (so removed from children)
    expect(pruned.selectorMap.has(3)).toBe(false);
    expect(root.children.includes(child)).toBe(false);
  });

  it('should keep off-screen interactive elements if their child text matches the goal', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });

    const child = new DOMElementNode({
      tagName: 'A',
      xpath: '/div/a',
      attributes: {},
      children: [],
      isVisible: true,
      isInViewport: false,
      highlightIndex: 4,
      parent: root,
    });
    const textNode = new DOMTextNode('Checkout shipping options', true, child);
    child.children.push(textNode);
    root.children.push(child);

    const selectorMap = new Map<number, DOMElementNode>([[4, child]]);
    const state: DOMState = {
      elementTree: root,
      selectorMap,
    };

    const pruned = pruneAXTree(state, 'Find shipping cost');
    expect(pruned.selectorMap.has(4)).toBe(true);
  });

  it('should keep off-screen interactive elements if their custom attributes match the goal', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });

    const child = new DOMElementNode({
      tagName: 'A',
      xpath: '/div/a',
      attributes: { href: '/billing-details' },
      children: [],
      isVisible: true,
      isInViewport: false,
      highlightIndex: 5,
      parent: root,
    });
    root.children.push(child);

    const selectorMap = new Map<number, DOMElementNode>([[5, child]]);
    const state: DOMState = {
      elementTree: root,
      selectorMap,
    };

    const pruned = pruneAXTree(state, 'Enter billing address');
    expect(pruned.selectorMap.has(5)).toBe(true);
  });
});

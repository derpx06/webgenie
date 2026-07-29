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
    expect(pruned.selectorMap.has(0)).toBe(true);
    expect(child.highlightIndex).toBe(0);
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
    expect(pruned.selectorMap.has(0)).toBe(true);
    expect(child.highlightIndex).toBe(0);
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
    const childInViewport = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button2',
      attributes: { 'aria-label': 'In viewport stuff' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 4,
      parent: root,
    });
    root.children.push(child, childInViewport);

    const selectorMap = new Map<number, DOMElementNode>([[3, child], [4, childInViewport]]);
    const state: DOMState = {
      elementTree: root,
      selectorMap,
    };

    const pruned = pruneAXTree(state, 'Find the shipping cost');
    // It should be pruned from selectorMap and its highlightIndex set to null/or return false (so removed from children)
    expect(pruned.selectorMap.has(3)).toBe(false);
    expect(root.children.includes(child)).toBe(false);
    expect(pruned.selectorMap.has(0)).toBe(true);
    expect(childInViewport.highlightIndex).toBe(0);
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
    expect(pruned.selectorMap.has(0)).toBe(true);
    expect(child.highlightIndex).toBe(0);
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
    expect(pruned.selectorMap.has(0)).toBe(true);
    expect(child.highlightIndex).toBe(0);
  });

  it('should attach orphaned selectorMap nodes before rebuilding so pruning cannot empty a valid AX selector map', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });

    // AX extraction can produce this shape when Chrome marks a parent as
    // ignored: the interactive node is valid and selectable, but not reachable
    // from the retained elementTree root. Pruning must not drop it.
    const orphanedButton = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: null,
      attributes: { 'aria-label': 'Search' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 7,
      parent: null,
      backendNodeId: 777,
    });

    const state: DOMState = {
      elementTree: root,
      selectorMap: new Map([[7, orphanedButton]]),
    };

    const pruned = pruneAXTree(state, 'follow sam altman on twitter');

    expect(pruned.selectorMap.has(0)).toBe(true);
    expect(root.children).toContain(orphanedButton);
    expect(orphanedButton.parent).toBe(root);
    expect(orphanedButton.highlightIndex).toBe(0);
    expect(pruned.elementTree.clickableElementsToString()).toContain('[0]<BUTTON');
  });

  it('should compact surviving highlight indexes after pruning', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });
    const first = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button[1]',
      attributes: { 'aria-label': 'Follow @sama' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 42,
      parent: root,
    });
    const second = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button[2]',
      attributes: { 'aria-label': 'Search' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 99,
      parent: root,
    });
    root.children.push(first, second);

    const pruned = pruneAXTree({
      elementTree: root,
      selectorMap: new Map([[42, first], [99, second]]),
    });

    expect([...pruned.selectorMap.keys()]).toEqual([0, 1]);
    expect(first.highlightIndex).toBe(0);
    expect(second.highlightIndex).toBe(1);
    expect(pruned.elementTree.clickableElementsToString()).toContain('[0]<BUTTON');
    expect(pruned.elementTree.clickableElementsToString()).toContain('[1]<BUTTON');
  });
});

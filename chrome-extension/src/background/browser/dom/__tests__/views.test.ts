import { describe, it, expect } from 'vitest';
import { DOMElementNode } from '../views';

describe('DOM Views Serialization Refinements', () => {
  it('should serialize off-screen elements with offscreen="true"', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });

    const button = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button',
      attributes: {},
      children: [],
      isVisible: true,
      isInViewport: false,
      highlightIndex: 1,
      parent: root,
    });
    root.children.push(button);

    const serialized = root.clickableElementsToString();
    expect(serialized).toContain('offscreen="true"');
  });

  it('should omit redundant role for native tags but keep non-redundant roles', () => {
    const root = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div',
      attributes: {},
      children: [],
      isVisible: true,
    });

    const nativeBtn = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button',
      attributes: { role: 'button' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 1,
      parent: root,
    });

    const customBtn = new DOMElementNode({
      tagName: 'DIV',
      xpath: '/div/div',
      attributes: { role: 'button' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 2,
      parent: root,
    });

    const linkEl = new DOMElementNode({
      tagName: 'A',
      xpath: '/div/a',
      attributes: { role: 'link', href: '/test' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 3,
      parent: root,
    });

    const listItem = new DOMElementNode({
      tagName: 'LI',
      xpath: '/div/li',
      attributes: { role: 'listitem' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 4,
      parent: root,
    });

    root.children.push(nativeBtn, customBtn, linkEl, listItem);

    const serialized = root.clickableElementsToString();
    
    // BUTTON with role="button" should have the role omitted
    expect(serialized).not.toContain('button role="button"');
    expect(serialized).toContain('[1]<BUTTON />');

    // DIV with role="button" should retain role="button"
    expect(serialized).toContain('[2]<DIV role="button" />');

    // A with role="link" should have the role omitted but keep href
    expect(serialized).not.toContain('role="link"');
    expect(serialized).toContain('[3]<A href="/test" />');

    // LI with role="listitem" should have the role omitted
    expect(serialized).not.toContain('role="listitem"');
    expect(serialized).toContain('[4]<LI />');
  });

  it('should preserve backendNodeId on DOMElementNode instances', () => {
    const node = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button',
      attributes: {},
      children: [],
      isVisible: true,
      backendNodeId: 42,
    });
    expect(node.backendNodeId).toBe(42);
  });
});

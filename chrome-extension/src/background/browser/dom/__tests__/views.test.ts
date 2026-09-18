import { describe, it, expect } from 'vitest';
import { capHref, DOMElementNode, DOMTextNode } from '../views';

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

  it('marks a control the page says is disabled', () => {
    const root = new DOMElementNode({ tagName: 'DIV', xpath: '/div', attributes: {}, children: [], isVisible: true });
    const off = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button[1]',
      attributes: { 'aria-disabled': 'true' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 1,
      parent: root,
    });
    const native = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button[2]',
      attributes: { disabled: '' },
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 2,
      parent: root,
    });
    const on = new DOMElementNode({
      tagName: 'BUTTON',
      xpath: '/div/button[3]',
      attributes: {},
      children: [],
      isVisible: true,
      isInViewport: true,
      highlightIndex: 3,
      parent: root,
    });
    root.children.push(off, native, on);

    const lines = root.clickableElementsToString().split('\n');

    expect(lines[0]).toContain('disabled="true"');
    expect(lines[0]).not.toContain('aria-disabled');
    expect(lines[1]).toContain('disabled="true"');
    expect(lines[2]).not.toContain('disabled');
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

describe('heading text', () => {
  it('marks heading text with its level and leaves other text plain', () => {
    const root = new DOMElementNode({ tagName: 'div', xpath: '', attributes: {}, children: [], isVisible: true, isTopElement: true });
    const heading = new DOMElementNode({ tagName: 'h1', xpath: '', attributes: {}, children: [], isVisible: true, isTopElement: true, parent: root });
    heading.children.push(new DOMTextNode('All products', true, heading));
    const paragraph = new DOMElementNode({ tagName: 'p', xpath: '', attributes: {}, children: [], isVisible: true, isTopElement: true, parent: root });
    paragraph.children.push(new DOMTextNode('Books to Scrape', true, paragraph));
    root.children.push(heading, paragraph);

    const lines = root.clickableElementsToString().split('\n').map(line => line.trim());
    expect(lines).toContain('# All products');
    expect(lines).toContain('Books to Scrape');
  });
});

describe('long addresses on an element line', () => {
  const long = 'https://shop.test/catalogue/category/books/mystery_3/index.html?sort=price_asc&page=2&rating=5';

  it('keep the start and the query, and cut the middle of the path', () => {
    const capped = capHref(long);

    expect(capped).toBe('https://shop.test/catalo....html?sort=price_asc&page=2&rating=5');
    expect(capped).toContain('rating=5');
    expect(capped.length).toBeLessThanOrEqual(63);
  });

  it('cut the end of an address with no query, and leave a short one alone', () => {
    expect(capHref('https://shop.test/catalogue/category/books/mystery_3/index.html')).toBe('https://shop.test/catalogue/category/books/mystery_3/index.h...');
    expect(capHref('/catalogue/books/1')).toBe('/catalogue/books/1');
  });

  it('shortens the href on the element line', () => {
    const link = new DOMElementNode({ tagName: 'a', xpath: '/a', attributes: { href: long }, children: [], isVisible: true, isInteractive: true, isTopElement: true, isInViewport: true, highlightIndex: 0 });

    expect(link.clickableElementsToString(['href'])).toContain('href="https://shop.test/catalo....html?sort=price_asc&page=2&rating=5"');
  });
});

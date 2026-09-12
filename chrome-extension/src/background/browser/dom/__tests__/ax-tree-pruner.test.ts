import { describe, expect, it } from 'vitest';
import { pruneAXTree } from '../ax-tree-pruner';
import { DOMElementNode, DOMTextNode } from '../views';

function el(attributes: Record<string, string>, children: Array<DOMElementNode | DOMTextNode> = [], highlightIndex: number | null = null) {
  const node = new DOMElementNode({ tagName: 'div', xpath: null, attributes, children: [], isVisible: true, isTopElement: true, highlightIndex });
  for (const child of children) {
    child.parent = node;
    node.children.push(child);
  }
  return node;
}

describe('pruneAXTree', () => {
  it('drops empty non-interactive wrappers but keeps text-only wrappers', () => {
    const empty = el({ role: 'generic' });
    const price = el({ role: 'generic' }, [new DOMTextNode('Price: $5', true)]);
    const root = el({}, [empty, price, el({ role: 'button' }, [], 7)]);

    const state = pruneAXTree({ elementTree: root, selectorMap: new Map() });

    expect(root.children).not.toContain(empty);
    expect(root.children).toContain(price);
    expect(state.elementTree.clickableElementsToString()).toContain('Price: $5');
  });

  it('keeps repeated interactive siblings and renumbers them in document order', () => {
    const first = el({ role: 'button', 'aria-label': 'Delete' }, [], 5);
    const second = el({ role: 'button', 'aria-label': 'Delete' }, [], 9);
    const root = el({}, [el({ role: 'list' }, [first]), second]);

    const state = pruneAXTree({ elementTree: root, selectorMap: new Map() });

    expect([...state.selectorMap.entries()]).toEqual([[0, first], [1, second]]);
  });

  it('never truncates values and marks single-element wrappers collapsible', () => {
    const long = 'x'.repeat(300);
    const input = el({ role: 'textbox', value: long }, [], 0);
    const wrapper = el({ role: 'generic' }, [input]);
    const root = el({}, [wrapper]);

    pruneAXTree({ elementTree: root, selectorMap: new Map() });

    expect(input.attributes.value).toBe(long);
    expect(wrapper.attributes._collapsible).toBe('true');
  });
});

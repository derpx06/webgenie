import { describe, expect, it } from 'vitest';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import { actionSignature, LOOP_WINDOW, loopNudge } from '../service';

function button(index: number, label: string, role = 'button') {
  const node = new DOMElementNode({
    tagName: 'button',
    xpath: `/html/body/button[${index}]`,
    attributes: { role },
    children: [],
    isVisible: true,
    isInteractive: true,
    highlightIndex: index,
    backendNodeId: 100 + index,
  });
  node.children.push(new DOMTextNode(label, true, node));
  return node;
}

describe('The same move, read off different actions', () => {
  it('is one signature for a click on the same element whatever index it has now', () => {
    const first = actionSignature('click_element', { index: 4 }, button(4, 'Next page'));
    const again = actionSignature('click_element', { index: 17 }, button(17, 'Next page'));
    const other = actionSignature('click_element', { index: 4 }, button(4, 'Previous page'));

    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it('is one signature for the same page whatever item its path names', () => {
    const list = actionSignature('go_to_url', { url: 'https://shop.test/product/1234?ref=a' });
    const another = actionSignature('go_to_url', { url: 'https://shop.test/product/9876' });

    expect(another).toBe(list);
    expect(actionSignature('go_to_url', { url: 'https://shop.test/cart' })).not.toBe(list);
  });

  it('is one signature for a search for the same words in another order', () => {
    expect(actionSignature('search_web', { query: 'red running shoes' })).toBe(actionSignature('search_web', { query: 'shoes running RED' }));
    expect(actionSignature('input_text', { index: 1, text: 'Paris France' }, button(1, 'City', 'combobox'))).toBe(
      actionSignature('input_text', { index: 6, text: 'france  paris' }, button(6, 'City', 'combobox')),
    );
  });
});

describe('The nudge a loop earns', () => {
  it('comes at 5, 8 and 12 repeats and at no other count', () => {
    expect(loopNudge(4, 0)).toBeNull();
    expect(loopNudge(5, 0)).toContain(`same move 5 times in your last ${LOOP_WINDOW} actions`);
    expect(loopNudge(6, 0)).toBeNull();
    expect(loopNudge(8, 0)).toContain('Change the approach');
    expect(loopNudge(12, 0)).toContain('done (success: false)');
  });

  it('comes for a page that will not change, too', () => {
    expect(loopNudge(1, 5)).toContain('has not changed over your last 5 actions');
    expect(loopNudge(1, 7)).toBeNull();
    expect(loopNudge(1, 12)).toContain('Stop repeating it');
  });
});

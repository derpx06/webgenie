import { describe, expect, it } from 'vitest';
import { actionKind, MAX_GOAL_CHARS, presenceMessage } from '../presence';
import { DOMElementNode } from '../../../../browser/dom/views';

const node = (over: Partial<ConstructorParameters<typeof DOMElementNode>[0]> = {}) =>
  new DOMElementNode({
    tagName: 'button',
    xpath: null,
    attributes: {},
    children: [],
    isVisible: true,
    isInteractive: true,
    isTopElement: true,
    viewportCoordinates: {
      topLeft: { x: 40, y: 90 },
      topRight: { x: 160, y: 90 },
      bottomLeft: { x: 40, y: 126 },
      bottomRight: { x: 160, y: 126 },
      center: { x: 100, y: 108 },
      width: 120,
      height: 36,
    },
    cornerRadius: 18,
    ...over,
  });

describe('actionKind', () => {
  it('groups every tool into something the overlay can draw', () => {
    expect(actionKind('click_element')).toBe('click');
    expect(actionKind('select_dropdown_option')).toBe('click');
    expect(actionKind('input_text')).toBe('type');
    expect(actionKind('scroll')).toBe('scroll');
    expect(actionKind('go_to_url')).toBe('scroll');
    expect(actionKind('wait_for')).toBe('wait');
    expect(actionKind('ask_human')).toBe('ask');
    expect(actionKind('done')).toBe('done');
  });

  it('shows an unlisted or brand new tool as the agent reading the page', () => {
    expect(actionKind('get_complete_page_content')).toBe('read');
    expect(actionKind('some_tool_added_later')).toBe('read');
  });
});

describe('presenceMessage', () => {
  it('sends the element box in viewport pixels with its own corner radius', () => {
    const message = presenceMessage('click_element', node(), 'Open the cart');
    expect(message).toEqual({
      type: 'AGENT_ACTION',
      kind: 'click',
      rect: { x: 40, y: 90, w: 120, h: 36, r: 18 },
      goal: 'Open the cart',
    });
  });

  it('sends no box for an action with no element, or one with no measured size', () => {
    expect(presenceMessage('wait', undefined, 'Let the page settle').rect).toBeUndefined();
    const flat = node({ viewportCoordinates: { ...node().viewportCoordinates!, width: 0, height: 0 } });
    expect(presenceMessage('click_element', flat, undefined).rect).toBeUndefined();
  });

  it('squares up a goal and cuts it to what the chip holds', () => {
    expect(presenceMessage('scroll', undefined, '  Find   the\nprice ').goal).toBe('Find the price');
    const long = presenceMessage('scroll', undefined, 'g'.repeat(200)).goal;
    expect(long).toHaveLength(MAX_GOAL_CHARS);
  });

  it('sends no goal rather than an empty one', () => {
    expect(presenceMessage('scroll', undefined, '   ').goal).toBeUndefined();
    expect(presenceMessage('scroll', undefined, undefined).goal).toBeUndefined();
  });

  it('carries nothing but the kind, the box and the goal', () => {
    expect(Object.keys(presenceMessage('input_text', node(), 'Type the city')).sort()).toEqual([
      'goal',
      'kind',
      'rect',
      'type',
    ]);
  });
});

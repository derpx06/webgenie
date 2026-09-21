import { describe, expect, it } from 'vitest';
import { actionKind, actionLabel, MAX_GOAL_CHARS, presenceMessage } from '../presence';
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
      // The chip says what is happening now; the planner's goal is only the fallback (see the chip tests below).
      goal: 'Clicking',
    });
  });

  it('sends no box for an action with no element, or one with no measured size', () => {
    expect(presenceMessage('wait', undefined, 'Let the page settle').rect).toBeUndefined();
    const flat = node({ viewportCoordinates: { ...node().viewportCoordinates!, width: 0, height: 0 } });
    expect(presenceMessage('click_element', flat, undefined).rect).toBeUndefined();
  });

  it('squares up a fallback goal and cuts it to what the chip holds', () => {
    expect(presenceMessage('some_new_tool', undefined, '  Find   the\nprice ').goal).toBe('Find the price');
    const long = presenceMessage('some_new_tool', undefined, 'g'.repeat(200)).goal;
    expect(long).toHaveLength(MAX_GOAL_CHARS);
  });

  it('sends no line rather than an empty one', () => {
    expect(presenceMessage('some_new_tool', undefined, '   ').goal).toBeUndefined();
    expect(presenceMessage('some_new_tool', undefined, undefined).goal).toBeUndefined();
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

/**
 * The chip under the cursor. It used to carry the planner's goal, which only changes when the planner re-plans, so it
 * described a step the agent had finished several steps before — an outdated line beside a cursor doing something else.
 */
describe('what the chip says the agent is doing', () => {
  const named = (label: string) => node({ attributes: { 'aria-label': label } });

  it('names the action and the element it is on', () => {
    expect(actionLabel('click_element', named('Compare Breeds'), 'find a breed')).toBe('Clicking “Compare Breeds”');
    expect(actionLabel('input_text', named('Search'), 'find a breed')).toBe('Typing in “Search”');
    expect(actionLabel('select_dropdown_option', named('Size'), undefined)).toBe('Choosing in “Size”');
  });

  it('describes an action with no element by what it does', () => {
    expect(actionLabel('scroll', undefined, 'find a breed')).toBe('Scrolling');
    expect(actionLabel('read_page', undefined, 'find a breed')).toBe('Reading the page');
    expect(actionLabel('ask_human', undefined, undefined)).toBe('Asking you');
  });

  it('falls back to the planner goal only for an action it has no words for', () => {
    expect(actionLabel('some_new_tool', undefined, 'find an obedience trial')).toBe('find an obedience trial');
    expect(actionLabel('some_new_tool', undefined, undefined)).toBeUndefined();
  });

  it('never carries a typed value, only what the page already shows', () => {
    const label = actionLabel('input_text', named('Password'), 'sign in');
    expect(label).toBe('Typing in “Password”');
    expect(label).not.toContain('hunter2');
  });

  it('stays within the chip', () => {
    const long = actionLabel('click_element', named('A'.repeat(200)), undefined) ?? '';
    expect(long.length).toBeLessThanOrEqual(MAX_GOAL_CHARS);
  });

  it('puts the action on the message, not the stale goal', () => {
    expect(presenceMessage('click_element', named('Apply filters'), 'find the cheapest room').goal).toBe('Clicking “Apply filters”');
  });
});

describe('where the cursor is told the element is', () => {
  it('prefers the box the caller read just now over the one from the page read', () => {
    const fresh = { x: 1027, y: 562, w: 291, h: 56 };
    const message = presenceMessage('click_element', node(), 'a goal', fresh);
    expect(message.rect).toEqual({ ...fresh, r: 18 });
  });

  it('falls back to the page read when no fresh box is available', () => {
    expect(presenceMessage('click_element', node(), 'a goal').rect).toEqual({ x: 40, y: 90, w: 120, h: 36, r: 18 });
  });

  it('has no box at all for an action on nothing', () => {
    expect(presenceMessage('scroll', undefined, 'a goal').rect).toBeUndefined();
  });
});

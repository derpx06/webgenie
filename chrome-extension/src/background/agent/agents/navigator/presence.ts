/**
 * What the page's presence overlay is told before each navigator action: which kind of thing is about
 * to happen, where on screen, and the planner's short goal.
 *
 * It is decoration, so it carries no page text, no typed value and no task detail beyond the goal line
 * the planner already wrote. The box comes from the page read the models were shown, not a fresh DOM
 * query, and is in top-level viewport pixels, so an element inside an iframe still lands in the right
 * place on screen.
 */
import type { AgentActionKind, AgentActionMessage } from '@extension/storage';
import type { DOMElementNode } from '../../../browser/dom/views';

/** Anything not listed reads as the agent looking at the page rather than touching it. */
const KINDS: Record<string, AgentActionKind> = {
  click_element: 'click',
  right_click_element: 'click',
  hover_element: 'click',
  drag_element: 'click',
  select_dropdown_option: 'click',
  handle_dialog: 'click',
  input_text: 'type',
  send_keys: 'type',
  upload_file: 'type',
  scroll: 'scroll',
  scroll_to_text: 'scroll',
  go_to_url: 'scroll',
  go_back: 'scroll',
  go_forward: 'scroll',
  search_web: 'scroll',
  open_tab: 'scroll',
  switch_tab: 'scroll',
  close_tab: 'scroll',
  wait: 'wait',
  ask_human: 'ask',
  done: 'done',
};

export function actionKind(actionName: string): AgentActionKind {
  return KINDS[actionName] ?? 'read';
}

/** The goal chip holds a few words; a planner sentence is cut here rather than shipped whole. */
export const MAX_GOAL_CHARS = 64;

export function presenceMessage(actionName: string, node: DOMElementNode | undefined, goal: string | undefined): AgentActionMessage {
  const box = node?.viewportCoordinates;
  return {
    type: 'AGENT_ACTION',
    kind: actionKind(actionName),
    rect:
      box && box.width > 0 && box.height > 0
        ? { x: box.topLeft.x, y: box.topLeft.y, w: box.width, h: box.height, r: node?.cornerRadius ?? 0 }
        : undefined,
    goal: goal ? goal.replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL_CHARS) || undefined : undefined,
  };
}

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
  select_dropdown_option: 'click',
  handle_dialog: 'click',
  input_text: 'type',
  send_keys: 'type',
  upload_file: 'type',
  scroll: 'scroll',
  go_to_url: 'scroll',
  go_back: 'scroll',
  search_web: 'scroll',
  switch_tab: 'scroll',
  wait_for: 'wait',
  ask_human: 'ask',
  done: 'done',
};

export function actionKind(actionName: string): AgentActionKind {
  return KINDS[actionName] ?? 'read';
}

/** The goal chip holds a few words; a planner sentence is cut here rather than shipped whole. */
export const MAX_GOAL_CHARS = 64;

/** What the agent is doing right now, in the page's own words, so the chip never describes a step already finished. */
const VERBS: Record<string, string> = {
  click_element: 'Clicking',
  select_dropdown_option: 'Choosing in',
  input_text: 'Typing in',
  fill_form: 'Filling in',
  send_keys: 'Typing in',
  upload_file: 'Attaching to',
  scroll: 'Scrolling',
  go_to_url: 'Opening a page',
  go_back: 'Going back',
  search_web: 'Searching the web',
  switch_tab: 'Switching tab',
  read_page: 'Reading the page',
  get_complete_page_content: 'Reading the page',
  find_in_page: 'Looking on the page',
  extract: 'Reading the page',
  wait_for: 'Waiting',
  wait: 'Waiting',
  ask_human: 'Asking you',
  done: 'Finishing',
  save_findings: 'Noting what it found',
  assert: 'Checking the page',
};

/**
 * The line under the cursor. The planner's goal only changes when it re-plans, so on its own it described a step the
 * agent had finished several steps earlier; what the agent is doing this moment is the action and the element it names.
 * An element's own label is text already on the page the overlay is drawn on, and no typed value is ever included.
 */
export function actionLabel(actionName: string, node: DOMElementNode | undefined, goal: string | undefined): string | undefined {
  const verb = VERBS[actionName];
  const name = node ? (node.attributes['aria-label'] || node.getAllTextTillNextClickableElement(2) || node.attributes.placeholder || node.attributes.value || '').replace(/\s+/g, ' ').trim() : '';
  const line = verb && name ? `${verb} “${name}”` : (verb ?? goal ?? '');
  return line.replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL_CHARS) || undefined;
}

export function presenceMessage(
  actionName: string,
  node: DOMElementNode | undefined,
  goal: string | undefined,
  rect?: { x: number; y: number; w: number; h: number },
): AgentActionMessage {
  const box = node?.viewportCoordinates;
  const fromRead = box && box.width > 0 && box.height > 0 ? { x: box.topLeft.x, y: box.topLeft.y, w: box.width, h: box.height } : undefined;
  const where = rect ?? fromRead;
  return {
    type: 'AGENT_ACTION',
    kind: actionKind(actionName),
    rect: where ? { ...where, r: node?.cornerRadius ?? 0 } : undefined,
    goal: actionLabel(actionName, node, goal),
  };
}

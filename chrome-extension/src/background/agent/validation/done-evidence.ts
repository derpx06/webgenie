import type { AgentContext } from '../types';
import { echoesActionResult } from './service';
import { visibleText } from './observation';

export interface DoneEvidence {
  skippable: boolean;
  /** Why the planner still has to check; empty when skippable. */
  reasons: string[];
}

/** Numbers and quoted text in an answer: the values a wrong answer would get wrong. */
export function reportedValues(answer: string): string[] {
  const quoted = [...answer.matchAll(/["“]([^"”]{2,80})["”]/g)].map(match => match[1]);
  const numbers = answer.match(/\d[\d.,:/-]*\d|\d/g) ?? [];
  return [...new Set([...quoted, ...numbers].map(value => value.trim().toLowerCase()))].filter(Boolean);
}

/**
 * Whether a navigator's done carries enough evidence that the planner's check would only repeat it: the plan said this
 * phase finishes the task, nothing is pending or declined, every action of the phase validated, the answer quotes no
 * action result, and every number and quoted value in it is on the page. A reported failure is always checked.
 */
export function doneEvidence(context: AgentContext, answer: string, success: boolean, finalPhase: boolean): DoneEvidence {
  const reasons: string[] = [];
  if (!success) reasons.push('the navigator reports failure');
  if (!finalPhase) reasons.push('the plan did not mark this phase as the last');
  if (context.pendingQuestion || context.waitingForHuman) reasons.push('a question is pending');
  if (context.declinedCommitKeys.size > 0) reasons.push('the user declined an action');
  if (echoesActionResult(answer)) reasons.push('the answer quotes an action result');
  const contractId = context.currentContract?.id;
  if (context.validatedProgress.some(record => record.contractId === contractId && record.status !== 'completed')) {
    reasons.push('an action in this phase did not validate');
  }
  const page = context.promptState ? visibleText(context.promptState).toLowerCase() : '';
  if (!page) reasons.push('no page was read');
  const missing = reportedValues(answer).filter(value => !page.includes(value));
  if (page && missing.length > 0) reasons.push(`not on the page: ${missing.slice(0, 3).join(', ')}`);
  return { skippable: reasons.length === 0, reasons };
}

/** An answer saying something is not there. */
const ABSENCE = /\b(no (results?|matches|matching|items?|products?|listings?|records?)\b|not found|no\b[^.]{0,40}\b(was|were) found|there (is|are|was|were) no\b|nothing (was )?found|no such|(could ?n[o']?t|cannot|can't|unable to|did ?n[o']?t) (find|locate)|(does|do) ?n[o']?t (exist|have))/i;
/** A page saying its search or listing came back empty. */
const EMPTY_RESULTS = /\b(no (results?|matches|matching)|0 (results?|matches|items)|nothing (was )?found|not found|did ?n[o']?t match|could ?n[o']?t find|returned no)\b/i;

/**
 * Whether an answer of absence ("no results", "not found", or a reported failure) rests on a page that was never read:
 * no get_complete_page_content on the current address and no empty-result message in the page state.
 */
export function absenceUnread(context: AgentContext, answer: string, reportedFailure: boolean): boolean {
  const state = context.promptState;
  if (!state || !/^https?:/i.test(state.url)) return false;
  if (!reportedFailure && !ABSENCE.test(answer)) return false;
  if (context.pageRead?.url === state.url) return false;
  return !EMPTY_RESULTS.test(visibleText(state));
}

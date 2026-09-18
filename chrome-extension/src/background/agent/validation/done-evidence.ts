import type { AgentContext } from '../types';
import type { PlannerRequirement } from '../contracts/types';
import { DOMElementNode } from '../../browser/dom/views';
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
/** An answer saying the task cannot be done ("this site cannot…", "I am unable to…", "is not possible"). */
const GIVES_UP = /\b(can ?not|can't|could ?n[o']?t|unable to|not (?:possible|able to)|(?:does|do) ?n[o']?t (?:support|offer|allow|provide))\b/i;

/**
 * Whether a planner's done gives the task up before any step was taken on a web page. A live planner answered at step 0,
 * from the start address alone, that a job site "is for jobs in Ohio, I cannot search New York" without looking at it.
 */
export function givesUpUnseen(context: AgentContext, answer: string): boolean {
  return context.nSteps === 0 && /^https?:/i.test(context.promptState?.url ?? '') && GIVES_UP.test(answer);
}

/** A page saying its search or listing came back empty. */
const EMPTY_RESULTS = /\b(no (results?|matches|matching)|0 (results?|matches|items)|nothing (was )?found|not found|did ?n[o']?t match|could ?n[o']?t find|returned no)\b/i;

/**
 * Whether an answer of absence ("no results", "not found", or a reported failure) rests on a page that was never read:
 * no page read on the current address and no empty-result message in the page state.
 */
export function absenceUnread(context: AgentContext, answer: string, reportedFailure: boolean): boolean {
  const state = context.promptState;
  if (!state || !/^https?:/i.test(state.url)) return false;
  if (!reportedFailure && !ABSENCE.test(answer)) return false;
  if (context.pageRead?.url === state.url) return false;
  return !EMPTY_RESULTS.test(visibleText(state));
}

/** What an applied requirement's evidence names that a page can be searched for: double-quoted text and URL parameters. */
function evidenceValues(evidence: string): string[] {
  const quoted = [...evidence.matchAll(/["“]([^"”]{2,80})["”]/g)].map(match => match[1]);
  const params = evidence.match(/[\w.[\]-]+=[^\s&,;)"”]+/g) ?? [];
  return [...quoted, ...params].map(value => value.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
}

/**
 * Applied requirements whose recorded evidence the current page no longer shows: none of its quoted texts or URL
 * parameters is in the page text, an attribute (a selected value, a label) or the address. Filters claimed applied
 * were gone by the end (a later go_back removed a checkbox filter). Evidence with nothing to search for is not judged.
 */
export function staleRequirements(context: AgentContext, requirements: PlannerRequirement[]): PlannerRequirement[] {
  const page = evidenceHaystack(context);
  if (page === null) return [];
  return requirements.filter(item => {
    if (item.status !== 'applied' || !item.evidence) return false;
    const values = evidenceValues(item.evidence);
    return values.length > 0 && !values.some(value => page.includes(value));
  });
}

/**
 * Everything on the page an applied requirement's evidence may be found in: its text, its addresses and its attributes.
 * Null when the page holds nothing to search: it could not be read in time, or it was read while re-rendering and came
 * back with no content at all. Such a read is not evidence that a filter or sort is gone (a live run read the page while
 * it re-rendered after sorting, was told the sort had vanished, and undid the sort that had in fact been applied).
 */
function evidenceHaystack(context: AgentContext): string | null {
  const state = context.promptState;
  if (!state || state.unreadable) return null;
  const parts = [visibleText(state)];
  const stack: unknown[] = state.elementTree ? [state.elementTree] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node instanceof DOMElementNode) {
      parts.push(...Object.values(node.attributes ?? {}));
      stack.push(...node.children);
    }
  }
  if (!/[a-z0-9]/i.test(parts.join(''))) return null;
  parts.push(state.url ?? '');
  try {
    parts.push(decodeURIComponent((state.url ?? '').replace(/\+/g, ' ')));
  } catch {
    // A malformed address is searched as it is.
  }
  return parts.join('\n').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A requirement's identity across plans. The planner rewords the same constraint from plan to plan, most often by adding
 * a parenthetical about what is left to do ("most experienced agent (Years of Experience filter needs to be applied)"),
 * which made every plan look like a new requirement and let an applied one start again from pending.
 */
export function requirementKey(requirement: string): string {
  return requirement.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The plan's requirements with what is already applied kept applied. A plan that lists a requirement it had marked
 * applied as pending again has it restored, so the phase is not planned a second time; only evidence gone from the
 * current page reopens it, and each requirement may be reopened once (a live run re-applied one filter three times,
 * losing the sort it had, until the task hit the token cap).
 */
export function mergeRequirements(context: AgentContext, incoming: PlannerRequirement[]): PlannerRequirement[] {
  const previous = new Map(context.requirements.map(item => [requirementKey(item.requirement), item]));
  const gone = new Set(staleRequirements(context, context.requirements).map(item => requirementKey(item.requirement)));
  return incoming.map(item => {
    const key = requirementKey(item.requirement);
    const before = previous.get(key);
    if (!before || before.status !== 'applied' || item.status !== 'pending') return item;
    if (gone.has(key) && !context.requirementReopens.has(key)) {
      context.requirementReopens.add(key);
      return item;
    }
    return { ...item, status: 'applied', evidence: item.evidence ?? before.evidence };
  });
}

/**
 * Applied requirements whose recorded evidence the current page still shows. Leaving such a page (going back, reloading)
 * removes what it shows, so what is applied is checked here rather than by navigating away to look.
 */
export function appliedOnPage(context: AgentContext, requirements: PlannerRequirement[]): PlannerRequirement[] {
  const page = evidenceHaystack(context);
  if (page === null) return [];
  return requirements.filter(item => {
    if (item.status !== 'applied' || !item.evidence) return false;
    const values = evidenceValues(item.evidence);
    return values.length > 0 && values.some(value => page.includes(value));
  });
}

/**
 * Applied requirements whose only evidence is the search or the results' own text, not a filter, sort or selection the
 * site applied. Search text does not filter results: a live run typed a make and model into the search box and marked
 * both applied because "Search results show" them.
 */
export function searchOnlyEvidence(requirements: PlannerRequirement[]): PlannerRequirement[] {
  return requirements.filter(
    item =>
      item.status === 'applied' &&
      !!item.evidence &&
      /\b(search(es|ed|ing)?|results?|listings?|matches|titles?)\b/i.test(item.evidence) &&
      !/\b(filter(s|ed)?|sort(ed)?|selected|checked|chip|facet|option|toggle|refine(d|ment)?|url|parameter)\b|[\w-]+=\S/i.test(item.evidence),
  );
}

/**
 * A word reduced to its stem, so "filter", "filters" and "filtered" count as the same word. A suffix is only dropped
 * when three letters are left: "red" is a colour, not the past tense of "r".
 */
function stemWord(word: string): string {
  const bare = word.replace(/['’]/g, '');
  const stem = bare.replace(/ies$/, 'y').replace(/(es|s|ed|ing)$/, '');
  return stem.length >= 3 ? stem : bare;
}

/**
 * Words that say nothing about what a page showed: ordinary English, and the words an agent uses to say that it looked
 * (found, results, filters, displayed). An answer whose words are all in here reports the search, not the page.
 */
const PROCESS_WORDS = new Set(
  (
    'the and for with from that this these those there here are was were been has have had not but its your you they them their ' +
    'all any some both each more most other than then also very can could will would should now new per about above below via ' +
    'page website web search result find look show display list filter sort apply select criteria match request available ' +
    'successfully success complete done task current screen browser tab view visible following item option information detail ' +
    'content data user please open navigate click button link top first best according based return which what where when who how ' +
    // Forms whose stem differs from the one above, so they are listed themselves.
    'found applied listing shown'
  )
    .split(' ')
    .map(stemWord),
);

/** The words of a text that say something about the world: stemmed, at least three letters, not a process word. */
function informationWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z'’-]{2,}/g) ?? [];
  return new Set(words.map(stemWord).filter(word => word.length >= 3 && !PROCESS_WORDS.has(word)));
}

/** The numbers of a text, thousands separators aside, so "10,000" in the task matches "10000" in the answer. */
function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d+(?:[.,]\d+)*/g) ?? []).map(number => number.replace(/,/g, '')));
}

/** An answer claiming the page holds what was asked for, instead of saying what it is. */
const CLAIMS_FOUND = /\b(found|results?|listings?|listed|displayed|display(s|ing) on|shown|showing|(are|is) (on|visible))\b/i;
/** A task asking for a value: a quantity, a price, a rating, a date or a time. */
const ASKS_VALUE =
  /\bhow (?:much|many|long|far|old|big|heavy|tall|wide)\b|\bnumber of\b|\b(price|prices|pricing|cost|costs|fare|fares|fee|fees|rating|ratings|score|scores|total|amount|date|dates|time|times|hours|schedule|distance|duration|percentage|percent|salary|wage|weight|mileage|count|quantity)\b/i;
/** An answer that says plainly the page does not give something. Saying so is an answer, not a gap. */
const NOT_SHOWN =
  /\b(not (?:shown|listed|displayed|available|given|provided|stated|specified|published|offered)|(?:does|do|did) ?n[o']?t (?:show|list|display|give|provide|state|offer)|no longer available|unavailable)\b/i;
/** An answer reporting that nothing matched, however long the description of what was looked for. */
const NONE_MATCHED = /\bno\b[^.]{0,160}\b(?:found|match(?:es|ing)?|available|results?|listed|shown|displayed|posted|present|exists?)\b/i;

/**
 * A conjunction that starts another thing the task asks for, rather than joining two words of one: it is followed by a
 * question word or by a verb asking for something. "cold and flu forecast" is one ask; "and how to claim" is another.
 * The relative pronouns (which, who, whose) are left out: they continue a description of one thing ("a girl whose
 * current height is 4 feet and whose weight is 55 lbs"), they do not ask for a second.
 */
const NEXT_ASK =
  /[,;]?\s+(?:and|also|then|plus)\s+(?=(?:what|when|where|how|why|find|show|tell|list|get|check|look|see|give|report|browse|search|open|add|compare|display|view|read|include|note)\b)/gi;

/** The word a part opens with to ask for something. It says how to answer, not what about, so it is not part of what. */
const ASK_OPENER =
  /^(?:what|when|where|how|why|find|show|tell|list|get|check|look|see|give|report|browse|search|open|add|compare|display|view|read|include|note)\b\s*/i;

/** The things a task asks for separately; one part when nothing in it joins two asks. */
export function askedParts(task: string): string[] {
  return task
    .split(NEXT_ASK)
    .map(part => part.trim().replace(/^[,;\s]+|[.,;\s]+$/g, ''))
    .filter(Boolean);
}

/**
 * What a done answer leaves out of what the task asked for, read from the two texts alone. Three gaps: an answer that
 * says what was asked for is on the page without naming any of it (live runs finished with "cars are displayed for sale
 * near Kentwood, MI" and "the search returned 67,163 results"), a task asking for a value answered without one (the
 * groomer named, its prices left out), and a task asking for several things of which one is never mentioned ("the
 * Eligibility ... and How it works and how to claim", answered with the eligibility alone). An answer that says plainly
 * the page does not give something has neither of the first two: saying so is the answer.
 */
export function answerGaps(task: string, answer: string): string[] {
  if (!answer.trim()) return [];
  const answerWords = informationWords(answer);
  const gaps: string[] = [];
  if (!ABSENCE.test(answer) && !NOT_SHOWN.test(answer) && !NONE_MATCHED.test(answer)) {
    const taskWords = informationWords(task);
    const addedWords = [...answerWords].filter(word => !taskWords.has(word));
    const addedNumbers = [...numbersIn(answer)].filter(number => !numbersIn(task).has(number));
    // Only the task's own words back: a count of results is not the results, and "the filters are applied" is no answer.
    if (addedWords.length === 0 && CLAIMS_FOUND.test(answer)) {
      gaps.push('it says what was asked for is on the page without naming any of it');
    }
    const asked = addedNumbers.length === 0 ? task.match(ASKS_VALUE)?.[0] : undefined;
    if (asked) gaps.push(`the task asks for ${asked.toLowerCase()} and the answer states no value for it`);
  }
  // A part of the task the answer does not touch at all, not even to say the page does not give it.
  const parts = askedParts(task);
  if (parts.length > 1) {
    const untouched = parts.find(part => {
      const words = [...informationWords(part.replace(ASK_OPENER, ''))];
      return words.length > 0 && !words.some(word => answerWords.has(word));
    });
    if (untouched) gaps.push(`it says nothing about this part of the task: "${untouched}"`);
  }
  return gaps;
}

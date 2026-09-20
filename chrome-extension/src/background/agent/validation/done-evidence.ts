import type { AgentContext } from '../types';
import type { PlannerRequirement } from '../contracts/types';
import { DOMElementNode } from '../../browser/dom/views';
import type { BrowserState } from '../../browser/views';
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

/**
 * Whether an answer saying something does not exist rests on too few routes. Absence is credible when at least
 * `minKinds` different kinds of route (the site's search, its filters, its categories, an address, a web search) came
 * back empty, or when a filtered listing itself states zero results; one empty search is not evidence that a thing does
 * not exist, it is evidence about that search. A task that searched nothing is not judged here: its answer is about the
 * page in front of it, not about a search. Inviting absence costs more than refusing it once (WebArena's N/A hint made
 * GPT-4 call 54.9% of feasible tasks impossible), so the caller sends such an answer back once and then accepts it.
 */
export function absenceUnderexplored(context: AgentContext, answer: string, minKinds: number): boolean {
  if (minKinds < 2) return false;
  if (!ABSENCE.test(answer) && !NONE_MATCHED.test(answer)) return false;
  const routes = context.ledger?.routes() ?? [];
  if (routes.length === 0) return false;
  const empty = context.ledger.emptyRouteKinds();
  // A listing filtered down to zero results has already answered the question for the criteria it was filtered on.
  return !empty.has('facet') && empty.size < minKinds;
}

/** A word, number or amount of a quote, in any script. Built from a string: the compile target has no /u literals. */
const EVIDENCE_TOKEN = new RegExp("[\\p{L}\\p{N}][\\p{L}\\p{N}'’.,%$€£-]*", 'gu');

/**
 * Whether a quote is really on the page in front of the agent: its text, its element attributes, its address, or the
 * page it last read. A quote that spans several elements is rendered differently in the element list than on the page,
 * so every word and number of it being there counts too.
 * ponytail: a loose token match; if fabricated claims slip through it, require the run of words in order.
 */
export function evidenceOnPage(context: AgentContext, evidence: string): boolean {
  const flat = (text: string) => text.replace(/\s+/g, ' ').toLowerCase();
  const wanted = flat(evidence).trim();
  if (!wanted) return false;
  const page = `${evidenceHaystack(context) ?? ''}\n${flat(context.pageRead?.text ?? '')}`;
  if (!/[a-z0-9]/i.test(page)) return false;
  if (page.includes(wanted)) return true;
  const tokens = wanted.match(EVIDENCE_TOKEN) ?? [];
  return tokens.length >= 3 && tokens.every(token => page.includes(token));
}

/**
 * The values a finished answer states that no page has shown: its numbers and quoted texts that are not on the current
 * page, when no claim of this task was ever checked against a page with `assert`. Answers that claimed what the page
 * never showed were 6 of the 27 judged failures in the reviewed round — near-zero wasted steps, maximum damage.
 *
 * An answer reporting failure or absence states nothing to check, a task answered without a single step is not a claim
 * about a page (`givesUpUnseen` and `absenceUnread` cover those), a page that could not be read proves nothing either
 * way, and one passing assertion means the agent did put its claim to the page. What the agent itself typed is on the
 * page whether or not the latest read shows it back.
 */
export function unbackedValues(context: AgentContext, answer: string, reportedFailure: boolean): string[] {
  if (reportedFailure || ABSENCE.test(answer) || NONE_MATCHED.test(answer) || NOT_SHOWN.test(answer)) return [];
  if (context.nSteps === 0) return [];
  if (context.assertions.some(item => item.passed)) return [];
  const page = evidenceHaystack(context);
  if (page === null) return [];
  const typed = [...context.typedValues.values()].join('\n').toLowerCase();
  return reportedValues(answer).filter(value => !page.includes(value) && !typed.includes(value));
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

/** Evidence saying a value was typed somewhere. */
const TYPED_EVIDENCE = /\b(typ(ed|ing)|enter(ed)?|input(ted)?|fill(ed)?|wrote|written|key(ed)?|search (box|bar|field|input)|into the (field|box|input))\b/i;
/** Evidence saying the site itself took the value: a control set, a suggestion chosen, a parameter in the address. */
const COMMITTED_EVIDENCE =
  /\b(filter(s|ed)?|sort(ed)?|select(ed|ion)?|check(ed|box)?|chip|facet|option|toggle|suggestion|autocomplete|chose|chosen|click(ed)?|dropdown|radio|slider|url|address|parameter|applied by)\b|[\w-]+=\S/i;

/** Whether the only thing this evidence says is that something was typed. */
function typedOnlyEvidence(evidence: string): boolean {
  return TYPED_EVIDENCE.test(evidence) && !COMMITTED_EVIDENCE.test(evidence);
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
    // Typing a value is not applying it: it counts once the site acts on it — a suggestion chosen, a control set, a
    // parameter in the address. A criterion typed into a field and never committed is the most common silent wrong
    // answer in the reviewed runs, and it reads as applied to the planner that typed it.
    if (item.status === 'applied' && before?.status !== 'applied' && typedOnlyEvidence(item.evidence ?? '')) {
      return { ...item, status: 'pending', evidence: `${item.evidence} (typing alone does not apply it)` };
    }
    if (!before || before.status !== 'applied' || item.status !== 'pending') return item;
    if (gone.has(key) && !context.requirementReopens.has(key)) {
      context.requirementReopens.add(key);
      return item;
    }
    return { ...item, status: 'applied', evidence: item.evidence ?? before.evidence };
  });
}

/** Roles and tags of a control a site filters, sorts or chooses with. */
const CONTROL_ROLE = /^(checkbox|radio|combobox|listbox|option|switch|slider|spinbutton|menuitemcheckbox|menuitemradio|tab)$/;
const CONTROL_TAG = /^(select|option|input|summary)$/;
/** A requirement asking for the extreme of an ordering: a sort control answers it, whatever it is named. */
const SUPERLATIVE = /\b(cheapest|lowest|highest|newest|latest|oldest|earliest|nearest|closest|largest|smallest|biggest|longest|shortest|fastest|best|top|most|least|max|maximum|min|minimum)\b/i;
const SORT_CONTROL = /\b(sort|order by|ordering|relevance|ranking)\b/i;

/**
 * What the page offers to filter, sort or choose with: the controls themselves, the headers of collapsed filter
 * sections (a facet nobody has opened yet is still offered), and short links and buttons, which is what many sites
 * build their facets from. Long link texts are left out: an item's own title is not a control.
 */
function controlLabels(state: BrowserState): string {
  const labels: string[] = [];
  const stack: unknown[] = state.elementTree ? [state.elementTree] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!(node instanceof DOMElementNode)) continue;
    stack.push(...node.children);
    const role = node.attributes.role ?? '';
    const tag = node.tagName ?? '';
    const label = [node.attributes['aria-label'], node.attributes.name, node.attributes.placeholder, node.attributes.title, node.getAllTextTillNextClickableElement(2)]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) continue;
    const collapsed = node.attributes['aria-expanded'] === 'false';
    const shortAction = /^(a|button)$/.test(tag) || /^(link|button)$/.test(role);
    if (CONTROL_ROLE.test(role) || CONTROL_TAG.test(tag) || collapsed || (shortAction && label.length <= 40)) labels.push(label);
  }
  return labels.join('\n').toLowerCase();
}

/**
 * Pending requirements that nothing on this page can apply: no control, collapsed filter header, short facet link or
 * sort control shares a word or a number with them. It is the look-before-you-commit check that a world model would
 * guess at — the page is there, it is cheap to read and it is never wrong about itself — and it only answers once the
 * page has been in front of the agent (a read of it, or a step that landed on it), never on first sight.
 *
 * ponytail: word overlap against control labels; if a site names its facets in words no requirement uses, this reports
 * a control it has. That is why the report is behind an option until a gate run measures it.
 */
export function unmatchedRequirements(context: AgentContext, requirements: PlannerRequirement[]): string[] {
  const state = context.promptState;
  const pending = requirements.filter(item => item.status === 'pending');
  if (!state || state.unreadable || pending.length === 0) return [];
  if (context.pageRead?.url !== state.url && !context.ledger?.landedOn(state.url)) return [];
  const labels = controlLabels(state);
  if (!labels) return [];
  const labelWords = informationWords(labels);
  const labelNumbers = numbersIn(labels);
  const sorts = SORT_CONTROL.test(labels);
  return pending
    .filter(item => {
      const words = [...informationWords(item.requirement)];
      const numbers = [...numbersIn(item.requirement)];
      if (words.length === 0 && numbers.length === 0) return false;
      if (SUPERLATIVE.test(item.requirement) && sorts) return false;
      return !words.some(word => labelWords.has(word)) && !numbers.some(number => labelNumbers.has(number));
    })
    .map(item => item.requirement);
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

/** A requirement naming a range: a number with a bound word, or two numbers with a dash between them. */
const RANGE =
  /\b(under|below|over|above|between|less|fewer|more|greater|least|most|up to|starting|after|before|within|max|maximum|min|minimum|or (?:more|less|higher|lower|older|newer)|and up|plus)\b|\d\s*[-–—]\s*\d|\d\s*\+/i;
/** Evidence that names the site's own ordering: a sort control, or a sort parameter in the address. */
const SORT_EVIDENCE = /\b(sort(ed|ing)?|order(ed|ing)?|rank(ed|ing)?|relevance)\b|\b(sort|order|orderby|sortby)[\w-]*=/i;
/** Evidence that names an address parameter, whatever it is called: the site applied something, and it is in the URL. */
const URL_EVIDENCE = /[\w.[\]-]+=[^\s&,;)"”]+/;

/**
 * Applied requirements whose evidence does not show what was applied *exactly*: a range requirement whose evidence does
 * not name its own bound values (nor an address parameter), or a superlative ("cheapest", "newest", "highest rated")
 * whose evidence names no sort control and no address parameter. Online-Mind2Web's largest failure class is filters
 * applied loosely — "2001 to 2012" accepted for "2004 to 2012" — and an evidence line that repeats the requirement in
 * words is exactly what a loose filter looks like from here.
 */
export function inexactFilterEvidence(requirements: PlannerRequirement[]): PlannerRequirement[] {
  return requirements.filter(item => {
    if (item.status !== 'applied') return false;
    const evidence = item.evidence ?? '';
    if (URL_EVIDENCE.test(evidence)) return false;
    if (SUPERLATIVE.test(item.requirement)) return !SORT_EVIDENCE.test(evidence);
    const bounds = [...numbersIn(item.requirement)];
    if (bounds.length === 0 || !RANGE.test(item.requirement)) return false;
    const named = numbersIn(evidence);
    return !bounds.every(bound => named.has(bound));
  });
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

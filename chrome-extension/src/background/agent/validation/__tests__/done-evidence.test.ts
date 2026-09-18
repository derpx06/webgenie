import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));

import { AgentContext } from '../../types';
import type BrowserContext from '../../../browser/context';
import type { BrowserState } from '../../../browser/views';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import type MessageManager from '../../messages/service';
import type { EventManager } from '../../event/manager';
import type { NextStepContract } from '../../contracts';
import { absenceUnread, appliedOnPage, doneEvidence, mergeRequirements, requirementKey, searchOnlyEvidence, staleRequirements } from '../done-evidence';
import { titleFromTask } from '../../../core/task-groups/manager';

function contextOnPage(lines: string[]) {
  const context = new AgentContext('t', {} as BrowserContext, {} as MessageManager, {} as EventManager, {});
  const body = new DOMElementNode({ tagName: 'body', xpath: '/body', attributes: {}, children: [], isVisible: true });
  for (const line of lines) body.children.push(new DOMTextNode(line, true, body));
  context.promptState = { elementTree: body } as unknown as BrowserState;
  context.currentContract = { id: 'c1' } as NextStepContract;
  return context;
}

describe('absenceUnread', () => {
  const on = (lines: string[], url = 'https://shop.test/search?q=lamp') => {
    const context = contextOnPage(lines);
    (context.promptState as BrowserState).url = url;
    return context;
  };

  it('flags an answer of absence about a page that was neither read nor shows an empty result', () => {
    for (const answer of ['No results for brass lamp.', 'No brass lamp was found.', 'I could not find a brass lamp.', 'There are no brass lamps.']) {
      expect(absenceUnread(on(['Desk', 'Chair']), answer, false)).toBe(true);
    }
    expect(absenceUnread(on(['Desk', 'Chair']), 'Checkout needs a sign-in.', true)).toBe(true);
  });

  it('passes an answer that finds something, a page read on this address, an empty-result page, or no web page', () => {
    expect(absenceUnread(on(['Desk', 'Chair']), 'The brass lamp costs $40.', false)).toBe(false);
    const read = on(['Desk', 'Chair']);
    read.pageRead = { url: 'https://shop.test/search?q=lamp', text: 'Desk Chair' };
    expect(absenceUnread(read, 'No brass lamp was found.', false)).toBe(false);
    expect(absenceUnread(on(['0 results for "brass lamp"']), 'No brass lamp was found.', false)).toBe(false);
    expect(absenceUnread(on([], 'about:blank'), 'No such thing exists.', false)).toBe(false);
  });
});

describe('doneEvidence', () => {
  it('accepts a successful final-phase answer whose values are all on the page', () => {
    const context = contextOnPage(['A Light in the Attic', 'Price: £51.77', 'In stock (22 available)']);
    expect(doneEvidence(context, 'The price of "A Light in the Attic" is £51.77, with 22 in stock.', true, true)).toEqual({ skippable: true, reasons: [] });
  });

  it('leaves the check to the planner whenever the evidence is incomplete', () => {
    const page = ['Price: £51.77'];
    const reasons = (context: AgentContext, answer: string, success = true, finalPhase = true) =>
      doneEvidence(context, answer, success, finalPhase).reasons.join(' | ');

    expect(reasons(contextOnPage(page), 'The price is £52.00.')).toContain('not on the page: 52.00');
    expect(reasons(contextOnPage(page), 'The price is £51.77.', true, false)).toContain('did not mark this phase');
    expect(reasons(contextOnPage(page), 'Could not find it.', false)).toContain('reports failure');
    expect(reasons(contextOnPage(page), 'You clicked [2] "Buy" and it shows £51.77.')).toContain('quotes an action result');

    const asking = contextOnPage(page);
    asking.pendingQuestion = { type: 'question', question: 'Which one?' };
    expect(reasons(asking, 'The price is £51.77.')).toContain('question is pending');

    const unvalidated = contextOnPage(page);
    unvalidated.validatedProgress = [{ contractId: 'c1', status: 'unknown' } as AgentContext['validatedProgress'][number]];
    expect(reasons(unvalidated, 'The price is £51.77.')).toContain('did not validate');
  });
});

describe('titleFromTask', () => {
  it('keeps the words of the task but leaves out anything shaped like a secret', () => {
    expect(titleFromTask('Fill in the form: text input "WebGenie", password "pw-123", textarea')).toBe('Fill in the form: text input');
    expect(titleFromTask('Log in with jamie@example.com and S3cret-Pass!word please')).toBe('Log in with and please');
    expect(titleFromTask('"12345"')).toBe('Task');
  });
});

describe('searchOnlyEvidence', () => {
  const applied = (requirement: string, evidence: string) => ({ requirement, status: 'applied' as const, evidence });

  it('names requirements evidenced only by the search or its results, not by a filter the site applied', () => {
    // Wording from a live run that typed "2022 Tesla Model 3" into a search box.
    const year = applied('Year: 2022', 'URL parameter Year=2022-2022');
    const make = applied('Make: Tesla', "Search results show 'Tesla Model 3'");
    const sort = applied('cheapest first', 'sort label "Price: low to high" selected in the results');
    const brand = applied('brand Acme', 'filter chip "Acme" above the results');
    expect(searchOnlyEvidence([year, make, sort, brand, { requirement: 'in stock', status: 'pending' }])).toEqual([make]);
  });
});

describe('staleRequirements', () => {
  const applied = (requirement: string, evidence: string) => ({ requirement, status: 'applied' as const, evidence });

  it('names an applied requirement none of whose quoted evidence or URL parameters the current page shows', () => {
    const context = contextOnPage(['Results', 'Sort: Relevance']);
    (context.promptState as BrowserState).url = 'https://shop.test/search?q=mug&price=10-20';
    const sort = applied('sorted by price, lowest first', 'sort label "Price: low to high"');
    const price = applied('price $10-20', 'URL has price=10-20');
    const brand = applied('brand Acme', 'checkbox "Acme" checked');
    expect(staleRequirements(context, [sort, price, brand, { requirement: 'in stock', status: 'pending' }])).toEqual([sort, brand]);
  });

  it('finds evidence in attributes and the decoded address, and does not judge evidence with nothing to search for', () => {
    const context = contextOnPage(['Results']);
    const select = new DOMElementNode({ tagName: 'select', xpath: '/body/select', attributes: { value: 'Newest first' }, children: [], isVisible: true });
    context.promptState!.elementTree.children.push(select);
    (context.promptState as BrowserState).url = 'https://shop.test/search?color=Dark+Blue';
    expect(
      staleRequirements(context, [
        applied('newest first', 'sort "Newest first" selected'),
        applied('dark blue', 'filter "dark blue" in the address'),
        applied('4 stars and up', 'the rating filter is selected'),
      ]),
    ).toEqual([]);
  });
});

describe('mergeRequirements', () => {
  const applied = (requirement: string, evidence: string) => ({ requirement, status: 'applied' as const, evidence });
  const pending = (requirement: string) => ({ requirement, status: 'pending' as const });
  // The page keeps showing the sort the planner applied.
  const sorted = () => {
    const context = contextOnPage(['Results', 'Sort: Experience, high to low']);
    (context.promptState as BrowserState).url = 'https://dir.test/search?city=springfield';
    context.requirements = [applied('most experienced', 'sort label "Sort: Experience, high to low"')];
    return context;
  };

  it('keeps a requirement applied when a later plan lists it as pending again', () => {
    const context = sorted();
    expect(mergeRequirements(context, [pending('most experienced')])).toEqual([
      { requirement: 'most experienced', status: 'applied', evidence: 'sort label "Sort: Experience, high to low"' },
    ]);
  });

  it('keeps it applied through the parenthetical the planner adds while rewording it', () => {
    const context = sorted();
    const [merged] = mergeRequirements(context, [pending('most experienced (Years of Experience filter needs to be applied)')]);
    expect(merged.status).toBe('applied');
  });

  it('reopens it once when the evidence is gone from the current page, and not a second time', () => {
    const context = contextOnPage(['Results', 'Sort: Relevance']);
    (context.promptState as BrowserState).url = 'https://dir.test/search?city=springfield';
    const was = applied('most experienced', 'sort label "Sort: Experience, high to low"');
    context.requirements = [was];

    expect(mergeRequirements(context, [pending('most experienced')])).toEqual([pending('most experienced')]);

    // A second plan may not reopen the same requirement, even while the page still does not show it.
    context.requirements = [was];
    expect(mergeRequirements(context, [pending('most experienced')])[0].status).toBe('applied');
  });

  it('leaves a new requirement, one the planner marks applied, and one it marks not_available alone', () => {
    const context = sorted();
    const incoming = [pending('within 10 miles'), applied('most experienced', 'sort label "Sort: Experience, high to low"'), { requirement: 'open now', status: 'not_available' as const }];
    expect(mergeRequirements(context, incoming)).toEqual(incoming);
  });
});

describe('requirementKey', () => {
  it('reads a reworded requirement as the same one', () => {
    expect(requirementKey('most experienced agent (Years of Experience filter needs to be applied)')).toBe(requirementKey('Most experienced agent'));
    expect(requirementKey('price $10-20')).not.toBe(requirementKey('price $30-40'));
  });
});

describe('appliedOnPage', () => {
  it('names the applied requirements this page shows, and nothing when the page was not read', () => {
    const context = contextOnPage(['Results', 'Sort: Experience, high to low']);
    (context.promptState as BrowserState).url = 'https://dir.test/search?city=springfield';
    const sort = { requirement: 'most experienced', status: 'applied' as const, evidence: 'sort label "Sort: Experience, high to low"' };
    const gone = { requirement: 'open now', status: 'applied' as const, evidence: 'chip "Open now"' };
    expect(appliedOnPage(context, [sort, gone, { requirement: 'in stock', status: 'pending' as const }])).toEqual([sort]);

    context.promptState = undefined;
    expect(appliedOnPage(context, [sort])).toEqual([]);
  });
});

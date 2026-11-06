import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));

import { AgentContext } from '../../types';
import type BrowserContext from '../../../browser/context';
import type { BrowserState } from '../../../browser/views';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import type MessageManager from '../../messages/service';
import type { EventManager } from '../../event/manager';
import type { NextStepContract } from '../../contracts';
import { absenceUnderexplored, absenceUnread, answerGaps, appliedOnPage, doneEvidence, mergeRequirements, requirementKey, requirementProblem, requirementProblems, searchOnlyEvidence, inexactFilterEvidence, staleRequirements, unmatchedRequirements } from '../done-evidence';
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

describe('inexactFilterEvidence', () => {
  it('refuses a range or a superlative whose evidence names neither the bounds nor the sort', () => {
    const inexact = inexactFilterEvidence([
      { requirement: 'built between 2004 and 2012', status: 'applied', evidence: 'Year filter applied' },
      { requirement: 'the cheapest option', status: 'applied', evidence: 'the first result is the cheapest' },
      { requirement: 'under $50', status: 'applied', evidence: 'the Price filter is set' },
    ]).map(item => item.requirement);
    expect(inexact).toEqual(['built between 2004 and 2012', 'the cheapest option', 'under $50']);
  });

  it('accepts evidence naming the bound values, a sort control or an address parameter', () => {
    expect(
      inexactFilterEvidence([
        { requirement: 'built between 2004 and 2012', status: 'applied', evidence: 'Year from 2004 to 2012 selected' },
        { requirement: 'the cheapest option', status: 'applied', evidence: 'Sort by: price low to high' },
        { requirement: 'under $50', status: 'applied', evidence: 'price_max=50 in the address' },
        { requirement: 'rated 4 stars and up', status: 'applied', evidence: '"4 Stars & Up" is checked' },
        // Not a range and not a superlative: this check says nothing about it.
        { requirement: 'in blue', status: 'applied', evidence: 'the Blue swatch is selected' },
        { requirement: 'under $50', status: 'pending' },
      ]),
    ).toEqual([]);
  });
});

describe('unmatchedRequirements', () => {
  const pageWithControls = (controls: Array<{ tag?: string; role?: string; label: string; expanded?: string }>) => {
    const context = contextOnPage([]);
    const body = (context.promptState as BrowserState).elementTree as DOMElementNode;
    for (const control of controls) {
      const node = new DOMElementNode({
        tagName: control.tag ?? 'button',
        xpath: '/body/x',
        attributes: { ...(control.role ? { role: control.role } : {}), ...(control.expanded ? { 'aria-expanded': control.expanded } : {}) },
        children: [],
        isVisible: true,
        parent: body,
      });
      node.children.push(new DOMTextNode(control.label, true, node));
      body.children.push(node);
    }
    (context.promptState as BrowserState).url = 'https://shop.test/search?q=lamp';
    context.pageRead = { url: 'https://shop.test/search?q=lamp', text: '' };
    return context;
  };

  it('names the pending requirements no control, collapsed section or sort on the page can apply', () => {
    const context = pageWithControls([
      { role: 'checkbox', label: 'Brass' },
      // A filter section nobody has opened yet is still a control the page offers.
      { label: 'Price', expanded: 'false' },
      { tag: 'select', label: 'Sort by' },
    ]);
    const missing = unmatchedRequirements(context, [
      { requirement: 'made of brass', status: 'pending' },
      { requirement: 'price under 50', status: 'pending' },
      { requirement: 'the cheapest one', status: 'pending' },
      { requirement: 'free next-day delivery', status: 'pending' },
      { requirement: 'in the Lighting department', status: 'applied', evidence: 'dept=lighting' },
    ]);
    expect(missing).toEqual(['free next-day delivery']);
  });

  it('says nothing about a page the task has neither read nor landed on', () => {
    const context = pageWithControls([{ role: 'checkbox', label: 'Brass' }]);
    context.pageRead = null;
    expect(unmatchedRequirements(context, [{ requirement: 'free next-day delivery', status: 'pending' }])).toEqual([]);
    context.ledger.visited('shop.test/search?q=lamp', 'Search');
    expect(unmatchedRequirements(context, [{ requirement: 'free next-day delivery', status: 'pending' }])).toEqual(['free next-day delivery']);
  });
});

describe('absenceUnderexplored', () => {
  const searched = (url: string, text: string) => {
    const context = contextOnPage([]);
    context.ledger.recordRoute('click_element', { url: 'https://shop.test/', text: '' }, { url, text });
    return context;
  };

  it('flags "nothing like that exists" when only one kind of route came back empty', () => {
    const context = searched('https://shop.test/search?q=brass+lamp', 'No results found');
    expect(absenceUnderexplored(context, 'No brass lamp was found on the site.', 2)).toBe(true);
    expect(absenceUnderexplored(context, 'The brass lamp costs $40.', 2)).toBe(false);
    // The threshold is an option; below two it is off.
    expect(absenceUnderexplored(context, 'No brass lamp was found on the site.', 1)).toBe(false);
  });

  it('accepts absence after a second kind of route, after a filtered listing with zero results, or with no route at all', () => {
    const two = searched('https://shop.test/search?q=brass+lamp', 'No results found');
    two.ledger.recordRoute('click_element', { url: 'https://shop.test/', text: '' }, { url: 'https://shop.test/c/lamps', text: 'No matching items' });
    expect(absenceUnderexplored(two, 'No brass lamp was found on the site.', 2)).toBe(false);

    const filtered = searched('https://shop.test/search?q=lamp', '12 results');
    filtered.ledger.recordRoute(
      'click_element',
      { url: 'https://shop.test/search?q=lamp', text: '12 results' },
      { url: 'https://shop.test/search?q=lamp&material=brass', text: 'No results found' },
    );
    expect(absenceUnderexplored(filtered, 'No brass lamp was found on the site.', 2)).toBe(false);

    // A task that searched nothing is answering about the page in front of it, not about a search.
    expect(absenceUnderexplored(contextOnPage([]), 'No phone number is listed.', 2)).toBe(false);
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

  // Live: "under $40" marked applied on a list sorted cheapest first, citing the prices that happened to be on screen.
  it('names evidence that only describes the prices or items on screen, and spares evidence that names a control', () => {
    const shown = applied('under $40', 'Prices shown are under $40 (e.g. $8.99, $9.99)');
    const visible = applied('size 10', 'All visible shoes are size 10');
    const filter = applied('under $40', 'Price filter set to $0 - $40');
    const field = applied('under $40', 'The max price field shows 40');
    const url = applied('under $40', 'URL has price=0-40');
    const selected = applied('blue', '"Blue (167)" selected in color facet');
    expect(searchOnlyEvidence([shown, visible, filter, field, url, selected])).toEqual([shown, visible]);
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

describe('requirementProblem', () => {
  const onResults = () => {
    const context = contextOnPage(['Results for "under $50 lamp"']);
    (context.promptState as BrowserState).url = 'https://shop.test/search?q=under+%2450+lamp';
    return context;
  };

  it('reports one problem per requirement, the first that applies', () => {
    const context = onResults();
    // Both search-only (the evidence is the results) and inexact (a range whose bound is not named): search-only wins.
    const both = { requirement: 'under $50', status: 'applied' as const, evidence: 'the search results show cheap lamps' };
    expect(searchOnlyEvidence([both])).toEqual([both]);
    expect(inexactFilterEvidence([both])).toEqual([both]);
    expect(requirementProblem(context, both)).toBe('search-only');
    expect(requirementProblems(context, [both])).toEqual([{ item: both, problem: 'search-only' }]);
  });

  it('reports the page having lost the evidence before anything else', () => {
    const context = onResults();
    const gone = { requirement: 'under $50', status: 'applied' as const, evidence: 'the search results for "brass lamps" list them' };
    expect(requirementProblem(context, gone)).toBe('stale');
  });

  it('says nothing about a requirement whose evidence backs it, or one that is not applied', () => {
    const context = onResults();
    expect(requirementProblem(context, { requirement: 'in blue', status: 'applied', evidence: 'the Blue swatch is selected' })).toBeNull();
    expect(requirementProblem(context, { requirement: 'under $50', status: 'pending' })).toBeNull();
  });
});

describe('staleRequirements on a page that could not be read', () => {
  const applied = { requirement: 'most experienced', status: 'applied' as const, evidence: 'sort label "Sort: Experience, high to low"' };

  it('does not call the evidence gone when the read came back empty while the page re-rendered', () => {
    const context = contextOnPage([]);
    (context.promptState as BrowserState).url = 'https://dir.test/search?city=springfield';
    expect(staleRequirements(context, [applied])).toEqual([]);
    expect(appliedOnPage(context, [applied])).toEqual([]);
  });

  it('does not call it gone when the page could not be read in time', () => {
    const context = contextOnPage(['Results', 'Sort: Relevance']);
    (context.promptState as BrowserState).url = 'https://dir.test/search?city=springfield';
    (context.promptState as BrowserState).unreadable = true;
    expect(staleRequirements(context, [applied])).toEqual([]);
  });

  it('still calls it gone on a page that was read and shows something else', () => {
    const context = contextOnPage(['Results', 'Sort: Relevance']);
    (context.promptState as BrowserState).url = 'https://dir.test/search?city=springfield';
    expect(staleRequirements(context, [applied])).toEqual([applied]);
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

  it('does not let a requirement go applied on a typing action alone', () => {
    const context = contextOnPage(['Results']);
    const [typed, committed] = mergeRequirements(context, [
      applied('within 10 miles of Springfield', 'typed "Springfield" into the location field'),
      applied('most experienced', 'chose "Experience, high to low" in the sort dropdown'),
    ]);
    expect(typed).toMatchObject({ status: 'pending' });
    expect(typed.evidence).toContain('typing alone does not apply it');
    expect(committed.status).toBe('applied');
  });

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

describe('answerGaps', () => {
  it('flags an answer that says the results are on the page without naming any of them', () => {
    expect(answerGaps('See Nissan and Honda cars for sale near Kentwood, MI 49512 on CarMax.', 'Nissan and Honda cars are displayed for sale near Kentwood, MI 49512 on CarMax.')[0]).toMatch(/without naming/);
    expect(answerGaps('Find a large van for sale from the year 2024 or newer with up to 10,000 miles.', 'Successfully found large vans for sale from 2024 or newer with up to 10,000 miles. The filters have been applied and the results are displayed on the page.')[0]).toMatch(/without naming/);
    // A count of the results is not the results.
    expect(answerGaps('Search for papers related to reinforcement learning on arxiv.', 'Successfully searched for papers related to reinforcement learning on arxiv. The search returned 67,163 results.')[0]).toMatch(/without naming/);
  });

  it('passes an answer that names what the page showed', () => {
    expect(answerGaps('See Nissan and Honda cars for sale near Kentwood, MI 49512.', 'Nissan Rogue, $18,998; Honda Civic, $21,499.')).toEqual([]);
    expect(answerGaps('Find a large van for sale from 2024 or newer.', 'Found a 2025 Ford Transit 350 for $52,410.')).toEqual([]);
  });

  it('flags a task that asks for a value answered without one', () => {
    expect(answerGaps('Find the price of a full groom for a large dog.', 'Full grooming is offered at the Petco Grooming Salon.')[0]).toMatch(/asks for price/);
    expect(answerGaps('Find out how many assists Chris Paul averages this season.', 'Chris Paul is averaging assists this season.')[0]).toMatch(/asks for how many/);
    expect(answerGaps('Find the price of a full groom for a large dog.', 'A full groom for a large dog costs $85.')).toEqual([]);
  });

  it('accepts an answer that says plainly the page does not give it, and a task that asks for no value', () => {
    expect(answerGaps('Find the price of a full groom for a large dog.', 'The salon page does not list a price for a full groom.')).toEqual([]);
    expect(answerGaps('Find reviews of the Nest doorbell.', 'No reviews were found for the Nest doorbell.')).toEqual([]);
    // An action task carries no value to report and claims nothing was found.
    expect(answerGaps('Add a Bose speaker to the cart.', 'The Bose speaker has been added to the cart.')).toEqual([]);
    expect(answerGaps('', 'Anything at all.')).toEqual([]);
  });

  it('flags a part of a several-part task the answer says nothing about', () => {
    const task = 'Find the eligibility for child benefit and how to claim it';
    expect(answerGaps(task, 'You qualify if you are responsible for a child under 16 and live in the UK.')[0]).toMatch(/says nothing about this part.*how to claim/);
    expect(answerGaps(task, 'You qualify for a child under 16. To claim, fill in form CH2 and post it.')).toEqual([]);
    // Said even when nothing was found, so the answer covers the whole task.
    expect(answerGaps('Add Elevate at Chicago to favorites and show a virtual tour.', 'Elevate at Chicago was not found in the search results.')[0]).toMatch(/virtual tour/);
  });

  it('reads a conjunction inside one description as one thing asked for', () => {
    // "whose ..." goes on describing the child; it does not ask for a second thing.
    expect(answerGaps("See the prediction about the girl's height, whose height at seven years is 4 feet and whose weight is 55 lbs.", "The girl's predicted height at age 18 is 5 ft. 4 in.")).toEqual([]);
    expect(answerGaps('Find out the cold and flu forecast for Champaign', 'The cold and flu forecast for Champaign is low this week.')).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));

import { AgentContext } from '../../types';
import type BrowserContext from '../../../browser/context';
import type { BrowserState } from '../../../browser/views';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import type MessageManager from '../../messages/service';
import type { EventManager } from '../../event/manager';
import type { NextStepContract } from '../../contracts';
import { absenceUnread, doneEvidence } from '../done-evidence';
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

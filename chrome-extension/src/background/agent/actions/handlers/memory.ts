import { ActionResult, renderTodos } from '@src/background/agent/types';
import type { assertActionSchema, notesActionSchema, todoListActionSchema } from '../schemas';
import type { TodoItem } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import { evidenceOnPage } from '../../validation/done-evidence';

/** The agent's memory of its own work: the scratchpad it keeps for itself, apart from the findings it keeps for the user. */
export class MemoryHandler extends BaseHandler {
  /**
   * A note the model writes to itself. Findings are the task's output and are quoted back to the user; notes are how the
   * agent remembers what it tried, and they are rendered in the state block, which no compaction can drop.
   */
  async handleNotes(input: z.infer<typeof notesActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, 'Writing a note');
    const text = input.text?.trim() ?? '';
    if (input.action !== 'clear' && !text) {
      const msg = `Nothing written: notes ${input.action} needs the text of the note.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
    if (input.action === 'clear') this.context.notes = [];
    else if (input.action === 'replace') this.context.notes = [text];
    // The same note twice says nothing new; live runs saved the same finding three times in six steps.
    else if (!this.context.notes.includes(text)) this.context.notes.push(text);

    const msg = this.context.notes.length === 0
      ? 'Your notes are empty.'
      : `Noted; you have ${this.context.notes.length} note${this.context.notes.length === 1 ? '' : 's'}, shown in every later step.`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  /**
   * The parts of the task, so a multi-part one loses none of them: 8 of 261 judged answers in the reviewed runs answered
   * a question of several parts with one of them. The list is rendered in the state block on every call.
   */
  async handleTodoList(input: z.infer<typeof todoListActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Updating the to-do list (${input.action})`);
    const todos = this.context.todos;
    // The schema is typed as a plain object schema, so the array's element type is spelled out here.
    const wanted: string[] = (input.items as string[]).map(item => item.trim()).filter(Boolean);
    let msg: string;

    if (wanted.length === 0) {
      msg = `Nothing changed: todo_list ${input.action} needs items.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    if (input.action === 'add') {
      // Checked against the list as it grows, so one call cannot add the same part twice either.
      const added: string[] = [];
      for (const text of wanted) {
        if (todos.some(item => same(item.text, text))) continue;
        todos.push({ text, done: false });
        added.push(text);
      }
      msg = added.length === wanted.length ? `${added.length} added.` : `${added.length} added; the rest were already on the list.`;
    } else {
      const picked = wanted.map(item => find(todos, item));
      const missing = wanted.filter((_, i) => picked[i] === undefined);
      if (input.action === 'complete') {
        for (const item of picked) if (item) item.done = true;
        msg = `${picked.filter(Boolean).length} completed.`;
      } else {
        const order = [...new Set(picked.filter((item): item is TodoItem => !!item))];
        this.context.todos = [...order, ...todos.filter(item => !order.includes(item))];
        msg = 'Reordered.';
      }
      if (missing.length > 0) msg += ` Not on the list: ${missing.map(item => JSON.stringify(item)).join(', ')}.`;
    }

    msg = `${msg} ${renderTodos(this.context.todos) || 'The list is empty.'}`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  /**
   * A claim checked against the page in front of the agent, right where the evidence is still readable. Answers that
   * claimed what the page never showed were 6 of the 27 judged failures in the reviewed round: a claim whose evidence
   * is not on this page is refused here, and a successful completion with no passing assertion is sent back once.
   */
  async handleAssert(input: z.infer<typeof assertActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, 'Checking a claim against the page');
    const claim = String(input.claim ?? '').trim();
    const evidence = String(input.evidence ?? '').trim();
    const url = this.context.promptState?.url ?? '';
    const passed = !!claim && !!evidence && evidenceOnPage(this.context, evidence);
    this.context.assertions.push({ claim, evidence, url, passed });

    if (!passed) {
      const msg = !claim || !evidence
        ? 'Not asserted: a claim needs both the claim and the exact page text that shows it.'
        : `Not asserted: "${evidence.slice(0, 120)}" is not on the page you are on (${url}). Quote the page word for word, read it first with read_page or find_in_page, or go to the page that shows it. Never report what no page showed.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    const msg = `${url} shows it; the claim is backed and you may report it.`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }
}

const key = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const same = (a: string, b: string) => key(a) === key(b);

/** The item an argument names: its number on the list, or its text. */
function find(todos: TodoItem[], item: string): TodoItem | undefined {
  const number = /^\d+$/.test(item.trim()) ? Number(item.trim()) : NaN;
  if (Number.isInteger(number) && number >= 1 && number <= todos.length) return todos[number - 1];
  return todos.find(entry => same(entry.text, item));
}


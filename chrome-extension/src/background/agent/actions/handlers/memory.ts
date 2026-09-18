import { ActionResult } from '@src/background/agent/types';
import type { notesActionSchema } from '../schemas';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

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
}

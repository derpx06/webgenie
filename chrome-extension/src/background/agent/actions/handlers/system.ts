import { ActionResult } from '@src/background/agent/types';
import type { askHumanActionSchema } from '../schemas';
import { doneActionSchema } from '../schemas';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

export class SystemHandler extends BaseHandler {
  async handleDone(input: z.infer<typeof doneActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, doneActionSchema.name);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, input.text);
    return new ActionResult({
      isDone: true,
      extractedContent: input.text,
    });
  }

  async handleAskHuman(input: z.infer<typeof askHumanActionSchema.schema>): Promise<ActionResult> {
    const type = input.type ?? 'question';
    const fields = (input.fields as Array<Record<string, unknown>> | undefined)?.map(field => ({
      ...field,
      type: field.type ?? 'text',
      required: field.required ?? true,
    }));
    if (type === 'confirmation' && input.actionType) {
      const key = `auto_confirm_${input.actionType}`;
      const storage = await chrome.storage.local.get(key);
      if (storage[key]) {
        return new ActionResult({
          extractedContent: `Automatically approved ${input.actionType} based on user preference.`,
        });
      }
    }

    const details = JSON.stringify({
      question: input.question,
      options: input.options,
      fields,
      type,
      actionType: input.actionType,
    });
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_ASK_HUMAN, details);
    return new ActionResult({
      isWaitingForHuman: true,
      extractedContent: `Intervention requested (${type}): ${input.question}${input.options ? ` Options: ${input.options.join(', ')}` : ''}`,
    });
  }
}

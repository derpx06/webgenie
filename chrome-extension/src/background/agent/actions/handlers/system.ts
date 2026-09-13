import { ActionResult } from '@src/background/agent/types';
import type { askHumanActionSchema } from '../schemas';
import { doneActionSchema } from '../schemas';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';

const NEVER_REMEMBERED = /order|pay|purchas|buy|checkout|subscri|account|password|credential|log.?in|sign|delet|remov|transfer|money|bank|card|privacy|personal/i;

export class SystemHandler extends BaseHandler {
  async handleDone(input: z.infer<typeof doneActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, doneActionSchema.name);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, input.text);
    return new ActionResult({
      isDone: true,
      success: input.success,
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
    // "Don't ask again" is remembered per site and kind of action, never for money, accounts or data.
    let rememberKey: string | undefined;
    const origin = (() => {
      try {
        return new URL(this.context.promptState?.url ?? '').origin;
      } catch {
        return '';
      }
    })();
    if (type === 'confirmation' && input.actionType && origin && origin !== 'null' && !NEVER_REMEMBERED.test(input.actionType)) {
      rememberKey = `auto_confirm:${origin}:${input.actionType}`;
      const storage = await chrome.storage.local.get(rememberKey);
      if (storage[rememberKey]) {
        return new ActionResult({
          extractedContent: `Automatically approved ${input.actionType} on ${origin} based on user preference.`,
        });
      }
    }

    // A confirmation is answered with a button even when the model gave no options.
    const options = input.options?.length ? input.options : type === 'confirmation' ? ['Yes', 'No'] : undefined;
    const details = JSON.stringify({
      question: input.question,
      options,
      fields,
      type,
      actionType: input.actionType,
      rememberKey,
    });
    this.context.pendingQuestion = { type, question: input.question, details };
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_ASK_HUMAN, details);
    return new ActionResult({
      isWaitingForHuman: true,
      extractedContent: `Intervention requested (${type}): ${input.question}${options ? ` Options: ${options.join(', ')}` : ''}`,
    });
  }
}

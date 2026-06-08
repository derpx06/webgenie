import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { UserIntent } from './types';
import { createLogger } from '@src/background/log';
import { z } from 'zod';

const logger = createLogger('IntentClassifier');

export async function classifyIntent(
  chatLLM: BaseChatModel,
  userMessage: string
): Promise<UserIntent> {
  const systemPrompt = `You are an intent classification assistant for a web-navigation agent.
Classify the user's input message into one of the following intents:
- CONTINUE_TASK: The user is telling the agent to continue, scroll, load more, go to the next page, or proceed with the current task.
- MODIFY_TASK: The user is changing criteria, budget, brand preference, constraints, or options for the current active task (e.g. "change budget to 70k", "use Lenovo instead").
- NEW_TASK: The user is starting a brand new, unrelated task (e.g. "now search for flights", "go buy a laptop").
- QUESTION: The user is asking a question about status, findings, or details without requesting a navigation action (e.g. "what is the price?").
- REFERENCE_PREVIOUS_TASK: The user is asking a question about previous tasks, recalling a past decision, fact, or completed goal (e.g. "what laptop did we choose earlier?", "what was the tracking number of the previous booking?").

Respond ONLY with a JSON object in this format:
{
  "intent": "CONTINUE_TASK" | "MODIFY_TASK" | "NEW_TASK" | "QUESTION" | "REFERENCE_PREVIOUS_TASK"
}`;

  try {
    const messages = [
      new SystemMessage({ content: systemPrompt }),
      new HumanMessage({ content: `Classify this message: "${userMessage}"` }),
    ];

    // Try structured output
    try {
      if (typeof chatLLM.withStructuredOutput === 'function') {
        const intentSchema = z.object({
          intent: z.enum([
            'CONTINUE_TASK',
            'MODIFY_TASK',
            'NEW_TASK',
            'QUESTION',
            'REFERENCE_PREVIOUS_TASK',
          ]),
        });
        const structuredLlm = chatLLM.withStructuredOutput(intentSchema);
        const res = await structuredLlm.invoke(messages) as any;
        if (res && res.intent) {
          logger.info(`Classified intent (structured): ${res.intent}`);
          return res.intent as UserIntent;
        }
      }
    } catch (structuredErr) {
      logger.warning('Structured intent classification failed, falling back', structuredErr);
    }

    // Fallback: raw invoke and parse
    const response = await chatLLM.invoke(messages);
    const content = typeof response.content === 'string' ? response.content : '';

    const match = content.match(/CONTINUE_TASK|MODIFY_TASK|NEW_TASK|QUESTION|REFERENCE_PREVIOUS_TASK/);
    if (match) {
      logger.info(`Classified intent (parsed): ${match[0]}`);
      return match[0] as UserIntent;
    }
  } catch (err) {
    logger.error('Failed to classify intent:', err);
  }

  // Default fallback
  logger.info('Intent classification failed or defaulted. Defaulting to: NEW_TASK');
  return 'NEW_TASK';
}

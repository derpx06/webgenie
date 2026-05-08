import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { filterExternalContent } from '../../messages/utils';
import type { PlannerOutput } from '../planner';

/**
 * Prepares messages for the planner, optionally stripping images if vision is not enabled for planning.
 */
export function preparePlannerMessages(
  systemMessage: BaseMessage,
  messages: BaseMessage[],
  useVision: boolean,
  useVisionForPlanner: boolean
): BaseMessage[] {
  // Use full message history except the first one (which is usually the system message from another context)
  const plannerMessages = [systemMessage, ...messages.slice(1)];

  // Remove images from last message if vision is not enabled for planner but vision is enabled globally
  if (!useVisionForPlanner && useVision) {
    const lastStateMessage = plannerMessages[plannerMessages.length - 1];
    let newMsg = '';

    if (Array.isArray(lastStateMessage.content)) {
      for (const msg of lastStateMessage.content) {
        if (msg.type === 'text') {
          newMsg += msg.text;
        }
      }
    } else {
      newMsg = lastStateMessage.content as string;
    }

    plannerMessages[plannerMessages.length - 1] = new HumanMessage(newMsg);
  }

  return plannerMessages;
}

/**
 * Cleans the model output by filtering out sensitive or external content.
 */
export function cleanPlannerOutput(output: PlannerOutput): PlannerOutput {
  return {
    ...output,
    observation: filterExternalContent(output.observation, false),
    final_answer: filterExternalContent(output.final_answer, false),
    next_steps: filterExternalContent(output.next_steps, false),
    challenges: filterExternalContent(output.challenges, false),
    reasoning: filterExternalContent(output.reasoning, false),
  };
}

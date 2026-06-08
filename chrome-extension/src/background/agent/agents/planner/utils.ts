import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { PlannerOutput } from '../planner';

/**
 * Prepares messages for the planner, optionally stripping images if vision is not enabled for planning.
 */
export function preparePlannerMessages(
  messages: BaseMessage[],
  useVision: boolean,
  useVisionForPlanner: boolean
): BaseMessage[] {
  const plannerMessages = [...messages];

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
 * Cleans the model output — passthrough only.
 *
 * The planner is a trusted LLM. Running its own observation/reasoning/next_steps
 * text through filterExternalContent caused false-positive `task_override` and
 * `prompt_injection` detections every step (e.g. "Your new task is to summarize
 * unread messages" trips the regex). These fields are internal agent reasoning,
 * NOT untrusted web content — sanitizing them is both wrong and noisy.
 */
export function cleanPlannerOutput(output: PlannerOutput): PlannerOutput {
  return { ...output };
}

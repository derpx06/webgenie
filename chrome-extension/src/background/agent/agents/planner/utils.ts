import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { PlannerOutput } from '../planner';
import { createFallbackContract, normalizePlannerOutputContract } from '../../contracts';
import type { BrowserObservation } from '../../validation/types';
import type { MacroObjective, NextStepContract } from '../../contracts';

type PlannerOutputInput = Omit<PlannerOutput, 'next_step_contract'> & {
  next_step_contract?: unknown;
};

const PARSE_FALLBACK_ALLOWED_ACTIONS = [
  'go_to_url',
  'search_google',
  'search_web',
  'open_tab',
  'switch_tab',
  'close_tab',
  'click_element',
  'input_text',
  'scroll_to_percent',
  'scroll_to_top',
  'scroll_to_bottom',
  'wait',
  'ask_human',
  'done',
];

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
export function cleanPlannerOutput(
  output: PlannerOutputInput,
  context?: { goal?: string; currentObservation?: BrowserObservation | null },
): PlannerOutput {
  return normalizePlannerOutputContract(output, {
    goal: context?.goal ?? output.observation ?? 'Continue task safely',
    currentObservation: context?.currentObservation ?? null,
  });
}

function targetText(target: BrowserObservation['targets'][number]): string {
  return [
    target.accessibleName,
    target.role,
    target.tagName,
    target.xpath,
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasActionableTarget(observation: BrowserObservation | null): boolean {
  if (!observation) return false;
  return observation.targets.some(target => {
    const text = targetText(target);
    return /\b(follow|continue|submit|send|save|confirm|accept|allow|open|view|sign in|log in|login)\b/.test(text);
  });
}

function hasHumanBlocker(observation: BrowserObservation | null): boolean {
  if (!observation) return false;
  return observation.targets.some(target => {
    const text = targetText(target);
    return /\b(sign in|log in|login|password|passcode|2fa|two-factor|captcha|permission required|verify|verification)\b/.test(text);
  });
}

function chooseFallbackMacroObjective(observation: BrowserObservation | null): MacroObjective {
  if (!observation?.url) return 'NAVIGATE';
  if (hasHumanBlocker(observation)) return 'ASK_HUMAN';
  if (hasActionableTarget(observation)) return 'NAVIGATE';
  return 'EXPLORE_PAGE';
}

function fallbackAllowedActions(macroObjective: MacroObjective): string[] {
  if (macroObjective === 'ASK_HUMAN') return ['ask_human', 'wait', 'done'];
  if (macroObjective === 'NAVIGATE') {
    return [
      'go_to_url',
      'search_google',
      'search_web',
      'open_tab',
      'switch_tab',
      'click_element',
      'wait',
      'ask_human',
      'done',
    ];
  }
  return PARSE_FALLBACK_ALLOWED_ACTIONS;
}

export function createPlannerParseFallbackOutput(context: {
  goal?: string;
  currentObservation?: BrowserObservation | null;
  reason?: string;
}): PlannerOutput {
  const goal = context.goal?.trim() || 'Continue task safely';
  const currentObservation = context.currentObservation ?? null;
  const macroObjective = chooseFallbackMacroObjective(currentObservation);
  const reason = context.reason?.trim() || 'Planner model response could not be parsed as valid JSON.';
  const contract = createFallbackContract({
    goal,
    currentObservation,
    mode: 'multi_step_task',
    macroObjective,
    allowedActions: fallbackAllowedActions(macroObjective),
    successCondition: 'Continue the task using validated browser actions and replan if validation is unknown or failed.',
    failureSignals: [
      reason,
      'Current observation does not contain enough actionable state.',
      'The next browser action validates as failed or unknown.',
    ],
  });

  return {
    observation: currentObservation
      ? `Planner response was invalid. Current page is ${currentObservation.title || currentObservation.url || 'unknown page'} at ${currentObservation.url || 'unknown URL'}.`
      : 'Planner response was invalid and no browser observation is available.',
    challenges: reason,
    done: false,
    macro_objective: macroObjective,
    final_answer: '',
    reasoning: 'Using a conservative fallback contract instead of failing the task because planner JSON parsing failed.',
    web_task: true,
    mode: 'multi_step_task',
    next_goal: goal,
    allowed_actions: fallbackAllowedActions(macroObjective),
    success_condition: 'Continue the task using validated browser actions and replan if validation is unknown or failed.',
    failure_signals: [
      reason,
      'Current observation does not contain enough actionable state.',
      'The next browser action validates as failed or unknown.',
    ],
    target_indexes: [],
    next_step_contract: contract,
  };
}

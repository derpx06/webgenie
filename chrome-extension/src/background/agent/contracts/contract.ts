import type { BrowserObservation } from '../validation/types';
import { macroObjectiveSchema, nextStepContractSchema, planningModeSchema } from './schema';
import type { MacroObjective, NextStepContract, PlannerContractContext, PlannerLLMOutput, PlanningMode } from './types';

function safeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function observationId(observation?: BrowserObservation | null): string | null {
  return observation?.id ?? null;
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

const ALLOWED_ACTIONS_BY_MACRO_OBJECTIVE: Record<MacroObjective, string[]> = {
  NAVIGATE: ['go_to_url', 'search_google', 'search_web', 'open_tab', 'switch_tab', 'click_element', 'wait', 'done'],
  SEARCH: ['search_web', 'search_google', 'input_text', 'click_element', 'send_keys', 'wait', 'done'],
  FORM_FILL: ['input_text', 'click_element', 'select_dropdown_option', 'get_dropdown_options', 'send_keys', 'wait', 'done'],
  EXTRACT_DATA: ['get_complete_page_content', 'cache_content', 'scroll_to_text', 'scroll_to_percent', 'wait', 'done'],
  VERIFY_STATE: ['wait', 'get_complete_page_content', 'done'],
  BROWSER_CONTROL: [
    'open_tab',
    'close_tab',
    'switch_tab',
    'manage_tabs',
    'manage_windows',
    'manage_bookmarks',
    'manage_reading_list',
    'manage_history',
    'manage_downloads',
    'manage_privacy',
    'manage_extensions',
    'manage_system',
    'manage_sessions',
    'wait',
    'done',
  ],
  HANDLE_BLOCKER: ['click_element', 'input_text', 'wait', 'ask_human', 'done'],
  EXPLORE_PAGE: ['scroll_to_percent', 'scroll_to_top', 'scroll_to_bottom', 'scroll_to_text', 'click_element', 'wait', 'done'],
  ASK_HUMAN: ['ask_human', 'wait', 'done'],
};

function filterAllowedActions(macroObjective: MacroObjective, requested: string[]): string[] {
  const allowedForMacro = ALLOWED_ACTIONS_BY_MACRO_OBJECTIVE[macroObjective];
  const requestedAllowed = requested.filter(action => allowedForMacro.includes(action));
  if (requestedAllowed.length > 0) return [...new Set(requestedAllowed)];
  return allowedForMacro;
}

function contractMode(output: PlannerLLMOutput): PlanningMode {
  if (output.done || !output.web_task) return 'direct_answer';
  if (output.macro_objective === 'ASK_HUMAN') return 'blocked_human_needed';
  return output.mode === 'direct_answer' ? 'single_browser_action' : output.mode;
}

export function buildNextStepContractFromPlannerOutput(
  output: PlannerLLMOutput,
  context: PlannerContractContext,
): NextStepContract | null {
  const mode = contractMode(output);
  if (mode === 'direct_answer') return null;

  const macroObjective = output.macro_objective;
  const requestedActions = Array.isArray(output.allowed_actions) ? output.allowed_actions : [];
  const requestedTargetIndexes = Array.isArray(output.target_indexes) ? output.target_indexes : [];
  const filteredActions = filterAllowedActions(macroObjective, requestedActions);
  const targetIndexes = requestedTargetIndexes.filter(index =>
    Number.isInteger(index) && (context.currentObservation?.targets.some(target => target.index === index) ?? false)
  );

  return {
    id: safeId('contract'),
    mode,
    goal: stringField(output.next_goal, stringField(context.goal, 'Continue task safely')),
    macroObjective,
    allowedActions: filteredActions,
    expectedObservation: {
      observationId: observationId(context.currentObservation),
      ...(targetIndexes.length > 0 ? { requiredTargetIndexes: targetIndexes } : {}),
    },
    successCondition: stringField(
      output.success_condition,
      stringField(output.reasoning, stringField(output.observation, 'Complete the next planned step.')),
    ),
    failureSignals: Array.isArray(output.failure_signals) && output.failure_signals.length > 0
      ? output.failure_signals
      : (output.challenges ? [output.challenges] : ['Validation failed or became unknown.']),
    replanTrigger: mode === 'blocked_human_needed' ? 'human_needed' : 'validation_failed',
    createdAt: Date.now(),
  };
}

export function createFallbackContract(params: PlannerContractContext & {
  mode?: PlanningMode;
  macroObjective?: MacroObjective;
  allowedActions?: string[];
  successCondition?: string;
  failureSignals?: string[];
}): NextStepContract {
  const mode = params.mode ?? 'blocked_human_needed';
  const macroObjective = params.macroObjective ?? 'ASK_HUMAN';
  return {
    id: safeId('contract'),
    mode,
    goal: params.goal || 'Continue task safely',
    macroObjective,
    allowedActions: params.allowedActions ?? (mode === 'blocked_human_needed' ? ['ask_human'] : []),
    expectedObservation: {
      observationId: observationId(params.currentObservation),
    },
    successCondition: params.successCondition ?? 'A safe next step is established before any browser mutation.',
    failureSignals: params.failureSignals ?? ['Planner contract was missing or malformed.'],
    replanTrigger: mode === 'blocked_human_needed' ? 'human_needed' : 'validation_unknown',
    createdAt: Date.now(),
  };
}

export function normalizeNextStepContract(
  raw: unknown,
  context: PlannerContractContext,
): NextStepContract {
  const parsed = nextStepContractSchema.safeParse(raw);
  if (!parsed.success) return createFallbackContract(context);

  const contract = parsed.data;
  const expectedObservation = {
    ...contract.expectedObservation,
    observationId: contract.expectedObservation.observationId ?? observationId(context.currentObservation),
  };

  return {
    ...contract,
    goal: contract.goal || context.goal || 'Continue task safely',
    allowedActions: contract.allowedActions.length > 0 ? contract.allowedActions : ['ask_human'],
    expectedObservation,
    failureSignals: contract.failureSignals.length > 0 ? contract.failureSignals : ['No explicit failure signals supplied.'],
  };
}

export function normalizePlannerOutputContract<T extends Record<string, unknown>>(
  output: T,
  context: PlannerContractContext,
): T & { mode: PlanningMode; next_step_contract: NextStepContract | null } {
  const modeParsed = planningModeSchema.safeParse(output.mode);
  const macroParsed = macroObjectiveSchema.safeParse(output.macro_objective);
  const mode = modeParsed.success ? modeParsed.data : (output.done ? 'direct_answer' : 'multi_step_task');

  if (output.done === true && mode === 'direct_answer') {
    return {
      ...output,
      mode,
      next_step_contract: null,
    };
  }

  const currentObservation = context.currentObservation;
  const fallbackContext = {
    goal: stringField(context.goal, stringField(output.observation, 'Continue task safely')),
    currentObservation,
  };
  const plannerOutput = output as unknown as PlannerLLMOutput;
  const normalizedContract = macroParsed.success
    ? buildNextStepContractFromPlannerOutput(plannerOutput, fallbackContext)
    : createFallbackContract({
      ...fallbackContext,
      mode,
      macroObjective: 'EXPLORE_PAGE',
      allowedActions: [],
      successCondition: stringField(output.reasoning, stringField(output.observation, 'Complete the next planned step.')),
      failureSignals: typeof output.challenges === 'string' && output.challenges
        ? [output.challenges]
        : ['Validation failed or became unknown.'],
    });

  return {
    ...output,
    mode,
    next_step_contract: normalizedContract,
  };
}

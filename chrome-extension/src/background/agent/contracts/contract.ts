import type { BrowserObservation } from '../validation/types';
import { macroObjectiveSchema, nextStepContractSchema } from './schema';
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

function contractMode(output: PlannerLLMOutput): PlanningMode {
  if (output.done) return 'direct_answer';
  return output.macro_objective === 'ASK_HUMAN' ? 'blocked_human_needed' : 'multi_step_task';
}

export function buildNextStepContractFromPlannerOutput(
  output: PlannerLLMOutput,
  context: PlannerContractContext,
): NextStepContract | null {
  const mode = contractMode(output);
  if (mode === 'direct_answer') return null;

  return {
    id: safeId('contract'),
    mode,
    goal: stringField(output.next_goal, stringField(context.goal, 'Continue task safely')),
    macroObjective: output.macro_objective,
    expectedObservation: {
      observationId: observationId(context.currentObservation),
    },
    successCondition: stringField(output.success_condition, stringField(output.next_goal, 'Complete the next planned step.')),
    failureSignals: ['Validation failed or became unknown.'],
    createdAt: Date.now(),
  };
}

export function createFallbackContract(params: PlannerContractContext & {
  mode?: PlanningMode;
  macroObjective?: MacroObjective;
  successCondition?: string;
  failureSignals?: string[];
}): NextStepContract {
  return {
    id: safeId('contract'),
    mode: params.mode ?? 'blocked_human_needed',
    goal: params.goal || 'Continue task safely',
    macroObjective: params.macroObjective ?? 'ASK_HUMAN',
    expectedObservation: {
      observationId: observationId(params.currentObservation),
    },
    successCondition: params.successCondition ?? 'A safe next step is established before any browser mutation.',
    failureSignals: params.failureSignals ?? ['Planner contract was missing or malformed.'],
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
  return {
    ...contract,
    goal: contract.goal || context.goal || 'Continue task safely',
    expectedObservation: {
      ...contract.expectedObservation,
      observationId: contract.expectedObservation.observationId ?? observationId(context.currentObservation),
    },
    failureSignals: contract.failureSignals.length > 0 ? contract.failureSignals : ['No explicit failure signals supplied.'],
  };
}

export function normalizePlannerOutputContract<T extends Record<string, unknown>>(
  output: T,
  context: PlannerContractContext,
): T & { mode: PlanningMode; next_step_contract: NextStepContract | null } {
  const plannerOutput = output as unknown as PlannerLLMOutput;
  const macroParsed = macroObjectiveSchema.safeParse(output.macro_objective);
  const mode: PlanningMode = output.done === true
    ? 'direct_answer'
    : macroParsed.success ? contractMode(plannerOutput) : 'multi_step_task';

  if (mode === 'direct_answer') {
    return { ...output, mode, next_step_contract: null };
  }

  const fallbackContext = {
    goal: stringField(context.goal, stringField(output.next_goal, 'Continue task safely')),
    currentObservation: context.currentObservation,
  };
  const nextStepContract = macroParsed.success
    ? buildNextStepContractFromPlannerOutput(plannerOutput, fallbackContext)
    : createFallbackContract({
      ...fallbackContext,
      mode,
      macroObjective: 'EXPLORE_PAGE',
      successCondition: stringField(output.next_goal, 'Complete the next planned step.'),
      failureSignals: ['Validation failed or became unknown.'],
    });

  return { ...output, mode, next_step_contract: nextStepContract };
}

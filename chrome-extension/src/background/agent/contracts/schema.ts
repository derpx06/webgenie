import { z } from 'zod';

export const planningModeSchema = z.enum([
  'direct_answer',
  'single_browser_action',
  'short_task',
  'multi_step_task',
  'research',
  'blocked_human_needed',
]);

export const replanTriggerSchema = z.enum([
  'validation_failed',
  'validation_unknown',
  'observation_changed',
  'contract_complete',
  'human_needed',
  'step_interval',
  'progress_stall',
  'fatal_error',
]);

export const macroObjectiveSchema = z.enum([
  'NAVIGATE',
  'SEARCH',
  'FORM_FILL',
  'EXTRACT_DATA',
  'VERIFY_STATE',
  'BROWSER_CONTROL',
  'HANDLE_BLOCKER',
  'EXPLORE_PAGE',
  'ASK_HUMAN',
]);

export const nextStepContractSchema = z.object({
  id: z.string(),
  mode: planningModeSchema,
  goal: z.string(),
  macroObjective: macroObjectiveSchema,
  allowedActions: z.array(z.string()),
  expectedObservation: z.object({
    observationId: z.string().nullable(),
    urlPattern: z.string().optional(),
    requiredTargetIndexes: z.array(z.number()).optional(),
    expectedDocumentChange: z.boolean().optional(),
    expectedLayoutChange: z.boolean().optional(),
  }),
  successCondition: z.string(),
  failureSignals: z.array(z.string()),
  replanTrigger: replanTriggerSchema,
  createdAt: z.number(),
});

const booleanLikeSchema = z.union([
  z.boolean(),
  z.string().transform(val => {
    const low = val.toLowerCase();
    if (low === 'true') return true;
    if (low === 'false') return false;
    throw new Error('Invalid boolean string');
  }),
]);

export const plannerLLMOutputSchema = z.object({
  observation: z.string().default(''),
  challenges: z.string().default(''),
  done: booleanLikeSchema.default(false),
  macro_objective: macroObjectiveSchema.default('NAVIGATE'),
  final_answer: z.string().default(''),
  reasoning: z.string().default(''),
  web_task: booleanLikeSchema.default(true),
  mode: planningModeSchema.default('multi_step_task'),
  next_goal: z.string().default(''),
  allowed_actions: z.array(z.string()).default([]),
  success_condition: z.string().default(''),
  failure_signals: z.array(z.string()).default([]),
  target_indexes: z.array(z.number()).default([]),
});

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

export const plannerLLMOutputSchema = z.object({
  done: z
    .boolean()
    .describe('true only when the whole user task is complete and verified on the current page, or needs no browsing at all'),
  final_answer: z
    .string()
    .optional()
    .describe('When done is true: the complete answer for the user, including every requested value. Omit otherwise.'),
  macro_objective: macroObjectiveSchema.describe(
    'Kind of work for the next phase. NAVIGATE: open URLs or top-level links. SEARCH: search or filter. FORM_FILL: type, select, check, hover or submit. EXTRACT_DATA: read page content. VERIFY_STATE: confirm a result, or finish. BROWSER_CONTROL: tabs, windows, bookmarks, history, downloads and other browser features. HANDLE_BLOCKER: dismiss popups, cookie banners or modals. EXPLORE_PAGE: scroll to find content. ASK_HUMAN: the user must act or decide.',
  ),
  next_goal: z.string().describe('The immediate goal for the navigator in one sentence, using exact values from the task'),
  allowed_actions: z
    .array(z.string())
    .optional()
    .describe('Optional: action names the navigator needs for this phase beyond the usual ones for the macro_objective'),
  success_condition: z
    .string()
    .optional()
    .describe('Optional: observable evidence on the page that the next phase succeeded'),
});

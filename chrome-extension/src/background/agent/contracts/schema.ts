import { z } from 'zod';

const planningModeSchema = z.enum([
  'direct_answer',
  'single_browser_action',
  'multi_step_task',
  'blocked_human_needed',
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
  expectedObservation: z.object({
    observationId: z.string().nullable(),
    urlPattern: z.string().optional(),
    expectedDocumentChange: z.boolean().optional(),
  }),
  successCondition: z.string(),
  failureSignals: z.array(z.string()),
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
    'Kind of work for the next phase. NAVIGATE: open URLs or top-level links. SEARCH: search or filter. FORM_FILL: type, select, check, hover or submit. EXTRACT_DATA: read page content. VERIFY_STATE: confirm a result, or finish. BROWSER_CONTROL: tabs, windows, bookmarks, history, downloads and other browser features. HANDLE_BLOCKER: dismiss popups, cookie banners or modals. EXPLORE_PAGE: scroll, read or look at the page to find content, without clicking anything that changes it. ASK_HUMAN: the user must confirm an important action or provide something only they have (never for what the task or page already says).',
  ),
  next_goal: z.string().describe('The immediate goal for the navigator in one sentence, using exact values from the task'),
  matching_items: z
    .array(z.string())
    .optional()
    .describe(
      'When the next phase acts on one single item the task describes (a product, listing, result, person or date): every item on the current page whose name or description fits the words the task uses for it — all of them, not only the one you would pick — each with what sets it apart, e.g. "Room A, 2 beds, $120". Omit it when the task asks for several items, all matching items, or picks one by a rule such as cheapest, first or newest.',
    ),
  success_condition: z
    .string()
    .optional()
    .describe('Optional: observable evidence on the page that the next phase succeeded'),
  // Required, so the planner decides on every plan: left optional, it was almost never set (9 of 13 done checks in a live run).
  final_phase: z.boolean().describe('true when finishing next_goal finishes the whole task (nothing is left after it); false otherwise'),
});

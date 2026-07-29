import type { BrowserObservation, Retryability, ValidationEvidence } from '../validation/types';

export type PlanningMode =
  | 'direct_answer'
  | 'single_browser_action'
  | 'short_task'
  | 'multi_step_task'
  | 'research'
  | 'blocked_human_needed';

export type ReplanTrigger =
  | 'validation_failed'
  | 'validation_unknown'
  | 'observation_changed'
  | 'contract_complete'
  | 'human_needed'
  | 'step_interval'
  | 'progress_stall'
  | 'fatal_error';

export type MacroObjective =
  | 'NAVIGATE'
  | 'SEARCH'
  | 'FORM_FILL'
  | 'EXTRACT_DATA'
  | 'VERIFY_STATE'
  | 'BROWSER_CONTROL'
  | 'HANDLE_BLOCKER'
  | 'EXPLORE_PAGE'
  | 'ASK_HUMAN';

export interface NextStepContract {
  id: string;
  mode: PlanningMode;
  goal: string;
  macroObjective: MacroObjective;
  allowedActions: string[];
  expectedObservation: {
    observationId: string | null;
    urlPattern?: string;
    requiredTargetIndexes?: number[];
    expectedDocumentChange?: boolean;
    expectedLayoutChange?: boolean;
  };
  successCondition: string;
  failureSignals: string[];
  replanTrigger: ReplanTrigger;
  createdAt: number;
}

export interface PlannerLLMOutput {
  observation: string;
  challenges: string;
  done: boolean;
  macro_objective: MacroObjective;
  final_answer: string;
  reasoning: string;
  web_task: boolean;
  mode: PlanningMode;
  next_goal: string;
  allowed_actions: string[];
  success_condition: string;
  failure_signals: string[];
  target_indexes: number[];
}

export interface ReplanDecision {
  shouldReplan: boolean;
  trigger: ReplanTrigger;
  reason: string;
  retryability: Retryability | null;
  failedContractId?: string;
}

export interface ValidatedProgressRecord {
  id: string;
  taskId: string;
  contractId: string;
  observationId: string | null;
  actionId: string | null;
  summary: string;
  status: 'completed' | 'blocked' | 'failed' | 'unknown';
  evidence: ValidationEvidence[];
  createdAt: number;
}

export interface BlockedState {
  kind: 'needs_human' | 'auth_required' | 'permission_required' | 'site_blocker' | 'ambiguous_goal';
  question: string;
  evidence: ValidationEvidence[];
  resumePolicy: 'resume_same_contract' | 'reobserve_then_resume' | 'replan_after_response';
}

export interface TaskCheckpoint {
  taskId: string;
  task: string;
  status: 'running' | 'waiting_human' | 'paused' | 'completed' | 'failed';
  step: number;
  currentContract: NextStepContract | null;
  lastObservationId: string | null;
  validatedProgress: ValidatedProgressRecord[];
  blockedState: BlockedState | null;
  updatedAt: number;
}

export interface TraceEvent {
  id: string;
  taskId: string;
  parentId?: string;
  actor: 'executor' | 'planner' | 'navigator' | 'validator' | 'checkpoint';
  type:
    | 'plan.created'
    | 'contract.activated'
    | 'observation.captured'
    | 'action.started'
    | 'action.validated'
    | 'replan.decided'
    | 'checkpoint.saved'
    | 'checkpoint.restored'
    | 'human.blocked'
    | 'task.completed'
    | 'task.failed';
  planId?: string;
  contractId?: string;
  observationId?: string;
  actionId?: string;
  validationId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface ContextBudgetReport {
  taskId: string;
  callId: string;
  actor: 'planner' | 'navigator';
  sections: Array<{
    name: string;
    estimatedTokens: number;
    included: boolean;
  }>;
  totalEstimatedInputTokens: number;
  outputTokens: number;
}

export interface PlannerContractContext {
  goal: string;
  currentObservation?: BrowserObservation | null;
}

export interface ActionLinkage {
  contractId: string | null;
  observationId: string | null;
  actionId: string;
  validationId: string;
}

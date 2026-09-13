import type { BrowserObservation, ValidationEvidence } from '../validation/types';

export type PlanningMode =
  | 'direct_answer'
  | 'single_browser_action'
  | 'multi_step_task'
  | 'blocked_human_needed';

export type ReplanTrigger =
  | 'initial'
  | 'human_needed'
  | 'contract_complete'
  | 'navigator_error'
  | 'validation'
  | 'progress_stall'
  | 'step_interval';

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
  expectedObservation: {
    observationId: string | null;
    urlPattern?: string;
    expectedDocumentChange?: boolean;
  };
  successCondition: string;
  failureSignals: string[];
  createdAt: number;
}

export interface PlannerLLMOutput {
  done: boolean;
  final_answer?: string;
  macro_objective: MacroObjective;
  next_goal: string;
  matching_items?: string[];
  success_condition?: string;
}

export interface ReplanDecision {
  shouldReplan: boolean;
  trigger: ReplanTrigger | 'none';
  reason: string;
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
  /** What a resumed executor needs besides the transcript (kept in session storage); absent in older checkpoints. */
  tabId?: number | null;
  tasks?: string[];
  pendingQuestion?: { type: string; question: string; details?: string; commitKey?: string } | null;
  approvedCommitKey?: string | null;
  declinedCommitKeys?: string[];
  /** Why a paused task stopped: the side panel closed, the agent's tab closed, the debugger was detached, no answer came. */
  interruption?: string | null;
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

export interface PlannerContractContext {
  goal: string;
  currentObservation?: BrowserObservation | null;
}

import { redactSecrets } from '../trace';
import type BrowserContext from '../browser/context';
import type { BrowserState } from '../browser/views';
import { DEFAULT_INCLUDE_ATTRIBUTES } from '../browser/dom/views';
import type { DOMHistoryElement } from '../browser/dom/history/view';
import type MessageManager from './messages/service';
import type { EventManager } from './event/manager';
import { type Actors, type ExecutionState, AgentEvent } from './event/types';
import { AgentStepHistory } from './history';
import { TaskArchive } from './memory';
import type { RouteStep } from './memory';
import type { RunTree } from 'langsmith';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type {
  BrowserObservation,
  ExecutionStatus,
  Retryability,
  TargetFingerprint,
  ValidationEvidence,
  ValidationStatus,
} from './validation/types';
import type {
  BlockedState,
  NextStepContract,
  ValidatedProgressRecord,
} from './contracts/types';
import type { TaskCheckpointStore } from './contracts/checkpoint';
import type { TraceStore } from './contracts/trace';

export interface AgentOptions {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  retryDelay: number;
  maxInputTokens: number;
  maxErrorLength: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  includeAttributes: string[];
  planningInterval: number;
  logDOMSnapshot: boolean; // log full DOM sent to LLM each step (dev option)
  /** Registers the manage_* tools (bookmarks, history, downloads, browsing data, extensions...); off unless the user turns them on. */
  enableBrowserDataTools: boolean;
  /** Accept the navigator's done without the planner's check when the evidence is complete (validation/done-evidence.ts). */
  acceptEvidencedDone: boolean;
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
  maxSteps: 100,
  maxActionsPerStep: 5,
  maxFailures: 3,
  retryDelay: 10,
  maxInputTokens: 128000,
  maxErrorLength: 400,
  useVision: false,
  useVisionForPlanner: true,
  includeAttributes: DEFAULT_INCLUDE_ATTRIBUTES,
  planningInterval: 3,
  logDOMSnapshot: false,
  enableBrowserDataTools: false,
  acceptEvidencedDone: false,
};

export class AgentContext {
  controller: AbortController;
  taskId: string;
  browserContext: BrowserContext;
  messageManager: MessageManager;
  eventManager: EventManager;
  options: AgentOptions;
  paused: boolean;
  stopped: boolean;
  consecutiveFailures: number;
  nSteps: number;
  stepInfo: AgentStepInfo | null;
  actionResults: ActionResult[];
  history: AgentStepHistory;
  finalAnswer: string | null;
  waitingForHuman: boolean;
  humanQuestion: string | null;
  lastGoal?: string;
  lastMacroObjective?: string; // macro_objective from last planner step
  activeObservation?: BrowserObservation;
  /** The last question to the user, so their answer can be read as a decision; `commitKey` marks a system confirmation. */
  pendingQuestion: { type: string; question: string; details?: string; commitKey?: string } | null;
  /** Why the task was stopped from outside without finishing (side panel or tab closed, no answer); it stays resumable. */
  interruption: string | null = null;
  /** The commit the user just approved; used by the next matching action only. */
  approvedCommitKey: string | null = null;
  /** Commits the user declined in this task; they are refused without asking again. */
  declinedCommitKeys = new Set<string>();
  /** Page-blind decisions on whether the user's request asks for an action (entering personal data, opening an address). */
  intentDecisions = new Map<string, boolean>();
  /** Pages this task has been on (host and path), so going back to one needs no check. */
  visitedUrls = new Set<string>();
  /** Passwords from the user's answers by placeholder, with the host they were given on; never sent to a model. */
  secrets = new Map<string, { value: string; host: string }>();
  /** Text typed into each field this task (frame key and backend node id), to catch replacing a value the user gave. */
  typedValues = new Map<string, string>();
  /** The tab's address when the current task began; relative instructions ("the next page") refer to it. */
  taskStartUrl: string | null = null;
  /** Labels of the last drag's source and target, to refuse repeating a drag that already happened. */
  lastDragKey: string | null = null;
  /** Completions refused this task because the answer quoted an action result; capped so a refusal never loops. */
  echoRejections = 0;
  /** The page read shown to the models this step; element indexes in their actions refer to it. */
  promptState?: BrowserState;
  currentContract?: NextStepContract | null;
  validatedProgress: ValidatedProgressRecord[];
  blockedState: BlockedState | null;
  checkpointStore?: TaskCheckpointStore;
  traceStore?: TraceStore;
  parentRun?: RunTree;
  traceCallbacks?: Callbacks;
  /** Finished tasks of this conversation, for follow-ups. */
  taskArchive = new TaskArchive();
  /** Where this task's successful actions happened, saved as a route once the planner confirms the task. */
  routeSteps: RouteStep[] = [];
  /** The saved route for this task's start page; undefined until read. */
  routeNote?: string;
  /** What the navigator kept with save_findings, oldest first; both agents see the newest every step. */
  findings: string[] = [];

  constructor(
    taskId: string,
    browserContext: BrowserContext,
    messageManager: MessageManager,
    eventManager: EventManager,
    options: Partial<AgentOptions>,
  ) {
    this.controller = new AbortController();
    this.taskId = taskId;
    this.browserContext = browserContext;
    this.messageManager = messageManager;
    this.eventManager = eventManager;
    this.options = { ...DEFAULT_AGENT_OPTIONS, ...options };

    this.paused = false;
    this.stopped = false;
    this.nSteps = 0;
    this.consecutiveFailures = 0;
    this.stepInfo = null;
    this.actionResults = [];
    this.history = new AgentStepHistory();
    this.finalAnswer = null;
    this.waitingForHuman = false;
    this.humanQuestion = null;
    this.pendingQuestion = null;
    this.typedValues.clear();
    this.lastDragKey = null;
    this.echoRejections = 0;
    this.currentContract = null;
    this.validatedProgress = [];
    this.blockedState = null;
  }

  async emitEvent(actor: Actors, state: ExecutionState, eventDetails: string, screenshot?: string) {
    const event = new AgentEvent(actor, state, {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      // A password typed this task never reaches the side panel either, even inside an answer that repeats it.
      details: redactSecrets(eventDetails),
      usage: {
        inputTokens: this.messageManager.cumulativeInputTokens,
        outputTokens: this.messageManager.cumulativeOutputTokens,
      },
    }, Date.now(), undefined, screenshot);
    await this.eventManager.emit(event);
  }

  async pause() {
    this.paused = true;
  }

  async resume() {
    this.paused = false;
  }

  async stop() {
    this.stopped = true;
    this.controller.abort();
  }
}

export class AgentStepInfo {
  stepNumber: number;
  maxSteps: number;

  constructor(params: { stepNumber: number; maxSteps: number }) {
    this.stepNumber = params.stepNumber;
    this.maxSteps = params.maxSteps;
  }
}

export class ActionResult {
  executed: boolean;
  executionStatus: ExecutionStatus;
  validated: ValidationStatus;
  evidence: ValidationEvidence[];
  retryability: Retryability;
  failureReason: string | null;
  observationId: string | null;
  targetFingerprint: TargetFingerprint | null;
  contractId: string | null;
  actionId: string | null;
  validationId: string | null;
  isDone: boolean;
  success: boolean;
  isWaitingForHuman: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;
  interactedElement: DOMHistoryElement | null;

  constructor(params: Partial<ActionResult> = {}) {
    this.executed = params.executed ?? false;
    this.executionStatus = params.executionStatus ?? 'not_attempted';
    this.validated = params.validated ?? 'not_applicable';
    this.evidence = params.evidence ?? [];
    this.retryability = params.retryability ?? 'none';
    this.failureReason = params.failureReason ?? null;
    this.observationId = params.observationId ?? null;
    this.targetFingerprint = params.targetFingerprint ?? null;
    this.contractId = params.contractId ?? null;
    this.actionId = params.actionId ?? null;
    this.validationId = params.validationId ?? null;
    this.isDone = params.isDone ?? false;
    this.success = params.success ?? false;
    this.isWaitingForHuman = params.isWaitingForHuman ?? false;
    this.interactedElement = params.interactedElement ?? null;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
  }
}

export class StepMetadata {
  stepStartTime: number;
  stepEndTime: number;
  inputTokens: number;
  stepNumber: number;

  constructor(stepStartTime: number, stepEndTime: number, inputTokens: number, stepNumber: number) {
    this.stepStartTime = stepStartTime;
    this.stepEndTime = stepEndTime;
    this.inputTokens = inputTokens;
    this.stepNumber = stepNumber;
  }

  /**
   * Calculate step duration in seconds
   */
  get durationSeconds(): number {
    return this.stepEndTime - this.stepStartTime;
  }
}

// Make AgentOutput generic with Zod schema
export interface AgentOutput<T = unknown> {
  /**
   * The unique identifier for the agent
   */
  id: string;

  /**
   * The result of the agent's step
   */
  result?: T;
  /**
   * The error that occurred during the agent's action
   */
  error?: string;
}

import { z } from 'zod';
import type BrowserContext from '../browser/context';
import { DEFAULT_INCLUDE_ATTRIBUTES } from '../browser/dom/views';
import type { DOMHistoryElement } from '../browser/dom/history/view';
import type MessageManager from './messages/service';
import type { EventManager } from './event/manager';
import { type Actors, type ExecutionState, AgentEvent } from './event/types';
import { AgentStepHistory } from './history';

/**
 * Records a single failed element interaction.
 * A selector is considered blocked once failCount reaches FAILURE_THRESHOLD (2).
 * Scoped to the URL where the failure occurred so that a page navigation
 * automatically gives all elements a clean slate.
 */
export interface FailureRecord {
  selector: string;    // CSS selector or XPath of the element
  url: string;         // page URL where the failure happened
  actionType: string;  // e.g. 'click_element' | 'input_text'
  failCount: number;   // incremented each time the page state does not change
}

/** Number of failures before a selector is considered blocked. */
export const FAILURE_THRESHOLD = 2;

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
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
  maxSteps: 100,
  maxActionsPerStep: 10,
  maxFailures: 3,
  retryDelay: 10,
  maxInputTokens: 128000,
  maxErrorLength: 400,
  useVision: false,
  useVisionForPlanner: true,
  includeAttributes: DEFAULT_INCLUDE_ATTRIBUTES,
  planningInterval: 3,
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
  stateMessageAdded: boolean;
  history: AgentStepHistory;
  finalAnswer: string | null;
  waitingForHuman: boolean;
  humanQuestion: string | null;
  /**
   * Self-reflection fields persisted across steps.
   * The navigator LLM fills these in every response; we carry them forward
   * so the agent knows what it just evaluated and what it remembered.
   * Without these, the agent "forgets" completed sub-goals and loops.
   */
  lastEvaluation: string;  // evaluation_previous_goal from last navigator step
  lastMemory: string;      // memory scratchpad from last navigator step

  /**
   * Phase 1 Memory — Failure Registry
   * Maps a composite key ("url|selector") → FailureRecord so failures are
   * scoped to the exact page they occurred on. Selectors with failCount ≥
   * FAILURE_THRESHOLD are flagged as blocked in the DOM prompt, forcing the
   * LLM to find an alternative interaction path.
   */
  failureRegistry: Map<string, FailureRecord>;

  /**
   * Register a failed interaction. Call this when an action produces no
   * visible page-state change (i.e. nothing happened).
   */
  registerFailure(selector: string, url: string, actionType: string): void {
    const key = `${url}|${selector}`;
    const existing = this.failureRegistry.get(key);
    if (existing) {
      existing.failCount++;
    } else {
      this.failureRegistry.set(key, { selector, url, actionType, failCount: 1 });
    }
    const count = this.failureRegistry.get(key)!.failCount;
    console.log(`[FailureRegistry] selector="${selector}" failCount=${count} url=${url}`);
  }

  /**
   * Returns true when a selector has accumulated ≥ FAILURE_THRESHOLD failures
   * on the given URL. Safe to call with any string — returns false when unknown.
   */
  isSelectorBlocked(selector: string, url: string): boolean {
    const key = `${url}|${selector}`;
    const record = this.failureRegistry.get(key);
    return (record?.failCount ?? 0) >= FAILURE_THRESHOLD;
  }

  /**
   * Clear all failure records for a given URL.
   * Called automatically when the browser navigates to a new page so that
   * fresh layouts are never penalised by failures from a prior page state.
   */
  clearFailuresForUrl(url: string): void {
    for (const [key, record] of this.failureRegistry.entries()) {
      if (record.url === url) {
        this.failureRegistry.delete(key);
      }
    }
  }

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
    this.stateMessageAdded = false;
    this.history = new AgentStepHistory();
    this.finalAnswer = null;
    this.waitingForHuman = false;
    this.humanQuestion = null;
    this.lastEvaluation = '';
    this.lastMemory = '';
    this.failureRegistry = new Map<string, FailureRecord>();
  }

  async emitEvent(actor: Actors, state: ExecutionState, eventDetails: string, screenshot?: string) {
    const event = new AgentEvent(actor, state, {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      details: eventDetails,
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
  isDone: boolean;
  success: boolean;
  isWaitingForHuman: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;
  interactedElement: DOMHistoryElement | null;

  constructor(params: Partial<ActionResult> = {}) {
    this.isDone = params.isDone ?? false;
    this.success = params.success ?? false;
    this.isWaitingForHuman = params.isWaitingForHuman ?? false;
    this.interactedElement = params.interactedElement ?? null;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
  }
}

export type WrappedActionResult = ActionResult & {
  toolCallId: string;
};

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

export const agentBrainSchema = z
  .object({
    evaluation_previous_goal: z.string(),
    memory: z.string(),
    next_goal: z.string(),
  })
  .describe('Current state of the agent');

export type AgentBrain = z.infer<typeof agentBrainSchema>;

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

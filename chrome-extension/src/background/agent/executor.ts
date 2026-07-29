import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ActionResult, AgentContext, type AgentOptions, type AgentOutput } from './types';
import { HumanMessage } from '@langchain/core/messages';
import { t } from '@extension/i18n';
import { NavigatorAgent, NavigatorActionRegistry } from './agents/navigator';
import { PlannerAgent, type PlannerOutput } from './agents/planner';
import { NavigatorPrompt } from './prompts/navigator';
import { PlannerPrompt } from './prompts/planner';
import { createLogger } from '@src/background/log';
import MessageManager from './messages/service';
import type BrowserContext from '../browser/context';
import { ActionBuilder } from './actions/builder';
import { EventManager } from './event/manager';
import { Actors, type EventCallback, EventType, ExecutionState } from './event/types';
import { ContextRouter, classifyIntent, type UserIntent } from './memory';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  ChatModelRateLimitError,
  ChatModelPaymentRequiredError,
  ExtensionConflictError,
  RequestCancelledError,
  MaxStepsReachedError,
  MaxFailuresReachedError,
  isAbortedError,
} from './agents/errors';
import { URLNotAllowedError } from '../browser/views';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import type { AgentStepHistory } from './history';
import type { GeneralSettingsConfig } from '@extension/storage';
import { analytics } from '../services/analytics';
import { Client, RunTree } from 'langsmith';
import { getLangchainCallbacks } from 'langsmith/langchain';
import {
  ExecutionRouter,
  TaskCheckpointStore,
  TraceStore,
  getReplanDecision,
  isCheckpointResumable,
  shouldForceReplanAfterResume,
} from './contracts';
import { ensureBrowserObservation } from './validation/observation';

const logger = createLogger('Executor');

function formatExecutionError(error: unknown): string {
  if (error instanceof MaxFailuresReachedError && error.cause) {
    const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
    return `${error.message}: ${cause}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface ExecutorExtraArgs {
  plannerLLM?: BaseChatModel;
  extractorLLM?: BaseChatModel;
  agentOptions?: Partial<AgentOptions>;
  generalSettings?: GeneralSettingsConfig;
}

export class Executor {
  private readonly navigator: NavigatorAgent;
  private readonly planner: PlannerAgent;
  private readonly context: AgentContext;
  private readonly plannerPrompt: PlannerPrompt;
  private readonly navigatorPrompt: NavigatorPrompt;
  private readonly generalSettings: GeneralSettingsConfig | undefined;
  private tasks: string[] = [];
  private lastPlanningStep = -1;
  private lastPlanningUrl: string | null = null;
  constructor(
    task: string,
    taskId: string,
    browserContext: BrowserContext,
    navigatorLLM: BaseChatModel,
    extraArgs?: Partial<ExecutorExtraArgs>,
  ) {
    const messageManager = new MessageManager(undefined, taskId);

    const plannerLLM = extraArgs?.plannerLLM ?? navigatorLLM;
    const extractorLLM = extraArgs?.extractorLLM ?? navigatorLLM;
    const eventManager = new EventManager();
    const context = new AgentContext(
      taskId,
      browserContext,
      messageManager,
      eventManager,
      extraArgs?.agentOptions ?? {},
    );

    this.generalSettings = extraArgs?.generalSettings;
    this.tasks.push(task);
    this.navigatorPrompt = new NavigatorPrompt(context.options.maxActionsPerStep);
    this.plannerPrompt = new PlannerPrompt();

    const actionBuilder = new ActionBuilder(context, extractorLLM);
    const navigatorActionRegistry = new NavigatorActionRegistry(actionBuilder.buildDefaultActions());

    // Initialize agents with their respective prompts
    this.navigator = new NavigatorAgent(navigatorActionRegistry, {
      chatLLM: navigatorLLM,
      context: context,
      prompt: this.navigatorPrompt,
    });

    this.planner = new PlannerAgent({
      chatLLM: plannerLLM,
      context: context,
      prompt: this.plannerPrompt,
    });

    this.context = context;
    this.context.checkpointStore = new TaskCheckpointStore();
    this.context.traceStore = new TraceStore();
    // Initialize message history
    this.context.messageManager.initTaskMessages(this.navigatorPrompt.getSystemMessage(), task);
  }

  subscribeExecutionEvents(callback: EventCallback): void {
    this.context.eventManager.subscribe(EventType.EXECUTION, callback);
  }

  clearExecutionEvents(): void {
    // Clear all execution event listeners
    this.context.eventManager.clearSubscribers(EventType.EXECUTION);
  }

  getContext(): AgentContext {
    return this.context;
  }

  getCurrentTabId(): number | null {
    return this.context.browserContext.getCurrentTabId();
  }

  addFollowUpTask(task: string): void {
    this.tasks.push(task);
    this.context.messageManager.addNewTask(task);

    // need to reset previous action results that are not included in memory
    this.context.actionResults = this.context.actionResults.filter(result => result.includeInMemory);
  }

  /**
   * Check if task is complete based on planner output and handle completion
   */
  private checkTaskCompletion(planOutput: AgentOutput<PlannerOutput> | null): boolean {
    if (planOutput?.result?.done) {
      logger.info('✅ Planner confirms task completion');
      if (planOutput.result.final_answer) {
        this.context.finalAnswer = planOutput.result.final_answer;
      }
      return true;
    }
    return false;
  }

  /**
   * Execute the task
   *
   * @returns {Promise<void>}
   */
  async execute(): Promise<void> {
    await this.context.messageManager.loadFromSession();
    await this.context.messageManager.loadWorkingMemory();
    const taskText = this.tasks[this.tasks.length - 1];

    // Reset the step counter
    const context = this.context;
    context.nSteps = 0;
    const allowedMaxSteps = this.context.options.maxSteps;
    await this.restoreCheckpointIfPresent(taskText);

    // Intent Classification Layer
    let intent: UserIntent = 'NEW_TASK';
    try {
      intent = await classifyIntent(this.navigator.getChatLLM(), taskText);
      logger.info(`[IntentClassification] Intent classified as: ${intent}`);
    } catch (err) {
      logger.error('Failed to classify user message intent:', err);
    }

    // Update goals based on intent
    const goalManager = this.context.memory.goalManager;
    if (this.context.nSteps === 0 || intent === 'NEW_TASK') {
      goalManager.updateGoals(taskText, taskText, 'Initialize task execution');
    } else if (intent === 'MODIFY_TASK') {
      goalManager.updateGoals(undefined, taskText, 'Modify task context');
      // Extract fact/constraint from modified task text as a best-effort fallback
      if (taskText.toLowerCase().includes('budget') || taskText.toLowerCase().includes('under') || taskText.toLowerCase().includes('avoid')) {
        this.context.memory.addConstraint(taskText, 'HIGH');
      } else {
        this.context.memory.addFact(taskText, 'MEDIUM');
      }
    } else if (intent === 'CONTINUE_TASK') {
      goalManager.updateGoals(undefined, undefined, taskText);
    } else if (intent === 'REFERENCE_PREVIOUS_TASK') {
      goalManager.updateGoals(undefined, undefined, `Querying archives: ${taskText}`);
    } else if (intent === 'QUESTION') {
      goalManager.updateGoals(undefined, undefined, `Answering question: ${taskText}`);
    }

    // Add task start event to conversation timeline
    this.context.memory.addTimelineEvent('TASK_STARTED', `Started task: "${taskText}"`, {
      taskId: this.context.taskId,
      task: taskText,
      intent,
    });

    // De-duplicate/supersede conflicting items
    this.context.memory.resolveConflicts();

    const execDivider = '═'.repeat(60);
    console.log(
      `\n[Executor] ${execDivider}\n` +
      `  TASK START\n` +
      `  taskId  : ${this.context.taskId}\n` +
      `  task    : ${taskText}\n` +
      `  intent  : ${intent}\n` +
      `  maxSteps: ${this.context.options.maxSteps}\n` +
      `  time    : ${new Date().toISOString()}\n` +
      `[Executor] ${execDivider}`,
    );
    logger.info(`🚀 Executing task: ${taskText}`);

    await this.saveCheckpoint(taskText, 'running');

    if (this.generalSettings?.enableTracing && this.generalSettings.langsmithApiKey) {
      try {
        const client = new Client({
          apiKey: this.generalSettings.langsmithApiKey,
          apiUrl: this.generalSettings.langsmithEndpoint || 'https://api.smith.langchain.com',
        });

        if (typeof globalThis.process !== 'undefined' && globalThis.process.env) {
          globalThis.process.env.LANGSMITH_TRACING = 'true';
          globalThis.process.env.LANGSMITH_ENDPOINT = this.generalSettings.langsmithEndpoint || 'https://api.smith.langchain.com';
          globalThis.process.env.LANGSMITH_API_KEY = this.generalSettings.langsmithApiKey;
          globalThis.process.env.LANGSMITH_PROJECT = this.generalSettings.langsmithProject || 'web-surfer';
          globalThis.process.env.LANGCHAIN_TRACING_V2 = 'true';
          globalThis.process.env.LANGCHAIN_API_KEY = this.generalSettings.langsmithApiKey;
          globalThis.process.env.LANGCHAIN_PROJECT = this.generalSettings.langsmithProject || 'web-surfer';
          globalThis.process.env.LANGCHAIN_CALLBACKS_BACKGROUND = 'false';
        }

        const runName = "WebGenie Task: " + (taskText.slice(0, 100) + (taskText.length > 100 ? '...' : ''));
        const parentRun = new RunTree({
          name: runName,
          run_type: "chain",
          inputs: { task: taskText },
          project_name: this.generalSettings.langsmithProject || 'web-genie',
          client,
        });

        await parentRun.postRun();
        this.context.parentRun = parentRun;
        this.context.traceCallbacks = await getLangchainCallbacks(parentRun);
      } catch (err) {
        logger.error('Failed to initialize LangSmith parent run:', err);
      }
    }

    try {
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, this.context.taskId);

      // Track task start
      void analytics.trackTaskStart(this.context.taskId);

      let step = 0;
      let latestPlanOutput: AgentOutput<PlannerOutput> | null = null;
      let navigatorDone = false;
      const deterministicRoute = ExecutionRouter.routeTask(taskText);
      if (deterministicRoute) {
        context.currentContract = deterministicRoute.contract;
        await this.trace('executor', 'contract.activated', {
          contractId: deterministicRoute.contract.id,
          payload: { source: 'deterministic_route', contract: deterministicRoute.contract },
        });
        context.actionResults = await this.navigator.executePreplannedActions(deterministicRoute.actions);
        await this.saveCheckpoint(taskText, 'running');
        navigatorDone = context.actionResults.some(result => result.validated === 'passed');
      }

      for (step = 0; step < allowedMaxSteps; step++) {
        context.stepInfo = {
          stepNumber: context.nSteps,
          maxSteps: context.options.maxSteps,
        };

        const stepDivider = '─'.repeat(60);
        console.log(
          `\n[Executor] ${stepDivider}\n` +
          `  STEP ${step + 1} / ${allowedMaxSteps}  |  taskId: ${context.taskId}\n` +
          `  time: ${new Date().toISOString()}\n` +
          `  consecutiveFailures: ${context.consecutiveFailures}\n` +
          `  memory: ${(context.messageManager.getWorkingMemory() || '(none)').slice(0, 200)}\n` +
          `  lastEval: ${(context.lastEvaluation || '(none)').slice(0, 200)}\n` +
          `[Executor] ${stepDivider}`,
        );
        logger.info(`🔄 Step ${step + 1} / ${allowedMaxSteps}`);
        if (await this.shouldStop()) {
          break;
        }

        // Run planner on cadence, completion handoff, or stagnation
        const replanDecision = this.getReplanDecision(step, navigatorDone);
        await this.trace('executor', 'replan.decided', {
          contractId: context.currentContract?.id,
          payload: { ...replanDecision },
        });
        if (this.planner && replanDecision.shouldReplan) {
          navigatorDone = false;
          latestPlanOutput = await this.runPlanner();
          await this.saveCheckpoint(taskText, 'running');

          // Check if task is complete after planner run
          if (this.checkTaskCompletion(latestPlanOutput)) {
            break;
          }
        }

        // Execute navigator
        navigatorDone = await this.navigate();
        await this.saveCheckpoint(taskText, context.waitingForHuman ? 'waiting_human' : 'running');

        // Compact history at the end of each step
        context.messageManager.compactHistory();
        context.messageManager.cutMessages();

        // If navigator indicates completion, the next periodic planner run will validate it
        if (navigatorDone) {
          logger.info('🔄 Navigator indicates completion - will be validated by next planner run');
        }
      }

      // Determine task completion status
      const isCompleted = latestPlanOutput?.result?.done === true;

      if (this.context.stopped) {
        context.memory.addTimelineEvent('TASK_COMPLETED', `Cancelled task: "${taskText}"`, {
          taskId: context.taskId,
          status: 'cancelled'
        });
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_task_cancel'));
        await this.saveCheckpoint(taskText, 'failed');

        // Track task cancellation
        void analytics.trackTaskCancelled(this.context.taskId);
      } else if (isCompleted) {
        // Extract facts & decisions for structured outcome
        const activeFacts = context.memory.getActiveItemsByType('fact').map(f => f.content);
        const activeDecisions = context.memory.getActiveItemsByType('decision').map(d => d.content);
        
        context.memory.taskArchive.addRecord({
          taskId: context.taskId,
          goal: taskText,
          outcome: context.finalAnswer || 'Task completed successfully',
          decisions: activeDecisions,
          facts: activeFacts,
          summary: `Completed goal: "${taskText}" with outcome: "${context.finalAnswer || 'Success'}"`
        });

        context.memory.addTimelineEvent('TASK_COMPLETED', `Completed task: "${taskText}"`, {
          taskId: context.taskId,
          outcome: context.finalAnswer || 'Success'
        });

        // Full A-MEM consolidation after successful task completion:
        // saves episodic note, links to related past notes (Zettelkasten),
        // and updates the domain KV intelligence record.
        try {
          const browserState = await context.browserContext.getState(false);
          const currentUrl = browserState.url;
          if (currentUrl) {
            const domain = new URL(currentUrl).hostname;
            const pagePath = ContextRouter.getPagePath(currentUrl);
            const layoutHash = context.activeLayoutHash || '';
            const finalAnswer = context.finalAnswer || '';
            await ContextRouter.consolidateAfterTask(
              domain,
              pagePath,
              layoutHash,
              this.tasks[0],
              finalAnswer,
              step,
            );
          }
        } catch (err) {
          logger.error('Failed to consolidate task memory:', err);
        }

        // Emit final answer if available, otherwise use task ID
        const finalMessage = this.context.finalAnswer || this.context.taskId;
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, finalMessage);
        await this.saveCheckpoint(taskText, 'completed');

        // Track task completion
        void analytics.trackTaskComplete(this.context.taskId);
      } else if (step >= allowedMaxSteps) {
        context.memory.addTimelineEvent('TASK_COMPLETED', `Failed task (Max steps reached): "${taskText}"`, {
          taskId: context.taskId,
          status: 'failed'
        });
        logger.error('❌ Task failed: Max steps reached');
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_errors_maxStepsReached'));
        await this.saveCheckpoint(taskText, 'failed');

        // Track task failure with specific error category
        const maxStepsError = new MaxStepsReachedError(t('exec_errors_maxStepsReached'));
        const errorCategory = analytics.categorizeError(maxStepsError);
        void analytics.trackTaskFailed(this.context.taskId, errorCategory);
      } else {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, t('exec_task_pause'));
        await this.saveCheckpoint(taskText, 'paused');
        // Note: We don't track pause as it's not a final state
      }

      if (this.context.parentRun) {
        try {
          let finalStatus = 'failed';
          let finalOutput: Record<string, unknown> = {};
          if (this.context.stopped) {
            finalStatus = 'cancelled';
            finalOutput = { status: 'cancelled' };
          } else if (isCompleted) {
            finalStatus = 'success';
            finalOutput = { status: 'completed', final_answer: this.context.finalAnswer || '' };
          } else if (step >= allowedMaxSteps) {
            finalOutput = { status: 'failed', error: 'Max steps reached' };
          } else {
            finalStatus = 'paused';
            finalOutput = { status: 'paused' };
          }
          await this.context.parentRun.end(finalOutput, undefined, undefined, { status: finalStatus });
          await this.context.parentRun.patchRun();
        } catch (err) {
          logger.error('Failed to end parent run:', err);
        }
      }
    } catch (error) {
      if (this.context.parentRun) {
        try {
          const errorMsg = error instanceof Error ? error.message : String(error);
          await this.context.parentRun.end(
            { error: errorMsg },
            errorMsg,
            undefined,
            { status: 'failed' },
          );
          await this.context.parentRun.patchRun();
        } catch (err) {
          logger.error('Failed to end parent run in catch block:', err);
        }
      }
      if (this.context.stopped || error instanceof RequestCancelledError || isAbortedError(error)) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_task_cancel'));

        // Track task cancellation
        void analytics.trackTaskCancelled(this.context.taskId);
      } else {
        const errorMessage = formatExecutionError(error);
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_task_fail', [errorMessage]));

        // Track task failure with detailed error categorization
        const errorCategory = analytics.categorizeError(error instanceof Error ? error : errorMessage);
        void analytics.trackTaskFailed(this.context.taskId, errorCategory);
      }
    } finally {
      try {
        await this.context.browserContext.removeHighlight();
      } catch (err) {
        logger.error('Failed to clean up highlights at task end:', err);
      }

      if (import.meta.env.DEV) {
        logger.debug('Executor history', JSON.stringify(this.context.history, null, 2));
      }

      try {
        const historyString = JSON.stringify(this.context.history);
        logger.info(`Executor history size: ${historyString.length}`);
        await chatHistoryStore.storeAgentStepHistory(this.context.taskId, this.tasks[0], historyString);
      } catch (err) {
        logger.error('Failed to store task step history:', err);
      }
    }
  }

  private getReplanDecision(step: number, navigatorDone: boolean) {
    const contractId = this.context.currentContract?.id ?? null;
    const retryAttempts = contractId ? (this.context.retrySameAttemptsByContract[contractId] ?? 0) : 0;
    const decision = getReplanDecision({
      step,
      navigatorDone,
      latestResults: this.context.actionResults,
      stepsSinceLastPlan: step - this.lastPlanningStep,
      planningInterval: this.context.options.planningInterval,
      progressStalled: this.hasRecentProgressStall() || this.hasHostChangedSinceLastPlan(),
      retrySameAttemptsForContract: retryAttempts,
      currentContractId: contractId,
    });

    const latest = [...this.context.actionResults].reverse().find(result => result.executed);
    if (contractId && latest?.retryability === 'retry_same' && !decision.shouldReplan) {
      this.context.retrySameAttemptsByContract[contractId] = retryAttempts + 1;
    }

    logger.info(`[Planner] Replan decision: ${decision.shouldReplan} trigger=${decision.trigger} reason=${decision.reason}`);
    return decision;
  }

  private hasHostChangedSinceLastPlan(): boolean {
    const currentTabId = this.context.browserContext.getCurrentTabId();
    if (!currentTabId) return false;
    const page = this.context.browserContext.getPageForTab(currentTabId);
    const currentUrl = page?.url();
    if (!currentUrl || !this.lastPlanningUrl) return false;
    try {
      const currentHost = new URL(currentUrl).hostname;
      const lastHost = new URL(this.lastPlanningUrl).hostname;
      return currentHost !== lastHost;
    } catch {
      return false;
    }
  }

  private async trace(
    actor: 'executor' | 'planner' | 'navigator' | 'validator' | 'checkpoint',
    type: Parameters<TraceStore['append']>[0]['type'],
    params: {
      contractId?: string | null;
      observationId?: string | null;
      actionId?: string;
      validationId?: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!this.context.traceStore) return;
    await this.context.traceStore.append({
      taskId: this.context.taskId,
      actor,
      type,
      contractId: params.contractId ?? undefined,
      observationId: params.observationId ?? undefined,
      actionId: params.actionId,
      validationId: params.validationId,
      payload: params.payload,
      timestamp: Date.now(),
    });
  }

  private async saveCheckpoint(
    task: string,
    status: 'running' | 'waiting_human' | 'paused' | 'completed' | 'failed',
  ): Promise<void> {
    if (!this.context.checkpointStore) return;
    const checkpoint = {
      taskId: this.context.taskId,
      task,
      status,
      step: this.context.nSteps,
      currentContract: this.context.currentContract ?? null,
      lastObservationId: this.context.activeObservation?.id ?? null,
      validatedProgress: this.context.validatedProgress,
      blockedState: this.context.blockedState,
      updatedAt: Date.now(),
    };
    await this.context.checkpointStore.save(checkpoint);
    await this.trace('checkpoint', 'checkpoint.saved', {
      contractId: checkpoint.currentContract?.id,
      observationId: checkpoint.lastObservationId,
      payload: { status, step: checkpoint.step },
    });
  }

  private async restoreCheckpointIfPresent(task: string): Promise<void> {
    if (!this.context.checkpointStore) return;
    const checkpoint = await this.context.checkpointStore.load(this.context.taskId);
    if (!isCheckpointResumable(checkpoint)) return;

    this.context.currentContract = checkpoint.currentContract;
    this.context.validatedProgress = checkpoint.validatedProgress;
    this.context.blockedState = checkpoint.blockedState;
    this.context.nSteps = checkpoint.step;
    await this.trace('checkpoint', 'checkpoint.restored', {
      contractId: checkpoint.currentContract?.id,
      observationId: checkpoint.lastObservationId,
      payload: { status: checkpoint.status, step: checkpoint.step, task },
    });

    try {
      const state = await this.context.browserContext.getState(false);
      const currentObservation = ensureBrowserObservation(state);
      this.context.activeObservation = currentObservation;
      if (shouldForceReplanAfterResume({
        checkpointObservationId: checkpoint.lastObservationId,
        currentObservationId: currentObservation.id,
      })) {
        this.context.actionResults = [new ActionResult({
          executed: false,
          validated: 'unknown',
          retryability: 'retry_reobserve',
          failureReason: 'Checkpoint observation differed from fresh browser observation after resume.',
          observationId: currentObservation.id,
          includeInMemory: true,
        })];
      }
    } catch (err) {
      logger.error('Failed to capture fresh observation while restoring checkpoint:', err);
    }
  }

  /**
   * Detect repeated planner/navigator outputs to break low-value loops early.
   * This keeps planning responsive when the agent is stuck on the same strategy.
   */
  private hasRecentProgressStall(): boolean {
    const records = this.context.history.history;
    if (records.length < 3) return false;

    const lastThree = records.slice(-3).map(r => (r.modelOutput || '').trim());
    if (lastThree.some(v => v.length === 0)) return false;

    // Exact output repetition is a strong signal of being stuck.
    return lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2];
  }

  /**
   * Helper method to run planner and store its output
   */
  private async runPlanner(): Promise<AgentOutput<PlannerOutput> | null> {
    const context = this.context;
    try {
      // Add current browser state to memory
      let positionForPlan = 0;
      if (this.tasks.length > 1 || this.context.nSteps > 0) {
        await this.navigator.addStateMessageToMemory();
        positionForPlan = this.context.messageManager.length() - 1;
      } else {
        positionForPlan = this.context.messageManager.length();
      }

      // Execute planner
      console.log(`\n[Planner] ── invoking LLM ── ${new Date().toISOString()}`);
      const planOutput = await this.planner.execute();
      this.lastPlanningStep = this.context.nSteps;
      const currentPage = await this.context.browserContext.getCurrentPage().catch(() => null);
      if (currentPage) {
        this.lastPlanningUrl = currentPage.url();
      }
      // If planner returned an error (e.g., LLM API crash), treat it as an execution failure
      // so it counts toward consecutiveFailures and eventually stops the loop.
      if (planOutput.error) {
        console.warn(`[Planner] ERROR: ${planOutput.error}`);
        throw new Error(planOutput.error);
      }
      if (planOutput.result) {
        const p = planOutput.result;
        context.lastGoal = p.macro_objective || p.observation || '';
        const planDivider = '─'.repeat(60);
        console.log(
          `\n[Planner] ${planDivider}\n` +
          `  done        : ${p.done}\n` +
          `  web_task    : ${p.web_task}\n` +
          `  observation : ${p.observation}\n` +
          `  challenges  : ${p.challenges}\n` +
          `  reasoning   : ${p.reasoning}\n` +
          `  macro_objective  : ${p.macro_objective}\n` +
          `  final_answer: ${p.final_answer}\n` +
          `[Planner] ${planDivider}`,
        );
        this.context.messageManager.addPlan(JSON.stringify(planOutput.result), positionForPlan);
      }
      return planOutput;
    } catch (error) {
      logger.error(`Failed to execute planner: ${error}`);
      if (
        error instanceof ChatModelAuthError ||
        error instanceof ChatModelBadRequestError ||
        error instanceof ChatModelForbiddenError ||
        error instanceof ChatModelRateLimitError ||
        error instanceof ChatModelPaymentRequiredError ||
        error instanceof URLNotAllowedError ||
        error instanceof RequestCancelledError ||
        error instanceof ExtensionConflictError ||
        error instanceof MaxFailuresReachedError
      ) {
        throw error;
      }
      context.consecutiveFailures++;
      logger.error(`Failed to execute planner: ${error}`);
      if (context.consecutiveFailures >= context.options.maxFailures) {
        throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'), error);
      }
      return null;
    }
  }

  private async navigate(): Promise<boolean> {
    const context = this.context;
    try {
      // Get and execute navigation action
      // check if the task is paused or stopped
      if (context.paused || context.stopped) {
        return false;
      }
      console.log(`\n[Navigator] ── invoking LLM ── step=${context.nSteps + 1}  ${new Date().toISOString()}`);
      const navOutput = await this.navigator.execute();
      // check if the task is paused or stopped
      if (context.paused || context.stopped) {
        return false;
      }
      context.nSteps++;
      if (navOutput.error) {
        throw new Error(navOutput.error);
      }

      // Check if navigator is waiting for human
      const results = context.actionResults;
      const latestResult = [...results].reverse().find(result => result.executed || result.validated !== 'not_applicable');
      if (results.some(r => r.isWaitingForHuman)) {
        const lastWaitingResult = [...results].reverse().find(r => r.isWaitingForHuman);
        if (lastWaitingResult) {
          context.waitingForHuman = true;
          let questionText = lastWaitingResult.extractedContent || 'The agent needs your input.';
          try {
            // Try to parse if it was emitted as a structural event
            const details = JSON.parse(lastWaitingResult.extractedContent || '{}');
            if (details.question) questionText = details.question;
          } catch (e) {
            // Fallback to legacy string format
          }
          context.humanQuestion = questionText;
          logger.info(`Agent is waiting for human: ${context.humanQuestion}`);
          return false;
        }
      }

      if (latestResult?.validated === 'passed' || navOutput.result?.done) {
        context.consecutiveFailures = 0;
      } else if (latestResult && (latestResult.validated === 'failed' || latestResult.validated === 'unknown')) {
        const failureDetail = latestResult.failureReason ?? latestResult.error ?? latestResult.validated;
        const isTransientRecovery = latestResult.retryability === 'retry_reobserve' || latestResult.retryability === 'retry_same';
        logger.warning(`Navigator action did not validate (${latestResult.retryability}): ${failureDetail}`);
        if (isTransientRecovery) {
          logger.info(`Transient navigator failure will be recovered by re-observation without consuming the failure budget: ${failureDetail}`);
        } else {
          context.consecutiveFailures++;
          if (context.consecutiveFailures >= context.options.maxFailures) {
            throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'), failureDetail);
          }
        }
      }

      if (navOutput.result?.done) {
        return true;
      }
    } catch (error) {
      logger.error(`Failed to execute step: ${error}`);
      if (
        error instanceof ChatModelAuthError ||
        error instanceof ChatModelBadRequestError ||
        error instanceof ChatModelForbiddenError ||
        error instanceof ChatModelRateLimitError ||
        error instanceof ChatModelPaymentRequiredError ||
        error instanceof URLNotAllowedError ||
        error instanceof RequestCancelledError ||
        error instanceof ExtensionConflictError
      ) {
        throw error;
      }
      context.consecutiveFailures++;
      logger.error(`Failed to execute step: ${error}`);
      if (context.consecutiveFailures >= context.options.maxFailures) {
        throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'), error);
      }
    }
    return false;
  }

  private async shouldStop(): Promise<boolean> {
    if (this.context.stopped) {
      logger.info('Agent stopped');
      return true;
    }

    while (this.context.paused || this.context.waitingForHuman) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (this.context.stopped) {
        return true;
      }
    }

    if (this.context.consecutiveFailures >= this.context.options.maxFailures) {
      logger.error(`Stopping due to ${this.context.options.maxFailures} consecutive failures`);
      return true;
    }

    return false;
  }

  async cancel(): Promise<void> {
    this.context.stop();
  }

  async resume(): Promise<void> {
    this.context.resume();
  }

  async pause(): Promise<void> {
    this.context.pause();
  }

  async submitHumanResponse(response: string): Promise<void> {
    logger.info(`Submitting human response: ${response}`);
    const humanMsg = new HumanMessage(`User response: ${response}`);
    this.context.messageManager.addMessageWithTokens(humanMsg);
    this.context.waitingForHuman = false;
    this.context.humanQuestion = null;
    // Emit resume event
    this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_RESUME, 'Human response received');
  }

  async cleanup(): Promise<void> {
    try {
      // Flush any pending batched telemetry to DB
      this.context.messageManager.flushTokenUsage();
      await this.context.browserContext.cleanup();
    } catch (error) {
      logger.error(`Failed to cleanup browser context: ${error}`);
    }
  }

  async getCurrentTaskId(): Promise<string> {
    return this.context.taskId;
  }

  /**
   * Replays a saved history of actions with error handling and retry logic.
   *
   * @param history - The history to replay
   * @param maxRetries - Maximum number of retries per action
   * @param skipFailures - Whether to skip failed actions or stop execution
   * @param delayBetweenActions - Delay between actions in seconds
   * @returns List of action results
   */
  async replayHistory(
    sessionId: string,
    maxRetries = 3,
    skipFailures = true,
    delayBetweenActions = 2.0,
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const replayLogger = createLogger('Executor:replayHistory');

    logger.info('replay task', this.tasks[0]);

    try {
      const historyFromStorage = await chatHistoryStore.loadAgentStepHistory(sessionId);
      if (!historyFromStorage) {
        throw new Error(t('exec_replay_historyNotFound'));
      }

      const history = JSON.parse(historyFromStorage.history) as AgentStepHistory;
      if (history.history.length === 0) {
        throw new Error(t('exec_replay_historyEmpty'));
      }
      logger.debug(`🔄 Replaying history: ${JSON.stringify(history, null, 2)}`);
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, this.context.taskId);

      for (let i = 0; i < history.history.length; i++) {
        const historyItem = history.history[i];

        // Check if execution should stop
        if (this.context.stopped) {
          replayLogger.info('Replay stopped by user');
          break;
        }

        // Execute the history step with enhanced method that handles all the logic
        const stepResults = await this.navigator.executeHistoryStep(
          historyItem,
          i,
          history.history.length,
          maxRetries,
          delayBetweenActions * 1000,
          skipFailures,
        );

        results.push(...stepResults);

        // If stopped during execution, break the loop
        if (this.context.stopped) {
          break;
        }
      }

      if (this.context.stopped) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_replay_cancel'));
      } else {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, t('exec_replay_ok'));
      }
    } catch (error) {
      const errorMessage = formatExecutionError(error);
      replayLogger.error(`Replay failed: ${errorMessage}`);
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_replay_fail', [errorMessage]));
    }

    return results;
  }
}

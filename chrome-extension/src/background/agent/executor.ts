import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ActionResult, AgentContext, type AgentOptions, type AgentOutput } from './types';
import { HumanMessage } from '@langchain/core/messages';
import { t } from '@extension/i18n';
import { NavigatorAgent, NavigatorActionRegistry } from './agents/navigator';
import { PlannerAgent, type PlannerOutput } from './agents/planner';
import type { ToolMode } from './agents/base';
import { NavigatorPrompt } from './prompts/navigator';
import { PlannerPrompt } from './prompts/planner';
import { createLogger } from '@src/background/log';
import { record, redactSecrets, registerSecret, setTraceContext } from '@src/background/trace';
import { doneEvidence } from './validation/done-evidence';
import MessageManager from './messages/service';
import type BrowserContext from '../browser/context';
import { ActionBuilder } from './actions/builder';
import { EventManager } from './event/manager';
import { Actors, type EventCallback, EventType, ExecutionState } from './event/types';
import { RouteMemory } from './memory';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  ChatModelRateLimitError,
  ProviderUnreachableError,
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
  type TaskCheckpoint,
} from './contracts';
import { ensureBrowserObservation } from './validation/observation';
import { echoesActionResult, hostOf, isApproval } from './validation/service';
import type { ValidationStatus } from './validation/types';

const logger = createLogger('Executor');

function formatExecutionError(error: unknown): string {
  if (error instanceof MaxFailuresReachedError && error.cause) {
    const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
    return `${error.message}: ${cause}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** One navigator step as the loop sees it: completion claimed, no usable action, and the last validation outcome. */
interface NavigatorStep {
  done: boolean;
  errored: boolean;
  outcome: ValidationStatus | null;
}

export interface ExecutorExtraArgs {
  plannerLLM?: BaseChatModel;
  navigatorToolMode?: ToolMode;
  plannerToolMode?: ToolMode;
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
  private running = false;
  private pendingAnswer: { response: string; secrets: string[] } | null = null;
  /** The latest plan expected its phase to finish the task. */
  private lastPlanFinalPhase = false;
  /** `actions|layoutFingerprint` per navigator step, for stall detection. */
  private stepKeys: string[] = [];
  constructor(
    task: string,
    taskId: string,
    browserContext: BrowserContext,
    navigatorLLM: BaseChatModel,
    extraArgs?: Partial<ExecutorExtraArgs>,
  ) {
    const messageManager = new MessageManager(undefined, taskId);

    const plannerLLM = extraArgs?.plannerLLM ?? navigatorLLM;
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
    // With vision, both prompts say the navigator can look at the page, so neither asks the user what it shows.
    this.navigatorPrompt = new NavigatorPrompt(context.options.maxActionsPerStep, context.options.useVision);
    this.plannerPrompt = new PlannerPrompt(context.options.useVision);

    const actionBuilder = new ActionBuilder(context);
    const navigatorActionRegistry = new NavigatorActionRegistry(actionBuilder.buildDefaultActions());

    // Initialize agents with their respective prompts
    this.navigator = new NavigatorAgent(navigatorActionRegistry, {
      chatLLM: navigatorLLM,
      context: context,
      prompt: this.navigatorPrompt,
      toolMode: extraArgs?.navigatorToolMode,
    });

    this.planner = new PlannerAgent({
      chatLLM: plannerLLM,
      context: context,
      prompt: this.plannerPrompt,
      toolMode: extraArgs?.plannerToolMode,
    });

    this.context = context;
    this.context.checkpointStore = new TaskCheckpointStore();
    this.context.traceStore = new TraceStore();
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
    // A new message is a new request: earlier confirmations and refusals were about the previous one.
    this.context.approvedCommitKey = null;
    this.context.declinedCommitKeys.clear();
    this.forgetRefusedIntents();

    // need to reset previous action results that are not included in memory
    this.context.actionResults = this.context.actionResults.filter(result => result.includeInMemory);
  }

  /**
   * Check if task is complete based on planner output and handle completion
   */
  private checkTaskCompletion(planOutput: AgentOutput<PlannerOutput> | null): boolean {
    if (planOutput?.result?.done) {
      const answer = planOutput.result.final_answer || this.context.finalAnswer || '';
      // An answer quoting "Clicked button with index 2" reports what the agent did, not what the page shows. Two refusals
      // at most: a model that keeps quoting it should not burn the task's time limit.
      if (echoesActionResult(answer) && this.context.echoRejections < 2) {
        this.context.echoRejections++;
        const msg = 'The answer quotes an action result ("Clicked …", "Dragged element …", "Input … into index …"), which is not page text. Answer again without quoting action results: describe only what the current page shows, or, if the task asks for no text, just say what was done. If a message the task asks for is still loading, wait and read it.';
        logger.warning(`Completion rejected: ${msg}`);
        // A rejected answer must not end the task as done if the loop stops before the planner decides again.
        planOutput.result.done = false;
        this.context.finalAnswer = null;
        this.context.actionResults = [new ActionResult({
          executed: false,
          validated: 'unknown',
          retryability: 'replan',
          failureReason: msg,
          extractedContent: msg,
          includeInMemory: true,
        })];
        return false;
      }
      logger.info('✅ Planner confirms task completion');
      // The navigator's done text is the provisional answer; a planner final_answer replaces it.
      this.context.finalAnswer = answer || null;
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
    this.context.messageManager.addTask(taskText);
    setTraceContext({ taskId: this.context.taskId, step: 0 });

    // Reset the step counter
    const context = this.context;
    context.nSteps = 0;
    context.interruption = null;
    this.running = true;
    const allowedMaxSteps = this.context.options.maxSteps;
    await this.restoreCheckpointIfPresent(taskText);
    if (this.pendingAnswer) {
      const { response, secrets } = this.pendingAnswer;
      this.pendingAnswer = null;
      await this.submitHumanResponse(response, secrets);
    }

    this.context.routeSteps = [];
    this.context.routeNote = undefined;
    // Findings belong to one task; a follow-up refers to earlier answers through the task archive.
    this.context.findings = [];

    const execDivider = '═'.repeat(60);
    console.log(
      `\n[Executor] ${execDivider}\n` +
      `  TASK START\n` +
      `  taskId  : ${this.context.taskId}\n` +
      `  task    : ${taskText}\n` +
      `  maxSteps: ${this.context.options.maxSteps}\n` +
      `  time    : ${new Date().toISOString()}\n` +
      `[Executor] ${execDivider}`,
    );
    logger.info(`🚀 Executing task: ${taskText}`);
    try {
      this.context.taskStartUrl = (await this.context.browserContext.getCurrentPage()).url() || null;
    } catch {
      this.context.taskStartUrl = null;
    }

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
      // A task restored while waiting for an answer asks its question again.
      if (context.waitingForHuman) this.reemitQuestion();

      // Track task start
      void analytics.trackTaskStart(this.context.taskId);

      let step = 0;
      let latestPlanOutput: AgentOutput<PlannerOutput> | null = null;
      let planned = false;
      let navigatorDone = false;
      let navigatorErrored = false;
      let unvalidatedSteps = 0;
      let stalled = false;
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

      // Steps are the navigator steps that ran: a pause or a wait for the user costs none, and a resumed task keeps its count.
      for (step = context.nSteps; step < allowedMaxSteps; step = context.nSteps) {
        context.stepInfo = {
          stepNumber: context.nSteps,
          maxSteps: context.options.maxSteps,
        };
        setTraceContext({ taskId: context.taskId, step: context.nSteps });

        const stepDivider = '─'.repeat(60);
        console.log(
          `\n[Executor] ${stepDivider}\n` +
          `  STEP ${step + 1} / ${allowedMaxSteps}  |  taskId: ${context.taskId}\n` +
          `  time: ${new Date().toISOString()}\n` +
          `  consecutiveFailures: ${context.consecutiveFailures}\n` +
          `  memory: ${(context.messageManager.getWorkingMemory() || '(none)').slice(0, 200)}\n` +
          `[Executor] ${stepDivider}`,
        );
        logger.info(`🔄 Step ${step + 1} / ${allowedMaxSteps}`);
        if (await this.shouldStop()) {
          break;
        }

        const replanDecision = getReplanDecision({
          planned,
          navigatorDone,
          navigatorErrored,
          waitingForHuman: context.actionResults.some(result => result.isWaitingForHuman),
          unvalidatedSteps,
          stalled,
          stepsSinceLastPlan: context.nSteps - this.lastPlanningStep,
          planningInterval: context.options.planningInterval,
        });
        logger.info(`[Planner] Replan decision: ${replanDecision.shouldReplan} trigger=${replanDecision.trigger} reason=${replanDecision.reason}`);
        // Stuck (steps that did not validate, or a stall): this step's state carries a screenshot when vision is on.
        if (unvalidatedSteps >= 2 || stalled) context.screenshotWanted = true;
        // One page-state build per step, shared by the planner and the navigator. It is built lazily, after the
        // replan decision above has read the previous step's action results.
        let stepState: Promise<HumanMessage> | null = null;
        const getStepState = () => (stepState ??= this.buildStepState());
        await this.trace('executor', 'replan.decided', {
          contractId: context.currentContract?.id,
          payload: { ...replanDecision },
        });
        if (this.planner && replanDecision.shouldReplan) {
          navigatorDone = false;
          // Would the evidence alone have been enough to accept the navigator's done? Logged next to the planner's
          // verdict, so skipping the check can be enabled only once the two agree in live runs.
          const doneResult = replanDecision.trigger === 'contract_complete' ? context.actionResults.find(result => result.isDone) : undefined;
          const evidence = doneResult
            ? doneEvidence(context, doneResult.extractedContent ?? '', doneResult.success === true, this.lastPlanFinalPhase)
            : null;
          if (evidence?.skippable && context.options.acceptEvidencedDone) {
            // The page and the validated steps already back the answer: the planner's check would only repeat it.
            record({ level: 'info', kind: 'span', component: 'Executor', msg: 'verify.skipped', data: { reasons: [] } });
            const answer = doneResult?.extractedContent ?? context.finalAnswer ?? '';
            const accepted: AgentOutput<PlannerOutput> = {
              id: 'planner',
              result: { done: true, final_answer: answer, macro_objective: 'VERIFY_STATE', next_goal: 'Report the result', final_phase: true },
            };
            if (this.checkTaskCompletion(accepted)) {
              latestPlanOutput = accepted;
              break;
            }
          }
          latestPlanOutput = await this.runPlanner(getStepState);
          // Look before asking: with vision on, a question the planner means to put to the user is reconsidered once with a
          // screenshot in front of it (V1 and V2 asked the user what the page showed).
          if (latestPlanOutput?.result?.macro_objective === 'ASK_HUMAN' && context.options.useVision) {
            const seen = await getStepState();
            const shot = typeof seen.content === 'string' ? (await context.browserContext.getCachedState(true)).screenshot : null;
            if (typeof seen.content === 'string' && shot) {
              const withShot = new HumanMessage({
                content: [
                  { type: 'text', text: seen.content },
                  { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot}` } },
                ],
              });
              stepState = Promise.resolve(withShot);
              record({ level: 'info', kind: 'span', component: 'Executor', msg: 'look before asking', data: { question: latestPlanOutput.result.next_goal } });
              latestPlanOutput = (await this.runPlanner(getStepState, { seeImage: true })) ?? latestPlanOutput;
            }
          }
          if (evidence) {
            record({
              level: 'info',
              kind: 'span',
              component: 'Executor',
              msg: 'verify.skippable',
              data: { ...evidence, plannerDone: latestPlanOutput?.result?.done === true },
            });
          }
          if (latestPlanOutput) {
            planned = true;
            unvalidatedSteps = 0;
          }
          await this.saveCheckpoint(taskText, 'running');

          // Check if task is complete after planner run
          if (this.checkTaskCompletion(latestPlanOutput)) {
            break;
          }
        }

        const navigatorStep = await this.navigate(getStepState);
        navigatorDone = navigatorStep.done;
        navigatorErrored = navigatorStep.errored;
        // Unknown and failed both mean the page did not confirm the action; passed resets the streak.
        if (navigatorStep.outcome === 'passed') unvalidatedSteps = 0;
        else if (navigatorStep.outcome === 'failed' || navigatorStep.outcome === 'unknown') unvalidatedSteps++;
        stalled = !navigatorErrored && this.recordStepAndCheckStall();
        if (stalled) {
          context.consecutiveFailures++;
          logger.warning(`Progress stalled: the same actions repeated on an unchanged page (failures ${context.consecutiveFailures}/${context.options.maxFailures})`);
        }
        await this.saveCheckpoint(taskText, context.waitingForHuman ? 'waiting_human' : 'running');

        if (navigatorDone) {
          logger.info('🔄 Navigator indicates completion - will be validated by next planner run');
        }
      }

      // A done on the last allowed step still gets the planner's check instead of failing on the step limit.
      if (navigatorDone && !context.stopped && this.planner && latestPlanOutput?.result?.done !== true) {
        latestPlanOutput = await this.runPlanner(() => this.buildStepState());
        this.checkTaskCompletion(latestPlanOutput);
      }

      // Determine task completion status
      const isCompleted = latestPlanOutput?.result?.done === true;

      if (this.context.stopped && context.interruption) {
        await this.endInterrupted(taskText);
      } else if (this.context.stopped) {
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_task_cancel'));
        await this.saveCheckpoint(taskText, 'failed');

        // Track task cancellation
        void analytics.trackTaskCancelled(this.context.taskId);
      } else if (isCompleted) {
        context.taskArchive.addRecord({ taskId: context.taskId, goal: taskText, outcome: context.finalAnswer || 'Task completed successfully' });
        // Only the route is remembered across tasks: pages and kinds of elements, nothing the user wrote or the page said.
        if (context.taskStartUrl) await RouteMemory.save(context.taskStartUrl, context.routeSteps);

        // Emit final answer if available, otherwise use task ID
        const finalMessage = this.context.finalAnswer || this.context.taskId;
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, finalMessage);
        await this.saveCheckpoint(taskText, 'completed');

        // Track task completion
        void analytics.trackTaskComplete(this.context.taskId);
      } else if (step >= allowedMaxSteps) {
        logger.error('❌ Task failed: Max steps reached');
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_errors_maxStepsReached'));
        await this.saveCheckpoint(taskText, 'failed');

        // Track task failure with specific error category
        const maxStepsError = new MaxStepsReachedError(t('exec_errors_maxStepsReached'));
        const errorCategory = analytics.categorizeError(maxStepsError);
        void analytics.trackTaskFailed(this.context.taskId, errorCategory);
      } else {
        // The loop only stops early on the failure budget.
        const failureMessage = t('exec_errors_maxFailuresReached');
        logger.error(`❌ Task failed: ${failureMessage}`);
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_task_fail', [failureMessage]));
        await this.saveCheckpoint(taskText, 'failed');
        void analytics.trackTaskFailed(this.context.taskId, analytics.categorizeError(new MaxFailuresReachedError(failureMessage)));
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
            finalOutput = { status: 'failed', error: 'Max failures reached' };
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
      if (error instanceof ChatModelRateLimitError && !this.context.stopped) {
        // Still rate limited or unreachable after every retry: the task is kept, saved, so resuming it later continues where it was.
        this.context.interruption = t(error instanceof ProviderUnreachableError ? 'exec_task_offlinePaused' : 'exec_task_rateLimitedPaused');
      }
      if (this.context.interruption) {
        await this.endInterrupted(this.tasks[this.tasks.length - 1]);
      } else if (this.context.stopped || error instanceof RequestCancelledError || isAbortedError(error)) {
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_task_cancel'));
        await this.saveCheckpoint(this.tasks[this.tasks.length - 1], 'failed');

        // Track task cancellation
        void analytics.trackTaskCancelled(this.context.taskId);
      } else {
        await this.saveCheckpoint(this.tasks[this.tasks.length - 1], 'failed');
        const errorMessage = formatExecutionError(error);
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_task_fail', [errorMessage]));

        // Track task failure with detailed error categorization
        const errorCategory = analytics.categorizeError(error instanceof Error ? error : errorMessage);
        void analytics.trackTaskFailed(this.context.taskId, errorCategory);
      }
    } finally {
      this.running = false;
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
        // Typed passwords are registered secrets: the saved history keeps none of them.
        await chatHistoryStore.storeAgentStepHistory(this.context.taskId, redactSecrets(this.tasks[0]), redactSecrets(historyString));
      } catch (err) {
        logger.error('Failed to store task step history:', err);
      }
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
    // A finished task has nothing to resume.
    if (status === 'completed' || status === 'failed') {
      await this.context.checkpointStore.clear(this.context.taskId);
      return;
    }
    const checkpoint: TaskCheckpoint = {
      taskId: this.context.taskId,
      task,
      status,
      step: this.context.nSteps,
      currentContract: this.context.currentContract ?? null,
      lastObservationId: this.context.activeObservation?.id ?? null,
      validatedProgress: this.context.validatedProgress,
      blockedState: this.context.blockedState,
      updatedAt: Date.now(),
      tabId: this.context.browserContext.getCurrentTabId(),
      tasks: [...this.tasks],
      pendingQuestion: this.context.pendingQuestion,
      approvedCommitKey: this.context.approvedCommitKey,
      declinedCommitKeys: [...this.context.declinedCommitKeys],
      interruption: this.context.interruption,
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
    if (checkpoint.tasks?.length) this.tasks = [...checkpoint.tasks];
    this.context.pendingQuestion = checkpoint.pendingQuestion ?? null;
    this.context.approvedCommitKey = checkpoint.approvedCommitKey ?? null;
    this.context.declinedCommitKeys = new Set(checkpoint.declinedCommitKeys ?? []);
    if (checkpoint.status === 'waiting_human' && this.context.pendingQuestion && !this.pendingAnswer) {
      this.context.waitingForHuman = true;
      this.context.humanQuestion = this.context.pendingQuestion.question;
    }
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
   * Records this step's actions and resulting layout. The same actions on the same layout three times within the last
   * six steps are a stall, whether in a row or alternating with something else (A, B, A, B, A).
   */
  private recordStepAndCheckStall(): boolean {
    const record = this.context.history.history[this.context.history.history.length - 1];
    let actions = 'null';
    try {
      actions = JSON.stringify((JSON.parse(record?.modelOutput || '{}') as { action?: unknown }).action ?? null);
    } catch {
      // Unparseable output is not a repeat.
    }
    if (actions === 'null') return false;
    const key = `${actions}|${this.context.activeObservation?.layoutFingerprint ?? ''}`;
    this.stepKeys.push(key);
    return this.stepKeys.slice(-6).filter(recent => recent === key).length >= 3;
  }

  /**
   * Helper method to run planner and store its output
   */
  /** The current page state. The previous step's action results are rendered into it once, then cleared. */
  private async buildStepState(): Promise<HumanMessage> {
    const state = await this.navigatorPrompt.getUserMessage(this.context);
    this.context.actionResults = [];
    return state;
  }

  private async runPlanner(getState: () => Promise<HumanMessage>, options: { seeImage?: boolean } = {}): Promise<AgentOutput<PlannerOutput> | null> {
    const context = this.context;
    try {
      // Execute planner
      console.log(`\n[Planner] ── invoking LLM ── ${new Date().toISOString()}`);
      // The planner gets the page on every run, including the first; without it it plans blind.
      const planOutput = await this.planner.execute(await getState(), options);
      this.lastPlanningStep = this.context.nSteps;
      // If planner returned an error (e.g., LLM API crash), treat it as an execution failure
      // so it counts toward consecutiveFailures and eventually stops the loop.
      if (planOutput.error) {
        console.warn(`[Planner] ERROR: ${planOutput.error}`);
        throw new Error(planOutput.error);
      }
      if (planOutput.result) {
        const p = planOutput.result;
        context.lastGoal = p.next_goal || p.macro_objective || '';
        this.lastPlanFinalPhase = p.final_phase === true;
        const planDivider = '─'.repeat(60);
        console.log(
          `\n[Planner] ${planDivider}\n` +
          `  done        : ${p.done}\n` +
          `  next_goal   : ${p.next_goal}\n` +
          `  macro_objective  : ${p.macro_objective}\n` +
          `  final_answer: ${p.final_answer}\n` +
          `[Planner] ${planDivider}`,
        );
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

  /** Runs one navigator step and charges the failure budget: failed results and errors cost, passed and done reset. */
  private async navigate(getState: () => Promise<HumanMessage>): Promise<NavigatorStep> {
    const context = this.context;
    const idle: NavigatorStep = { done: false, errored: false, outcome: null };
    try {
      if (context.paused || context.stopped) {
        return idle;
      }
      console.log(`\n[Navigator] ── invoking LLM ── step=${context.nSteps + 1}  ${new Date().toISOString()}`);
      const navOutput = await this.navigator.execute(await getState());
      if (context.paused || context.stopped) {
        return idle;
      }
      context.nSteps++;
      if (navOutput.error) {
        throw new Error(navOutput.error);
      }

      const results = context.actionResults;
      const lastWaitingResult = [...results].reverse().find(r => r.isWaitingForHuman);
      if (lastWaitingResult) {
        context.waitingForHuman = true;
        let questionText = lastWaitingResult.extractedContent || 'The agent needs your input.';
        try {
          const details = JSON.parse(lastWaitingResult.extractedContent || '{}');
          if (details.question) questionText = details.question;
        } catch {
          // Plain-text question.
        }
        context.humanQuestion = questionText;
        logger.info(`Agent is waiting for human: ${context.humanQuestion}`);
        return idle;
      }

      const done = navOutput.result?.done === true;
      const latest = [...results].reverse().find(result => result.validated !== 'not_applicable');
      const outcome = latest?.validated ?? null;
      if (done || outcome === 'passed') {
        context.consecutiveFailures = 0;
      } else if (outcome === 'failed') {
        const failureDetail = latest?.failureReason ?? latest?.error ?? 'failed';
        context.consecutiveFailures++;
        logger.warning(`Navigator action failed (${context.consecutiveFailures}/${context.options.maxFailures}): ${failureDetail}`);
        if (context.consecutiveFailures >= context.options.maxFailures) {
          throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'), failureDetail);
        }
      } else if (outcome === 'unknown') {
        logger.info(`Navigator action did not validate: ${latest?.failureReason ?? 'no observable change'}`);
      }
      return { done, errored: false, outcome };
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
        error instanceof ExtensionConflictError ||
        error instanceof MaxFailuresReachedError
      ) {
        throw error;
      }
      context.consecutiveFailures++;
      if (context.consecutiveFailures >= context.options.maxFailures) {
        throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'), error);
      }
      return { done: false, errored: true, outcome: null };
    }
  }

  private async shouldStop(): Promise<boolean> {
    if (this.context.stopped) {
      logger.info('Agent stopped');
      return true;
    }

    // An unanswered question does not hold the browser forever: after the deadline the task is saved and a later
    // answer resumes it.
    const waitStarted = Date.now();
    const answerDeadlineMs = (this.generalSettings?.humanWaitMinutes ?? 10) * 60_000;
    while (this.context.paused || this.context.waitingForHuman) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (this.context.stopped) {
        return true;
      }
      if (this.context.waitingForHuman && !this.context.paused && Date.now() - waitStarted > answerDeadlineMs) {
        await this.interrupt(t('exec_task_waitingForAnswer'));
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
    await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_RESUME, t('exec_task_resumed'));
  }

  async pause(): Promise<void> {
    this.context.pause();
    await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, t('exec_task_pause'));
  }

  /** Stops the task without finishing it, for a reason outside the agent (panel or tab closed, no answer); it stays resumable. */
  async interrupt(reason: string): Promise<void> {
    this.context.interruption = reason;
    this.context.stop();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** An answer given after the task stopped waiting; applied once the saved task is restored. */
  /** A message from the user can grant what an intent check refused (the agent asks, the user says yes); ask again. */
  private forgetRefusedIntents(): void {
    for (const [key, asked] of this.context.intentDecisions) if (!asked) this.context.intentDecisions.delete(key);
  }

  /** Shows a download of this task in both agents' state: the file name, never its local path. */
  noteDownload(item: Pick<chrome.downloads.DownloadItem, 'id' | 'filename' | 'url' | 'finalUrl' | 'totalBytes' | 'state' | 'danger' | 'error'>): void {
    const source = item.finalUrl || item.url;
    const name = (item.filename || source.split(/[?#]/)[0]).split(/[\\/]/).pop() || 'file';
    const size = item.totalBytes > 0 ? `, ${Math.max(1, Math.round(item.totalBytes / 1024))} KB` : '';
    const status =
      item.danger && !['safe', 'accepted'].includes(item.danger)
        ? 'held by Chrome as possibly dangerous; only the user can keep it'
        : item.state === 'complete'
          ? 'saved'
          : item.state === 'interrupted'
            ? `failed (${item.error ?? 'interrupted'})`
            : 'downloading';
    this.context.downloads.set(item.id, `${name} from ${hostOf(source) || source.slice(0, 60)}${size}: ${status}`);
  }

  setPendingAnswer(response: string, secrets: string[] = []): void {
    this.pendingAnswer = { response, secrets };
  }

  /** Shows the question the task is waiting on again (a reconnected or reopened side panel). */
  reemitQuestion(): void {
    const question = this.context.pendingQuestion;
    if (this.context.waitingForHuman && question) {
      void this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_ASK_HUMAN, question.details ?? question.question);
    }
  }

  private async endInterrupted(task: string): Promise<void> {
    await this.saveCheckpoint(task, this.context.waitingForHuman ? 'waiting_human' : 'paused');
    await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, this.context.interruption ?? t('exec_task_pause'));
  }

  /** `secrets` are values the user typed into password fields; they never appear in traces. */
  async submitHumanResponse(response: string, secrets: string[] = []): Promise<void> {
    for (const secret of secrets) registerSecret(secret);
    logger.info(`Submitting human response: ${response}`);
    const commitKey = this.context.pendingQuestion?.commitKey;
    if (commitKey && isApproval(response)) this.context.approvedCommitKey = commitKey;
    else if (commitKey) this.context.declinedCommitKeys.add(commitKey);
    this.context.pendingQuestion = null;
    this.forgetRefusedIntents();
    const host = hostOf(this.context.promptState?.url);
    for (const [placeholder, value] of this.context.messageManager.addHumanAnswer(response, secrets)) {
      this.context.secrets.set(placeholder, { value, host });
    }
    this.context.blockedState = null;
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
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_replay_cancel'));
      } else {
        await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, t('exec_replay_ok'));
      }
    } catch (error) {
      const errorMessage = formatExecutionError(error);
      replayLogger.error(`Replay failed: ${errorMessage}`);
      await this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_replay_fail', [errorMessage]));
    }

    return results;
  }
}

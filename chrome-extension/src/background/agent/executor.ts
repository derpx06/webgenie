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
import { absenceUnread, doneEvidence, reportedValues, searchOnlyEvidence, staleRequirements } from './validation/done-evidence';
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
  GoalRepeats,
  TaskCheckpointStore,
  TraceStore,
  getReplanDecision,
  isCheckpointResumable,
  shouldForceReplanAfterResume,
  type PlannerRequirement,
  type TaskCheckpoint,
} from './contracts';
import { ensureBrowserObservation, viewportText } from './validation/observation';
import { echoesActionResult, hostOf, inventedPersonalData, isApproval, isPageSideError, isStaleElementError } from './validation/service';
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
  /** The navigator's last done, which the planner is checking, reported failure. */
  private doneReportedFailure = false;
  /** `actions|layoutFingerprint` per navigator step, for stall detection. */
  private stepKeys: string[] = [];
  /** Goals planned since the task last made progress; a goal planned again and again is a failed route. */
  private readonly goalRepeats = new GoalRepeats();
  /** A goal was planned five times without progress: the planner was told to finish, and its done is accepted as it is. */
  private mustFinish = false;
  /** Navigator steps since the last plan that did not validate as passed. */
  private unpassedSinceLastPlan = 0;
  /** The last plan moved a requirement from applied back to pending. */
  private requirementReopened = false;
  /** A done whose applied requirements the current page no longer shows was sent back once. */
  private evidenceRechecked = false;
  /** Whether a done was already sent back for requirements "applied" only through the search text. */
  private searchEvidenceRefused = false;
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
    const actionBuilder = new ActionBuilder(context);
    const navigatorActionRegistry = new NavigatorActionRegistry(actionBuilder.buildDefaultActions());
    // Both prompts offer only the registered tools; with view_screenshot they say the navigator can look at the page.
    const tools = new Set(navigatorActionRegistry.getAllActions().map(action => action.name()));
    this.navigatorPrompt = new NavigatorPrompt(context.options.maxActionsPerStep, tools);
    this.plannerPrompt = new PlannerPrompt(tools);

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
    // Requirements and the completion checks built on them belong to one task.
    this.context.requirements = [];
    this.context.requirementRefusals = 0;
    this.context.absenceChecked = false;
    this.evidenceRechecked = false;
    this.searchEvidenceRefused = false;
    this.goalRepeats.progress();
    this.mustFinish = false;

    // need to reset previous action results that are not included in memory
    this.context.actionResults = this.context.actionResults.filter(result => result.includeInMemory);
  }

  /**
   * Whether the planner's done ends the task. A done is sent back to the planner ('refused') when its answer quotes an
   * action result, a requirement is still pending, or it reports absence without the page having been read. Each
   * refusal is capped, so a planner that keeps finishing the same way finishes.
   */
  private checkTaskCompletion(planOutput: AgentOutput<PlannerOutput> | null): 'complete' | 'refused' | 'continue' {
    if (!planOutput?.result?.done) return 'continue';
    const context = this.context;
    const answer = planOutput.result.final_answer || context.finalAnswer || '';
    const requirements = planOutput.result.requirements ?? context.requirements;
    const pending = requirements.filter(item => item.status === 'pending').map(item => item.requirement);
    // Told to finish after a goal kept failing: the done ends the task, with what was not applied named below.
    if (this.mustFinish) return this.acceptCompletion(answer, pending);
    // An answer quoting "Clicked button with index 2" reports what the agent did, not what the page shows. Two refusals
    // at most: a model that keeps quoting it should not burn the task's time limit.
    if (echoesActionResult(answer) && context.echoRejections < 2) {
      context.echoRejections++;
      return this.refuseCompletion(planOutput, 'The answer quotes an action result ("Clicked …", "Dragged element …", "Input … into index …"), which is not page text. Answer again without quoting action results: describe only what the current page shows, or, if the task asks for no text, just say what was done. If a message the task asks for is still loading, wait and read it.');
    }
    // Typing the criteria into a search box finished tasks whose sort or filters were never applied.
    if (pending.length > 0 && context.requirementRefusals < 2) {
      context.requirementRefusals++;
      return this.refuseCompletion(planOutput, `Not done: these requirements are still pending: ${pending.join('; ')}. Apply each with the site's sort or filter controls and check that the page shows it applied, or mark it not_available with the reason.`);
    }
    // A filter recorded as applied that a later action removed (going back, a new search): the page must still show it.
    const stale = this.evidenceRechecked ? [] : staleRequirements(context, requirements);
    if (stale.length > 0) {
      this.evidenceRechecked = true;
      return this.refuseCompletion(planOutput, `Not done: the current page no longer shows the evidence recorded for these applied requirements: ${stale.map(item => `${item.requirement} (${item.evidence})`).join('; ')}. Every applied filter or sort must still be in effect on the CURRENT page (the selected option, the checked control, the sort label or the URL parameter); a later go_back, reload or new search can remove it. Check the current page state: apply again what is missing, or mark it pending or not_available.`);
    }
    // Criteria typed into a search box and "confirmed" by the results' own text were never applied by the site.
    const searchOnly = this.searchEvidenceRefused ? [] : searchOnlyEvidence(requirements);
    if (searchOnly.length > 0) {
      this.searchEvidenceRefused = true;
      return this.refuseCompletion(planOutput, `Not done: the evidence for these applied requirements is the search or its results, not a filter or sort the site applied: ${searchOnly.map(item => `${item.requirement} (${item.evidence})`).join('; ')}. Search text does not filter results. Apply each with the site's filter or sort controls (open a collapsed filter section if needed) and record the selected option, chip, sort label or URL parameter as evidence; mark it not_available only when the site offers no such control.`);
    }
    // "Not found" said about a results page nobody read.
    if (!context.absenceChecked && absenceUnread(context, answer, this.doneReportedFailure)) {
      context.absenceChecked = true;
      return this.refuseCompletion(planOutput, 'The answer says something is missing, but the current page was not read. Before concluding, read it: get_complete_page_content with find set to the key term of the task, then decide from what it returns.');
    }
    return this.acceptCompletion(answer, pending);
  }

  private acceptCompletion(answer: string, pending: string[]): 'complete' {
    const context = this.context;
    logger.info('✅ Planner confirms task completion');
    // The navigator's done text is the provisional answer; a planner final_answer replaces it. Requirements still
    // pending after the refusals are named, so the answer never implies they were applied.
    const notApplied = pending.length > 0 ? `\n\n${t('exec_requirements_notApplied', [pending.join('; ')])}` : '';
    context.finalAnswer = answer ? `${answer}${notApplied}` : null;
    return 'complete';
  }

  /**
   * A plan that is not done, checked for a failed route: the same goal planned for the third time without progress is
   * sent back with the goals already tried; from the fifth the planner is told to finish, and a plan that still does
   * not finish ends the task.
   */
  private checkRepeatedGoal(planOutput: AgentOutput<PlannerOutput>): 'refused' | 'continue' {
    const plan = planOutput.result;
    if (!plan || plan.done) return 'continue';
    const goal = plan.next_goal || plan.macro_objective;
    const plans = this.goalRepeats.plan(goal);
    if (plans > 1) record({ level: 'info', kind: 'span', component: 'Executor', msg: 'goal repeated', data: { plans } });
    if (this.mustFinish) {
      throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'), `the plan kept repeating goals that made no progress: ${goal}`);
    }
    const tried = this.goalRepeats.repeated().map(item => `"${item}"`).join('; ');
    if (plans >= 5) {
      this.mustFinish = true;
      return this.refuseCompletion(planOutput, `The goal "${goal}" has been planned ${plans} times without progress (goals tried without progress: ${tried}). Stop trying: set done=true now with the best answer the steps, findings and page give, including every requested value found, and say plainly what could not be found or done.`);
    }
    if (plans === 3) {
      return this.refuseCompletion(planOutput, `The goal "${goal}" has been planned ${plans} times without progress: no new page state, finding or applied requirement came of it. Goals already tried without progress: ${tried}. Do not plan them again. Choose a different route (another page, the site's own search or navigation, a different control), or, if what is known already answers the task, set done=true with it.`);
    }
    return 'continue';
  }

  /** Sends a plan back to the planner with `note` as the result it sees next. */
  private refuseCompletion(planOutput: AgentOutput<PlannerOutput>, note: string): 'refused' {
    logger.warning(`Plan sent back: ${note}`);
    // A rejected answer must not end the task as done if the loop stops before the planner decides again.
    planOutput.result!.done = false;
    this.context.finalAnswer = null;
    this.context.actionResults = [new ActionResult({
      executed: false,
      validated: 'unknown',
      retryability: 'replan',
      failureReason: note,
      extractedContent: note,
      includeInMemory: true,
    })];
    return 'refused';
  }

  /**
   * An answer read from page text that is off screen is scrolled into view (no model call), so the page the task ends
   * on shows it. Skipped when a value of the answer is already on screen or none is found.
   */
  private async showAnswerOnPage(): Promise<void> {
    const { finalAnswer, pageRead, promptState } = this.context;
    if (!finalAnswer || !pageRead || !promptState || promptState.url !== pageRead.url) return;
    const read = pageRead.text.toLowerCase();
    const values = reportedValues(finalAnswer).filter(value => value.length >= 3 && read.includes(value));
    const onScreen = viewportText(promptState).toLowerCase();
    if (values.length === 0 || values.some(value => onScreen.includes(value))) return;
    try {
      const page = await this.context.browserContext.getCurrentPage();
      if (page.url() !== pageRead.url) return;
      // Longest first: a longer value is less likely to match somewhere else on the page.
      for (const value of values.sort((a, b) => b.length - a.length).slice(0, 3)) {
        if (await page.scrollToText(value)) {
          record({ level: 'info', kind: 'span', component: 'Executor', msg: 'answer scrolled into view', data: { chars: value.length } });
          return;
        }
      }
    } catch (error) {
      logger.warning(`Could not scroll the answer into view: ${error}`);
    }
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
    // A cancel that reached a task already finishing (final run L3: the follow-up was sent the moment the answer arrived)
    // must not cancel the follow-up: every run starts un-stopped, with a fresh abort signal.
    if (context.stopped) {
      context.stopped = false;
      context.controller = new AbortController();
    }
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
      let completionRefused = false;
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
          completionRefused,
          unvalidatedSteps,
          stalled,
          stepsSinceLastPlan: context.nSteps - this.lastPlanningStep,
          planningInterval: context.options.planningInterval,
          stepsPassedSinceLastPlan: this.unpassedSinceLastPlan === 0,
          requirementReopened: this.requirementReopened,
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
          // A refused completion keeps the failure it was checking.
          if (replanDecision.trigger !== 'completion_refused') this.doneReportedFailure = doneResult?.success === false;
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
            if (this.checkTaskCompletion(accepted) === 'complete') {
              latestPlanOutput = accepted;
              break;
            }
          }
          const requirementsBefore = context.requirements;
          const findingsBefore = context.findings.length;
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
              record({ level: 'info', kind: 'span', component: 'Executor', msg: 'look before asking', data: { question: latestPlanOutput.result.next_goal, imageChars: shot.length } });
              // The planner writes its plan into the context as it returns; a discarded look must leave the question's plan there.
              const beforeLook = { contract: context.currentContract, macro: context.lastMacroObjective, goal: context.lastGoal, finalPhase: this.lastPlanFinalPhase };
              const looked = await this.runPlanner(getStepState, { seeImage: true });
              // Looking may settle what the page shows, never supply what only the user has: a plan that answers the
              // question with personal details nobody gave keeps the question (H6: an invented phone number).
              const known = [
                ...context.messageManager.getTranscript().filter(entry => entry.message.getType() !== 'ai').map(entry => String(entry.message.content)),
                ...context.findings,
                seen.content,
              ].join('\n');
              const planText = looked?.result ? JSON.stringify([looked.result.next_goal, looked.result.final_answer, looked.result.matching_items]) : '';
              const madeUp = looked?.result?.macro_objective !== 'ASK_HUMAN' ? inventedPersonalData(planText, known) : [];
              if (madeUp.length > 0) record({ level: 'warning', kind: 'span', component: 'Executor', msg: 'look kept the question', data: { madeUp: madeUp.length } });
              if (looked && madeUp.length === 0) {
                latestPlanOutput = looked;
              } else {
                // The look failed (H2: the call with the image hung twice) or invented details: keep the question, its plan
                // and the text-only state, so the navigator's call carries neither the image nor the discarded plan.
                context.currentContract = beforeLook.contract;
                context.lastMacroObjective = beforeLook.macro;
                context.lastGoal = beforeLook.goal;
                this.lastPlanFinalPhase = beforeLook.finalPhase;
                stepState = Promise.resolve(seen);
              }
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
            this.unpassedSinceLastPlan = 0;
            this.noteRequirementChanges(requirementsBefore, findingsBefore);
          }
          await this.saveCheckpoint(taskText, 'running');
          // The navigator never acts without a plan: a first planner call that failed (a timeout) is made again, and
          // the failure budget ends a planner that keeps failing.
          if (!planned) continue;

          // Check if task is complete after planner run
          let completion = this.checkTaskCompletion(latestPlanOutput);
          if (completion === 'complete') break;
          if (completion === 'continue' && latestPlanOutput) completion = this.checkRepeatedGoal(latestPlanOutput);
          // A refused plan goes straight back to the planner with the reason; the navigator has nothing to do.
          completionRefused = completion === 'refused';
          if (completionRefused) continue;
        }

        const findingsBefore = context.findings.length;
        const navigatorStep = await this.navigate(getStepState);
        navigatorDone = navigatorStep.done;
        navigatorErrored = navigatorStep.errored;
        // Unknown and failed both mean the page did not confirm the action; passed resets the streak.
        if (navigatorStep.outcome === 'passed') unvalidatedSteps = 0;
        else if (navigatorStep.outcome === 'failed' || navigatorStep.outcome === 'unknown') unvalidatedSteps++;
        if (navigatorStep.outcome !== 'passed') this.unpassedSinceLastPlan++;
        const stepRecord = navigatorErrored ? { stalled: false, fresh: false } : this.recordStep();
        stalled = stepRecord.stalled;
        // Progress: a validated action this task had not done on that layout before, or a new finding. Repeating a
        // search or reopening a page validates too, but is not new.
        if ((navigatorStep.outcome === 'passed' && stepRecord.fresh) || context.findings.length > findingsBefore) this.goalRepeats.progress();
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
        await this.showAnswerOnPage();
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
  private recordStep(): { stalled: boolean; fresh: boolean } {
    const record = this.context.history.history[this.context.history.history.length - 1];
    let actions = 'null';
    try {
      actions = JSON.stringify((JSON.parse(record?.modelOutput || '{}') as { action?: unknown }).action ?? null);
    } catch {
      // Unparseable output is not a repeat.
    }
    if (actions === 'null') return { stalled: false, fresh: false };
    const key = `${actions}|${this.context.activeObservation?.layoutFingerprint ?? ''}`;
    const fresh = !this.stepKeys.includes(key);
    this.stepKeys.push(key);
    return { stalled: this.stepKeys.slice(-6).filter(recent => recent === key).length >= 3, fresh };
  }

  /**
   * After a plan: a requirement it newly marks applied, or a finding, is progress; one it moves from applied back to
   * pending keeps the interval re-plan on.
   */
  private noteRequirementChanges(before: PlannerRequirement[], findingsBefore: number): void {
    const statusBefore = new Map(before.map(item => [item.requirement.toLowerCase(), item.status]));
    const after = this.context.requirements;
    this.requirementReopened = after.some(item => item.status === 'pending' && statusBefore.get(item.requirement.toLowerCase()) === 'applied');
    const newlyApplied = after.some(item => item.status === 'applied' && statusBefore.get(item.requirement.toLowerCase()) !== 'applied');
    if (newlyApplied || this.context.findings.length > findingsBefore) this.goalRepeats.progress();
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
      } else if (outcome === 'failed' && latest?.executionStatus === 'threw' && isStaleElementError(latest.error ?? '')) {
        // The page replaced the element after it was read: not the agent's failure, so it costs nothing from the failure budget.
        logger.info(`Target changed under the action; re-reading the page: ${latest.error}`);
      } else if (outcome === 'failed') {
        const failureDetail = latest?.failureReason ?? latest?.error ?? 'failed';
        // A covered or hidden target, or the site's connection failing, costs half: the model gets room to try another
        // way, and six in a row still end the task.
        context.consecutiveFailures += latest?.executionStatus === 'threw' && isPageSideError(latest.error ?? '') ? 0.5 : 1;
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
    // The user's answer is new information: goals that failed before may work with it.
    this.goalRepeats.progress();
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

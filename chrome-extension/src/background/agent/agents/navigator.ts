import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { record } from '@src/background/trace';
import { ActionResult, type AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import { BrowserStateHistory, URLNotAllowedError, type BrowserState } from '@src/background/browser/views';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import { AgentStepRecord } from '../history';
import type { HumanMessage } from '@langchain/core/messages';
import { ContextBuilder } from '../memory';

import { NavigatorActionRegistry } from './navigator/registry';
export { NavigatorActionRegistry };
import { HistoryReplayer } from './navigator/replay';
import { handleAgentError, isFatalAgentError } from './utils/error-handler';
import { ensureBrowserObservation } from '../validation/observation';
import {
  commitActionLabel,
  currentIndexFor,
  isMutatingAction,
  normalizeIndexedAction,
  shouldStopAfterValidation,
  staleIndexResult,
  validateActionOutcome,
} from '../validation/service';
import { ProgressLedger } from '../contracts';
import type { TargetFingerprint } from '../validation/types';
import { waitForActionSettled } from '../validation/settling';

const logger = createLogger('NavigatorAgent');

/** Actions that still work while a JavaScript dialog blocks the page. */
const DIALOG_SAFE_ACTIONS = new Set(['handle_dialog', 'ask_human', 'done']);

/** Action arguments safe for logs and traces: typed text becomes its length, engine stamps are dropped. */
export function redactArgs(actionName: string, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  const rest = { ...(args as Record<string, unknown>) };
  delete rest.observationId;
  delete rest.targetFingerprint;
  for (const field of ['text', 'prompt_text']) {
    if ((actionName === 'input_text' || actionName === 'handle_dialog') && typeof rest[field] === 'string') {
      rest[field] = `<${(rest[field] as string).length} characters>`;
    }
  }
  return rest;
}

export interface NavigatorResult {
  done: boolean;
}

function targetFingerprintFromArgs(actionArgs: unknown): TargetFingerprint | null {
  if (actionArgs === null || typeof actionArgs !== 'object') return null;
  if (!('targetFingerprint' in actionArgs)) return null;
  const value = (actionArgs as { targetFingerprint?: unknown }).targetFingerprint;
  return value && typeof value === 'object' ? value as TargetFingerprint : null;
}

export class NavigatorAgent extends BaseAgent<NavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;
  private historyReplayer: HistoryReplayer;

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(options, { ...extraOptions, id: 'navigator' });
    this.actionRegistry = actionRegistry;
    this.historyReplayer = new HistoryReplayer(this.context, actionRegistry, this.doMultiAction.bind(this));
  }

  async execute(state: HumanMessage): Promise<AgentOutput<NavigatorResult>> {
    const agentOutput: AgentOutput<NavigatorResult> = { id: this.id };
    const cancelled = false;
    let browserStateHistory: BrowserStateHistory | null = null;
    let actionResults: ActionResult[] = [];
    let modelOutputString: string | null = null;

    try {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_START, 'Navigating...');

      const currentState = await this.context.browserContext.getCachedState();
      browserStateHistory = new BrowserStateHistory(currentState);
      if (currentState.screenshot) {
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.SIGHT_UPDATE, 'Sight updated', currentState.screenshot);
      }

      if (this.isTaskInterrupted()) return agentOutput;

      const contextPacket = ContextBuilder.buildContextPacket(this.context, this.prompt.getSystemMessage(), state, 'navigator');

      const { calls } = await this.invokeWithTools(
        contextPacket,
        this.actionRegistry.getTools(),
        this.actionRegistry.getValidators(),
      );

      if (this.isTaskInterrupted()) return agentOutput;

      const memory = calls
        .map(call => call.args.memory)
        .find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? '';
      const actions = calls.slice(0, this.context.options.maxActionsPerStep).map(({ name, args }) => {
        const actionArgs = { ...args };
        delete actionArgs.memory;
        return { [name]: actionArgs };
      });
      // Stored in the AgentOutput shape that saved histories and HistoryReplayer read.
      const modelOutput = { current_state: { memory, next_goal: this.context.lastGoal ?? '' }, action: actions };
      modelOutputString = JSON.stringify(modelOutput);
      logger.info(`[Memory] ${memory || '(none)'}`);
      if (memory) {
        void this.context.messageManager.setWorkingMemory(memory);
      }

      actionResults = await this.doMultiAction(actions);
      this.context.actionResults = actionResults;
      // Calls beyond maxActionsPerStep or after a stopping result are recorded as not executed.
      this.context.messageManager.addToolTurn(calls, actionResults);

      if (this.isTaskInterrupted()) return agentOutput;

      const lastResult = actionResults[actionResults.length - 1];
      if (lastResult?.isDone && lastResult.extractedContent) {
        // Provisional answer; the planner confirms completion and may replace it.
        this.context.finalAnswer = lastResult.extractedContent;
      }
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Navigation done');
      agentOutput.result = { done: !!lastResult?.isDone };

      return agentOutput;
    } catch (error) {
      return this.handleExecutionError(error, agentOutput);
    } finally {
      this.finalizeExecution(cancelled, browserStateHistory, actionResults, modelOutputString);
    }
  }

  private isTaskInterrupted(): boolean {
    return this.context.paused || this.context.stopped;
  }

  private handleExecutionError(error: unknown, output: AgentOutput<NavigatorResult>): AgentOutput<NavigatorResult> {
    try {
      handleAgentError(error, 'Navigation failed');
    } catch (e) {
      // Auth, bad request, billing, rate limit, cancel and blocked-URL errors end the task.
      if (isFatalAgentError(e)) throw e;
      const msg = e instanceof Error ? e.message : String(e ?? 'Unknown navigation error');
      logger.error(msg);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_FAIL, msg);
      output.error = msg;
    }
    return output;
  }

  private finalizeExecution(cancelled: boolean, history: BrowserStateHistory | null, results: ActionResult[], outputStr: string | null) {
    if (this.isTaskInterrupted()) {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_CANCEL, 'Navigation cancelled');
    }

    if (history) {
      const resultsCopy = results.map(r => new ActionResult({ ...r }));
      this.context.history.history.push(new AgentStepRecord(outputStr, resultsCopy, history));
    }
  }

  public async executePreplannedActions(actions: Record<string, unknown>[]): Promise<ActionResult[]> {
    return this.doMultiAction(actions);
  }

  private async getSettledPostActionState(
    actionName: string,
    actionArgs: unknown,
    beforeState: BrowserState,
    result: ActionResult,
  ): Promise<BrowserState> {
    const config = this.context.browserContext.getConfig();
    const timeoutMs = Math.max(250, config.actionSettleTimeoutMs ?? 2000);
    const pollIntervalMs = Math.max(50, config.actionPollIntervalMs ?? 150);
    const startedAt = Date.now();
    const settleResult = await waitForActionSettled(
      () => this.context.browserContext.getState(false),
      // Polls until the action validates; an action with nothing to validate settles at once. The handler's own
      // evidence (typed text read back, a selection confirmed) counts, so those settle on the first read.
      state => {
        const { validated } = validateActionOutcome({ actionName, actionArgs, before: beforeState, after: state, result });
        return validated === 'passed' || validated === 'not_applicable';
      },
      {
        timeoutMs,
        pollIntervalMs,
        signal: this.context.controller.signal,
      },
    );

    logger.info(
      `[ActionSettle] ${actionName} settled=${settleResult.settled} polls=${settleResult.polls} ` +
      `elapsed=${settleResult.elapsedMs}ms total=${Date.now() - startedAt}ms`,
    );
    return settleResult.state;
  }

  private async doMultiAction(actions: Record<string, unknown>[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const browserContext = this.context.browserContext;
    await browserContext.removeHighlight();

    for (const [i, action] of actions.entries()) {
      if (this.isTaskInterrupted()) break;
      if (i > 0) await this.delayBetweenActions();

      const contractId = this.context.currentContract?.id ?? null;
      const actionId = `action_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 8)}`;
      const validationId = `validation_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 8)}`;
      const actionEntries = action && typeof action === 'object'
        ? Object.entries(action).filter(([, value]) => value !== null && value !== undefined)
        : [];

      if (actionEntries.length !== 1) {
        const msg = actionEntries.length === 0
          ? 'The navigator returned an empty action object; replan with exactly one action per item.'
          : 'The navigator returned multiple actions in one object; replan with exactly one action per item.';
        logger.warning(msg);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        results.push(new ActionResult({
          executed: false,
          executionStatus: 'not_attempted',
          validated: 'failed',
          retryability: 'replan',
          failureReason: msg,
          extractedContent: msg,
          includeInMemory: true,
          contractId,
          actionId,
          validationId,
          evidence: [{ kind: 'error', passed: false, message: msg }],
        }));
        break;
      }

      const [actionName, actionArgs] = actionEntries[0];

      // Strict verification safeguard: Prevent 'done' from being chained after modifying actions
      if (actionName === 'done' && i > 0) {
        const msg = "The 'done' action was ignored. You MUST NEVER call 'done' in the same turn as other actions. Please verify the page state visually in the next turn before calling 'done'.";
        logger.warning(msg);
        results.push(new ActionResult({ extractedContent: msg, includeInMemory: true }));
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        break;
      }

      try {
        const actionInstance = this.actionRegistry.getAction(actionName);
        if (!actionInstance) throw new Error(`Action ${actionName} not exists`);

        const indexArg = actionInstance.getIndexArg(actionArgs);
        const beforeState = await browserContext.getCachedState(this.context.options.useVision);
        const beforeObservation = ensureBrowserObservation(beforeState);
        this.context.activeObservation = beforeObservation;
        if (this.context.traceStore) {
          void this.context.traceStore.append({
            taskId: this.context.taskId,
            actor: 'navigator',
            type: 'action.started',
            contractId: contractId ?? undefined,
            observationId: beforeObservation.id,
            actionId,
            payload: { actionName, actionArgs: redactArgs(actionName, actionArgs) },
            timestamp: Date.now(),
          });
        }

        if (beforeState.dialog && !DIALOG_SAFE_ACTIONS.has(actionName)) {
          const msg = `A JavaScript ${beforeState.dialog.type} dialog is open ("${beforeState.dialog.message.slice(0, 200)}"); call handle_dialog before ${actionName}.`;
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
          results.push(new ActionResult({
            executed: false,
            executionStatus: 'not_attempted',
            validated: 'unknown',
            retryability: 'retry_reobserve',
            failureReason: msg,
            extractedContent: msg,
            includeInMemory: true,
            contractId,
            actionId,
            validationId,
          }));
          break;
        }

        if (indexArg !== null) {
          // Indexes refer to the page in the prompt; a read taken after an earlier action may number elements differently.
          const args = actionArgs as { index: number; target_index?: number };
          const currentIndex = currentIndexFor(this.context.promptState, beforeState, indexArg);
          const targetIndex = typeof args.target_index === 'number'
            ? currentIndexFor(this.context.promptState, beforeState, args.target_index)
            : undefined;
          const staleIndex = currentIndex === null ? indexArg : targetIndex === null ? args.target_index : undefined;
          if (currentIndex !== null) args.index = currentIndex;
          if (typeof targetIndex === 'number') args.target_index = targetIndex;
          const normalized = staleIndex !== undefined
            ? { ok: false, actionResult: staleIndexResult(staleIndex, beforeObservation.id) }
            : normalizeIndexedAction(actionName, actionArgs, beforeObservation);
          if (!normalized.ok && normalized.actionResult) {
            this.context.emitEvent(
              Actors.NAVIGATOR,
              ExecutionState.ACT_FAIL,
              normalized.actionResult.failureReason ?? 'Stale browser observation',
            );
            results.push(new ActionResult({
              ...normalized.actionResult,
              contractId,
              actionId,
              validationId,
            }));
            break;
          }

        }

        // Orders, payments and account changes are the user's decision: never without their confirmation.
        const commitLabel = actionName === 'click_element'
          ? commitActionLabel(beforeState.selectorMap.get((actionArgs as { index?: number }).index ?? -1))
          : null;
        if (commitLabel && this.context.commitDecision !== 'approved') {
          const msg = this.context.commitDecision === 'declined'
            ? `The user declined this: "${commitLabel}" was not done and must not be done. Report that to the user.`
            : `"${commitLabel}" commits an order, a payment or an account change. First ask the user to confirm with ask_human (type "confirmation"), naming what it is for and the total; do it only after they agree.`;
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
          results.push(new ActionResult({
            executed: false,
            executionStatus: 'not_attempted',
            validated: 'unknown',
            retryability: 'replan',
            failureReason: msg,
            extractedContent: msg,
            includeInMemory: true,
            contractId,
            actionId,
            validationId,
          }));
          break;
        }

        const actionStartedAt = Date.now();
        let result = await actionInstance.call(actionArgs);
        record({
          level: result?.error ? 'warning' : 'info',
          kind: 'span',
          component: 'NavigatorAgent',
          msg: `action ${actionName}`,
          durationMs: Date.now() - actionStartedAt,
          data: { args: redactArgs(actionName, actionArgs), error: result?.error, extractedChars: result?.extractedContent?.length },
        });
        if (!result) throw new Error(`Action ${actionName} returned undefined`);
        if (indexArg !== null && actionArgs && typeof actionArgs === 'object') {
          result = new ActionResult({
            ...result,
            observationId: beforeObservation.id,
            targetFingerprint: targetFingerprintFromArgs(actionArgs),
            contractId,
            actionId,
            validationId,
          });
        }

        // Any action may change the page, so the cached read is dropped; only page-changing actions pay for a
        // new read now (it becomes the cache the next action and the next prompt use).
        const mutating = isMutatingAction(actionName);
        if (actionName !== 'done' && actionName !== 'ask_human') {
          await browserContext.invalidateCache();
        }
        const postActionState = !mutating
          ? beforeState
          : result.error
            ? await browserContext.getState(false)
            : await this.getSettledPostActionState(actionName, actionArgs, beforeState, result);
        ensureBrowserObservation(postActionState);
        result = validateActionOutcome({
          actionName,
          actionArgs,
          before: beforeState,
          after: postActionState,
          result,
        });
        record({
          level: result.validated === 'failed' ? 'warning' : 'info',
          kind: 'span',
          component: 'Validation',
          msg: `validated ${actionName}: ${result.validated}`,
          data: { retryability: result.retryability, failureReason: result.failureReason, evidence: result.evidence },
        });
        result = new ActionResult({
          ...result,
          contractId,
          actionId,
          validationId,
          observationId: result.observationId ?? beforeObservation.id,
        });
        this.context.activeObservation = postActionState.observation;
        if (mutating && contractId) {
          const progress = ProgressLedger.recordFromActionResult({
            taskId: this.context.taskId,
            contractId,
            observationId: result.observationId,
            actionId,
            actionName,
            result,
          });
          this.context.validatedProgress = ProgressLedger.append(this.context.validatedProgress, progress);
        }
        if (result.isWaitingForHuman) {
          this.context.blockedState = {
            kind: 'needs_human',
            question: result.extractedContent || 'The agent needs your input.',
            evidence: result.evidence,
            resumePolicy: 'replan_after_response',
          };
        }
        if (this.context.traceStore) {
          void this.context.traceStore.append({
            taskId: this.context.taskId,
            actor: 'validator',
            type: 'action.validated',
            contractId: contractId ?? undefined,
            observationId: result.observationId ?? undefined,
            actionId,
            validationId,
            payload: {
              actionName,
              validated: result.validated,
              retryability: result.retryability,
              evidence: result.evidence,
              failureReason: result.failureReason,
            },
            timestamp: Date.now(),
          });
        }

        if (indexArg !== null) {
          const domElement = beforeState.selectorMap.get(actionInstance.getIndexArg(actionArgs) ?? indexArg);
          if (domElement) {
            result.interactedElement = HistoryTreeProcessor.convertDomElementToHistoryElement(domElement);
          }
        }

        // Complete per-action result log
        const actionLogMsg = `[Action] [${i + 1}/${actions.length}] ${actionName}\n` +
          `  args  : ${JSON.stringify(redactArgs(actionName, actionArgs))}\n` +
          `  done  : ${result.isDone}\n` +
          `  validation: ${result.validated} (${result.retryability})\n` +
          `  evidence: ${JSON.stringify(result.evidence)}\n` +
          `  error : ${result.error || '(none)'}\n` +
          `  interactedElement: ${result.interactedElement ? JSON.stringify(result.interactedElement) : '(none)'}\n` +
          `  extracted: ${result.extractedContent ? result.extractedContent.slice(0, 500) : '(none)'}`;

        console.log(`\n${actionLogMsg}`);
        logger.info(actionLogMsg);
        results.push(result);

        // If the action returned an error, halt immediately to prevent execution on incorrect page state
        if (result.error) {
          logger.warning(`Action ${i + 1} (${actionName}) returned an error. Halting remaining queue.`);
          break;
        }

        if (shouldStopAfterValidation(result, actionName)) {
          logger.warning(`Action ${i + 1} (${actionName}) validation=${result.validated}; stopping queue for re-observe/replan.`);
          if (result.failureReason) {
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, result.failureReason);
          }
          break;
        }

        // Later actions were chosen for the page the model saw; a new URL or tab makes them meaningless.
        if (mutating && (postActionState.url !== beforeState.url || postActionState.tabId !== beforeState.tabId)) {
          logger.info(`Action ${i + 1} (${actionName}) moved to another page; the remaining actions wait for the next step.`);
          break;
        }
      } catch (error) {
        if (error instanceof URLNotAllowedError) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        const failMsg = `[Action] [${i + 1}/${actions.length}] ${actionName} FAILED\n  args : ${JSON.stringify(redactArgs(actionName, actionArgs))}\n  error: ${msg}`;
        console.warn(`\n${failMsg}`);
        logger.error(failMsg);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);

        results.push(new ActionResult({
          error: msg,
          isDone: false,
          includeInMemory: true,
          contractId,
          actionId,
          validationId,
          executionStatus: 'threw',
          validated: 'failed',
          retryability: /element (with index \d+ )?(is )?(no longer available|does not exist|not present|stale)/i.test(msg)
            ? 'replan'
            : 'retry_reobserve',
          failureReason: /element (with index \d+ )?(is )?(no longer available|does not exist|not present|stale)/i.test(msg)
            ? `${msg}. The DOM changed after this index was selected; re-observe and choose a current target instead of retrying the same index.`
            : msg,
          observationId: this.context.activeObservation?.id ?? null,
          targetFingerprint: targetFingerprintFromArgs(actionArgs),
          evidence: [{ kind: 'error', passed: false, message: msg }],
        }));
        // Stop execution immediately on thrown action failures!
        break;
      }
    }

    return results;
  }

  private async delayBetweenActions() {
    const delay = (this.context.browserContext.getConfig().waitBetweenActions ?? 0.15) * 1000;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, delay);
      this.context.controller.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }

  async executeHistoryStep(
    historyItem: AgentStepRecord,
    stepIndex: number,
    totalSteps: number,
    maxRetries = 3,
    delay = 800,
    skipFailures = true,
  ): Promise<ActionResult[]> {
    const replayLogger = createLogger('NavigatorAgent:executeHistoryStep');
    const results: ActionResult[] = [];

    try {
      const { parsedOutput, goal, actionsToReplay } = this.historyReplayer.parseHistoryModelOutput(historyItem);
      replayLogger.info(`Replaying step ${stepIndex + 1}/${totalSteps}: goal: ${goal}`);
      replayLogger.debug(`🔄 Replaying actions:`, actionsToReplay);

      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        if (this.context.stopped) break;

        try {
          const stepResults = await this.historyReplayer.executeHistoryActions(parsedOutput, historyItem, delay);
          results.push(...stepResults);
          success = true;
        } catch (error) {
          if (++retryCount >= maxRetries) {
            const failMsg = `Step ${stepIndex + 1} failed after ${maxRetries} attempts: ${error}`;
            replayLogger.error(failMsg);
            results.push(new ActionResult({ error: failMsg, includeInMemory: true }));
            if (!skipFailures) throw new Error(failMsg);
          } else {
            replayLogger.warning(`Step ${stepIndex + 1} failed (attempt ${retryCount}/${maxRetries}), retrying...`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
    } catch (error) {
      const msg = `Step ${stepIndex + 1}: ${error}`;
      replayLogger.warning(msg);
      results.push(new ActionResult({ error: msg, includeInMemory: false }));
    }

    return results;
  }
}

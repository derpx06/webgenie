import type { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { ActionResult, type AgentBrain, type AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import { calcBranchPathHashSet } from '@src/background/browser/dom/views';
import { BrowserStateHistory, URLNotAllowedError, type BrowserState } from '@src/background/browser/views';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import { AgentStepRecord } from '../history';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { WebGenieMemoryStore, ContextRouter, ContextBuilder } from '../memory';
import { PyramidLevel } from '@src/background/agent/messages/views';

import { NavigatorActionRegistry } from './navigator/registry';
export { NavigatorActionRegistry };
import { HistoryReplayer } from './navigator/replay';
import { normalizeActions } from './navigator/utils';
import { handleAgentError } from './utils/error-handler';
import { ensureBrowserObservation } from '../validation/observation';
import {
  fingerprintFailureKey,
  isMutatingAction,
  normalizeIndexedAction,
  shouldStopAfterValidation,
  shouldBlockRepeatedAction,
  hasActionPostconditionSatisfied,
  validateActionOutcome,
} from '../validation/service';
import { ProgressLedger } from '../contracts';
import type { BrowserObservation, TargetFingerprint } from '../validation/types';
import { waitForActionSettled } from '../validation/settling';

const logger = createLogger('NavigatorAgent');

export interface NavigatorResult {
  done: boolean;
}

function targetFingerprintFromArgs(actionArgs: unknown): TargetFingerprint | null {
  if (actionArgs === null || typeof actionArgs !== 'object') return null;
  if (!('targetFingerprint' in actionArgs)) return null;
  const value = (actionArgs as { targetFingerprint?: unknown }).targetFingerprint;
  return value && typeof value === 'object' ? value as TargetFingerprint : null;
}

export class NavigatorAgent extends BaseAgent<z.ZodType, NavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;
  private historyReplayer: HistoryReplayer;

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(actionRegistry.setupModelOutputSchema(), options, { ...extraOptions, id: 'navigator' });
    this.actionRegistry = actionRegistry;
    this.historyReplayer = new HistoryReplayer(this.context, actionRegistry, this.doMultiAction.bind(this));
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    try {
      const currentPage = await this.context.browserContext.getCurrentPage().catch(() => null);
      const currentUrl = currentPage?.url() || '';
      const macroObjective = this.context.lastMacroObjective;
      this.modelOutputSchema = this.actionRegistry.setupModelOutputSchema(currentUrl, macroObjective);
    } catch (error) {
      logger.error('Failed to dynamically update schema for invoke:', error);
    }
    return super.invoke(inputMessages);
  }

  async execute(): Promise<AgentOutput<NavigatorResult>> {
    const agentOutput: AgentOutput<NavigatorResult> = { id: this.id };
    const cancelled = false;
    let browserStateHistory: BrowserStateHistory | null = null;
    let actionResults: ActionResult[] = [];
    let modelOutputString: string | null = null;

    try {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_START, 'Navigating...');

      await this.prepareExecution();
      const currentState = await this.context.browserContext.getCachedState();
      browserStateHistory = new BrowserStateHistory(currentState);

      if (this.isTaskInterrupted()) return agentOutput;

      // Extract current page state message from MessageManager (last added message)
      const allMsgs = this.context.messageManager.getMessages();
      const currentStateMsg = allMsgs[allMsgs.length - 1] as HumanMessage;

      // Build structured context packet
      const contextPacket = ContextBuilder.buildContextPacket(
        this.context,
        this.prompt.getSystemMessage(),
        currentStateMsg,
        'navigator',
      );

      const modelOutput = await this.invoke(contextPacket);

      if (this.isTaskInterrupted()) return agentOutput;

      // Process actions
      const actions = normalizeActions(modelOutput.action);
      modelOutput.action = actions;
      modelOutputString = JSON.stringify(modelOutput);

      // ── SELF-REFLECTION & STRUCTURED MEMORY PROPAGATION ─────────────────
      const brain: AgentBrain = modelOutput.current_state;
      if (brain?.evaluation_previous_goal) {
        this.context.lastEvaluation = brain.evaluation_previous_goal;
      }
      if (brain?.memory) {
        this.context.lastMemory = brain.memory;
      }

      // Import facts, constraints, decisions, and progress from Navigator LLM response
      this.context.memory.importFromLLMResponse(brain);

      // Full brain state log (untruncated)
      const brainDivider = '─'.repeat(60);
      console.log(
        `\n[Navigator:Brain] ${brainDivider}\n` +
        `  evaluation_previous_goal:\n    ${brain?.evaluation_previous_goal || '(none)'}\n` +
        `  memory:\n    ${brain?.memory || '(none)'}\n` +
        `  actions requested: ${(modelOutput.action as unknown[]).length}\n` +
        `  actions: ${JSON.stringify(modelOutput.action, null, 2)}\n` +
        `[Navigator:Brain] ${brainDivider}`,
      );
      logger.info(`[Brain] evaluation: ${brain?.evaluation_previous_goal || '(none)'}`);
      logger.info(`[Brain] memory: ${brain?.memory || '(none)'}`);
      // ─────────────────────────────────────────────────────────────────────

      // ── Persist durable working memory scratchpad ─────────────────────────
      if (brain?.memory) {
        void this.context.messageManager.setWorkingMemory(brain.memory);
      }
      if (brain?.evaluation_previous_goal) {
        this.context.lastEvaluation = brain.evaluation_previous_goal;
      }
      // ─────────────────────────────────────────────────────────────────────

      this.removeLastStateMessageFromMemory();
      this.context.messageManager.addModelOutput(modelOutput);

      actionResults = await this.doMultiAction(actions);
      this.context.actionResults = actionResults;

      // Push actions to RecentActionBuffer
      for (const act of actions) {
        const entries = Object.entries(act).filter(([, value]) => value !== null && value !== undefined);
        const name = entries.map(([key]) => key).join('|') || 'invalid_action';
        const args = JSON.stringify(Object.fromEntries(entries));
        this.context.memory.recentActions.pushAction(`${name} ${args}`);
      }

      if (this.isTaskInterrupted()) return agentOutput;

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Navigation done');
      agentOutput.result = {
        done: actionResults.length > 0 && actionResults[actionResults.length - 1].isDone
      };

      return agentOutput;
    } catch (error) {
      return this.handleExecutionError(error, agentOutput);
    } finally {
      this.finalizeExecution(cancelled, browserStateHistory, actionResults, modelOutputString);
    }
  }

  private async prepareExecution() {
    await this.addStateMessageToMemory();
    const currentState = await this.context.browserContext.getCachedState();
    if (currentState.screenshot) {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.SIGHT_UPDATE, 'Sight updated', currentState.screenshot);
    }

    // Fast-Path Selection: Check memory store for learned selectors
    try {
      const currentUrl = currentState.url;
      if (currentUrl && this.context.lastGoal) {
        const domain = new URL(currentUrl).hostname;
        const pagePath = ContextRouter.getPagePath(currentUrl);
        const layoutHash = this.context.activeLayoutHash;
        
        if (domain && pagePath && layoutHash) {
          const learnedSelectors = await WebGenieMemoryStore.recallSelectors(
            domain, pagePath, layoutHash
          );
          
          if (learnedSelectors && learnedSelectors.length > 0) {
            const learnedSelector = learnedSelectors.find(s => s.intentKey === this.context.lastGoal?.toLowerCase().trim()) || learnedSelectors[0];

            if (learnedSelector) {
              this.context.messageManager.addMessageWithTokens(
                new HumanMessage(`[Fast-Path] Found proven selector for this goal: ${learnedSelector.selector} (xpath: ${learnedSelector.xpath}). Use this directly instead of exploring.`),
                PyramidLevel.TRACE,
                'fast_path_hint'
              );
              logger.info(`Injected Fast-Path hint for intent="${this.context.lastGoal}"`);
            }
          }
        }
      }
    } catch (e) {
      logger.error('Failed to inject Fast-Path hint:', e);
    }
  }

  private isTaskInterrupted(): boolean {
    return this.context.paused || this.context.stopped;
  }

  private handleExecutionError(error: unknown, output: AgentOutput<NavigatorResult>): AgentOutput<NavigatorResult> {
    this.removeLastStateMessageFromMemory();
    try {
      handleAgentError(error, 'Navigation failed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? 'Unknown navigation error');
      logger.error(msg);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_FAIL, msg);
      output.error = msg;
    }
    return output;
  }

  private finalizeExecution(cancelled: boolean, history: BrowserStateHistory | null, results: ActionResult[], outputStr: string | null) {
    if (this.isTaskInterrupted()) {
      this.removeLastStateMessageFromMemory();
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_CANCEL, 'Navigation cancelled');
    }

    if (history) {
      const resultsCopy = results.map(r => new ActionResult({ ...r }));
      this.context.history.history.push(new AgentStepRecord(outputStr, resultsCopy, history));
    }
  }

  public async addStateMessageToMemory() {
    if (this.context.stateMessageAdded) return;

    // Process pending action results
    this.context.actionResults.forEach((r) => {
      if (!r.includeInMemory) return;

      if (r.extractedContent) {
        this.context.messageManager.addMessageWithTokens(
          new HumanMessage(`Action result: ${r.extractedContent}`),
          PyramidLevel.TRACE,
          'action_result'
        );
      }
      if (r.error) {
        const lastLine = r.error.toString().split('\n').pop() || '';
        this.context.messageManager.addMessageWithTokens(
          new HumanMessage(`Action error: ${lastLine}`),
          PyramidLevel.TRACE,
          'action_error'
        );
      }
    });

    const state = await this.prompt.getUserMessage(this.context);
    this.context.messageManager.addStateMessage(state);
    this.context.stateMessageAdded = true;
    // Results are now represented in the state prompt and trace memory. Keep
    // the context clean so the same native capability output is not injected
    // again after the state message is removed on the next step.
    this.context.actionResults = [];
  }

  protected async removeLastStateMessageFromMemory() {
    if (!this.context.stateMessageAdded) return;
    this.context.messageManager.removeLastStateMessage();
    this.context.stateMessageAdded = false;
  }

  public async executePreplannedActions(actions: Record<string, unknown>[]): Promise<ActionResult[]> {
    return this.doMultiAction(actions);
  }

  private observationsDiverged(before: BrowserObservation | undefined, after: BrowserObservation | undefined): boolean {
    if (!before || !after) return false;
    return before.tabId !== after.tabId ||
      before.url !== after.url ||
      before.documentFingerprint !== after.documentFingerprint ||
      before.layoutFingerprint !== after.layoutFingerprint;
  }

  private async getSettledPostActionState(
    actionName: string,
    actionArgs: unknown,
    beforeState: BrowserState,
  ): Promise<BrowserState> {
    const config = this.context.browserContext.getConfig();
    const timeoutMs = Math.max(250, config.actionSettleTimeoutMs ?? 2000);
    const pollIntervalMs = Math.max(50, config.actionPollIntervalMs ?? 100);
    const startedAt = Date.now();
    const settleResult = await waitForActionSettled(
      () => this.context.browserContext.getState(false, false, true),
      state => hasActionPostconditionSatisfied({ actionName, actionArgs, before: beforeState, after: state }),
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
    const browserState = await browserContext.getCachedState(this.context.options.useVision);
    const initialObservation = ensureBrowserObservation(browserState);
    this.context.activeObservation = initialObservation;
    const cachedPathHashes = await calcBranchPathHashSet(browserState);

    await browserContext.removeHighlight();

    let maxAllowed = 2;
    if (this.context.lastMacroObjective === 'FORM_FILL' || this.context.lastMacroObjective === 'SEARCH' || this.context.lastMacroObjective === 'BROWSER_CONTROL') {
      maxAllowed = 5;
    }

    if (actions.length > maxAllowed) {
      logger.warning(`Navigator hallucinated ${actions.length} actions for macro ${this.context.lastMacroObjective}. Slicing to ${maxAllowed}.`);
      actions = actions.slice(0, maxAllowed);
    }

    for (const [i, action] of actions.entries()) {
      if (this.isTaskInterrupted()) break;

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
        const allowedActions = this.context.currentContract?.allowedActions ?? [];
        if (allowedActions.length > 0 && !allowedActions.includes(actionName)) {
          const msg = `Action ${actionName} is not allowed by contract ${contractId ?? 'current contract'}; replan with one of: ${allowedActions.join(', ')}.`;
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
            payload: { actionName, actionArgs },
            timestamp: Date.now(),
          });
        }

        if (indexArg !== null) {
          const normalized = normalizeIndexedAction(actionName, actionArgs, beforeObservation);
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
          if (shouldBlockRepeatedAction({
            actionName,
            actionArgs,
            contractId,
            recentResults: this.context.actionResults,
          })) {
            const msg = `Repeated ${actionName} on the same target did not produce validated progress; forcing replan.`;
            const blockedResult = new ActionResult({
              executed: false,
              executionStatus: 'not_attempted',
              validated: 'failed',
              retryability: 'replan',
              failureReason: msg,
              extractedContent: msg,
              includeInMemory: true,
              observationId: beforeObservation.id,
              targetFingerprint: targetFingerprintFromArgs(actionArgs),
              contractId,
              actionId,
              validationId,
              evidence: [{ kind: 'error', passed: false, message: msg }],
            });
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
            results.push(blockedResult);
            break;
          }
        }

        // Check if page state changed significantly between multi-actions
        if (i > 0 && indexArg !== null) {
          const newState = await browserContext.getCachedState(this.context.options.useVision, false);
          const newPathHashes = await calcBranchPathHashSet(newState);
          if (!newPathHashes.isSubsetOf(cachedPathHashes)) {
            const msg = `Something new appeared after action ${i} / ${actions.length}`;
            results.push(new ActionResult({ extractedContent: msg, includeInMemory: true }));
            break;
          }
        }

        let result = await actionInstance.call(actionArgs);
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

        if (actionName !== 'done' && actionName !== 'ask_human') {
          await browserContext.invalidateCache();
        }

        const postActionState = actionName === 'done' || actionName === 'ask_human'
          ? beforeState
          : result.error
            ? await browserContext.getState(false, false, true)
            : await this.getSettledPostActionState(actionName, actionArgs, beforeState);
        ensureBrowserObservation(postActionState);
        result = validateActionOutcome({
          actionName,
          actionArgs,
          before: beforeState,
          after: postActionState,
          result,
          recentResults: results,
        });
        result = new ActionResult({
          ...result,
          contractId,
          actionId,
          validationId,
          observationId: result.observationId ?? beforeObservation.id,
        });
        this.context.activeObservation = postActionState.observation;
        if (isMutatingAction(actionName) && contractId) {
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
          const domElement = browserState.selectorMap.get(indexArg);
          if (domElement) {
            result.interactedElement = HistoryTreeProcessor.convertDomElementToHistoryElement(domElement);

            // Record successful interactions to memory store
            if (!result.error && result.validated === 'passed' && result.interactedElement) {
              try {
                const domain = new URL(browserState.url).hostname;
                const pagePath = ContextRouter.getPagePath(browserState.url);
                const layoutHash = this.context.activeLayoutHash;
                const intentKey = this.context.lastGoal || '';
                const xpath = result.interactedElement.xpath;
                const selector = result.interactedElement.cssSelector ||
                  (domElement.attributes?.['id'] ? `#${domElement.attributes['id']}` : '') ||
                  (domElement.attributes?.['data-webgenie-id'] ? `[data-webgenie-id="${domElement.attributes['data-webgenie-id']}"]` : '') ||
                  domElement.tagName || '';

                if (domain && pagePath && layoutHash && xpath && selector) {
                  void WebGenieMemoryStore.learnSelector(
                    domain, pagePath, layoutHash, intentKey, selector, xpath,
                  );
                  logger.info(`Learned selector | intent="${intentKey}" xpath=${xpath}`);
                }
              } catch (err) {
                logger.error('Failed to save successful selector in memory store:', err);
              }
            }
          }
        }

        // Complete per-action result log
        const actionLogMsg = `[Action] [${i + 1}/${actions.length}] ${actionName}\n` +
          `  args  : ${JSON.stringify(actionArgs)}\n` +
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
          this.actionRegistry.refineActionDescription(actionName, result.error, actionArgs);
          break;
        }

        if (result.validated === 'failed' && indexArg !== null) {
          const failureKey = fingerprintFailureKey(result.targetFingerprint, browserState.url);
          this.context.registerFailure(failureKey, browserState.url, actionName);

          const failRecord = this.context.failureRegistry.get(failureKey);
          if (failRecord && failRecord.failCount >= 2) {
            const blockMsg = `[FailureRegistry] ⛔ target="${failureKey}" is now BLOCKED ` +
              `(${failRecord.failCount} validated failures on ${browserState.url})`;
            console.warn(blockMsg);
            logger.warning(blockMsg);
          }
        } else if (postActionState.url !== browserState.url) {
          this.context.clearFailuresForUrl(browserState.url);
        }

        if (shouldStopAfterValidation(result, actionName)) {
          logger.warning(`Action ${i + 1} (${actionName}) validation=${result.validated}; stopping queue for re-observe/replan.`);
          if (result.failureReason) {
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, result.failureReason);
          }
          break;
        }

        if (
          i < actions.length - 1 &&
          isMutatingAction(actionName) &&
          this.observationsDiverged(beforeObservation, postActionState.observation)
        ) {
          logger.info(`Action ${i + 1} changed observation; aborting remaining queued actions for fresh replan.`);
          break;
        }

        if (this.isTaskInterrupted()) break;
        const statePreFetchPromise = browserContext.getState(this.context.options.useVision, false, true);
        await this.delayBetweenActions();
        await statePreFetchPromise.catch(err => {
          logger.warning(`State pre-fetch failed: ${err.message}`);
        });

      } catch (error) {
        if (error instanceof URLNotAllowedError) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        const failMsg = `[Action] [${i + 1}/${actions.length}] ${actionName} FAILED\n  args : ${JSON.stringify(actionArgs)}\n  error: ${msg}`;
        console.warn(`\n${failMsg}`);
        logger.error(failMsg);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);

        this.actionRegistry.refineActionDescription(actionName, msg, actionArgs);
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

    if (!this.isTaskInterrupted()) {
      logger.info('Starting background pre-fetch of final state for next turn...');
      void browserContext.getState(this.context.options.useVision, false, true).catch(err => {
        logger.warning(`Final state pre-fetch failed: ${err.message}`);
      });
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

import type { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { ActionResult, type AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import {
  ResponseParseError,
  isAbortedError,
} from './errors';
import { calcBranchPathHashSet } from '@src/background/browser/dom/views';
import { BrowserStateHistory, URLNotAllowedError } from '@src/background/browser/views';
import { convertZodToJsonSchema, optimizeSchemaConstraints } from '@src/background/utils';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import { AgentStepRecord } from '../history';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ProviderTypeEnum } from '@extension/storage';
import { WebGenieMemoryStore, ContextRouter, ContextBuilder } from '../memory';
import { PyramidLevel } from '@src/background/agent/messages/views';

import { NavigatorActionRegistry } from './navigator/registry';
export { NavigatorActionRegistry };
import { HistoryReplayer } from './navigator/replay';
import { normalizeActions } from './navigator/utils';
import { handleAgentError } from './utils/error-handler';

const logger = createLogger('NavigatorAgent');

export interface NavigatorResult {
  done: boolean;
}

interface TokenUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface NavigatorToolCall {
  args: {
    currentState: unknown;
    action: unknown[];
  };
}

interface RawNavigatorResponse {
  usage_metadata?: TokenUsageLike;
  additional_kwargs?: {
    tokenUsage?: TokenUsageLike;
  };
  tool_calls?: NavigatorToolCall[];
}

export class NavigatorAgent extends BaseAgent<z.ZodType, NavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;
  private historyReplayer: HistoryReplayer;
  private jsonSchema: Record<string, unknown>;

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(actionRegistry.setupModelOutputSchema(), options, { ...extraOptions, id: 'navigator' });
    this.actionRegistry = actionRegistry;
    this.historyReplayer = new HistoryReplayer(this.context, actionRegistry, this.doMultiAction.bind(this));
    this.jsonSchema = this.createResponseSchema();
  }

  private createResponseSchema(): Record<string, unknown> {
    const schema = convertZodToJsonSchema(this.modelOutputSchema, 'NavigatorAgentOutput', true);
    return this.provider === ProviderTypeEnum.Gemini || this.provider === ProviderTypeEnum.VertexAI
      ? optimizeSchemaConstraints(schema) as Record<string, unknown>
      : schema;
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    if (!this.withStructuredOutput) {
      return super.invoke(inputMessages);
    }

    try {
      const currentPage = await this.context.browserContext.getCurrentPage().catch(() => null);
      const currentUrl = currentPage?.url() || '';
      const macroObjective = this.context.lastMacroObjective;
      this.modelOutputSchema = this.actionRegistry.setupModelOutputSchema(currentUrl, macroObjective);
      this.jsonSchema = this.createResponseSchema();
    } catch (e) {
      logger.error('Failed to dynamically update schema for invoke:', e);
    }

    const structuredLlm = this.chatLLM.withStructuredOutput(this.jsonSchema, {
      includeRaw: true,
      name: this.modelOutputToolName,
    });

    try {
      const response = await structuredLlm.invoke(inputMessages, {
        signal: this.context.controller.signal,
        callbacks: this.context.traceCallbacks || [],
        ...this.callOptions,
      });

      // Record token usage if available
      const rawResponse = response.raw as RawNavigatorResponse;
      if (rawResponse?.usage_metadata) {
        this.context.messageManager.recordTokenUsage(
          rawResponse.usage_metadata.input_tokens || 0,
          rawResponse.usage_metadata.output_tokens || 0
        );
      } else if (rawResponse?.additional_kwargs?.tokenUsage) {
        const usage = rawResponse.additional_kwargs.tokenUsage;
        this.context.messageManager.recordTokenUsage(
          usage.promptTokens || usage.input_tokens || 0,
          usage.completionTokens || usage.output_tokens || 0
        );
      }

      if (response.parsed) {
        const parsed = this.validateModelOutput(response.parsed);
        if (parsed) return parsed;
      }

      // Manual extraction fallback for JSON-parse failures
      if (typeof response.raw?.content === 'string') {
        const parsed = this.manuallyParseResponse(response.raw.content);
        if (parsed) return parsed;
      }

      // Tool call fallback
      const toolCalls = (response.raw as RawNavigatorResponse)?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        return {
          current_state: toolCall.args.currentState,
          action: [...toolCall.args.action],
        };
      }

      throw new ResponseParseError('Could not parse navigator response');
    } catch (error) {
      if (isAbortedError(error)) throw error;
      // Re-throw already-classified agent errors (auth, rate-limit, etc.) immediately
      if (
        error instanceof ResponseParseError ||
        error instanceof Error && [
          'ChatModelAuthError', 'ChatModelForbiddenError', 'ChatModelBadRequestError',
          'ChatModelRateLimitError', 'ChatModelPaymentRequiredError',
          'RequestCancelledError', 'URLNotAllowedError',
        ].includes(error.constructor?.name ?? '')
      ) {
        throw error;
      }
      // Classify raw LLM/network errors into typed agent errors
      handleAgentError(error, `Failed to invoke ${this.modelName} with structured output`);
    }
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
        currentStateMsg
      );

      const modelOutput = await this.invoke(contextPacket);

      if (this.isTaskInterrupted()) return agentOutput;

      // Process actions
      const actions = normalizeActions(modelOutput.action);
      modelOutput.action = actions;
      modelOutputString = JSON.stringify(modelOutput);

      // ── SELF-REFLECTION & STRUCTURED MEMORY PROPAGATION ─────────────────
      const brain = modelOutput.current_state as any;
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
        const name = Object.keys(act)[0];
        const args = JSON.stringify(act[name]);
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
    this.context.actionResults.forEach((r, i) => {
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
      this.context.actionResults[i] = new ActionResult();
    });

    const state = await this.prompt.getUserMessage(this.context);
    this.context.messageManager.addStateMessage(state);
    this.context.stateMessageAdded = true;
  }

  protected async removeLastStateMessageFromMemory() {
    if (!this.context.stateMessageAdded) return;
    this.context.messageManager.removeLastStateMessage();
    this.context.stateMessageAdded = false;
  }

  private async doMultiAction(actions: Record<string, unknown>[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const errCount = 0;
    const browserContext = this.context.browserContext;
    const browserState = await browserContext.getCachedState(this.context.options.useVision);
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

      const actionName = Object.keys(action)[0];
      const actionArgs = action[actionName];

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

        const result = await actionInstance.call(actionArgs);
        if (!result) throw new Error(`Action ${actionName} returned undefined`);

        if (actionName !== 'done' && actionName !== 'ask_human') {
          await browserContext.invalidateCache();
        }

        if (indexArg !== null) {
          const domElement = browserState.selectorMap.get(indexArg);
          if (domElement) {
            result.interactedElement = HistoryTreeProcessor.convertDomElementToHistoryElement(domElement);

            // Record successful interactions to memory store
            if (!result.error && result.interactedElement) {
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

        // ── FAILURE REGISTRY ───────────────────────────────────────────────
        // After executing the action, re-check the DOM path hash. If the page
        // state has NOT changed AND the action targeted a specific element,
        // register a failure so the element gets flagged as BLOCKED after
        // FAILURE_THRESHOLD repeated no-op interactions on the same URL.
        if (result && !result.isDone && !result.error && indexArg !== null) {
          const postActionState = await browserContext.getState(false, false, true);
          const postPathHashes = await calcBranchPathHashSet(postActionState);
          const pageChanged = !postPathHashes.isSubsetOf(cachedPathHashes) ||
            postActionState.url !== browserState.url;

          if (!pageChanged) {
            const domElement = browserState.selectorMap.get(indexArg);
            const selector = domElement?.attributes?.['data-webgenie-id'] ??
              domElement?.tagName ??
              String(indexArg);
            this.context.registerFailure(selector, browserState.url, actionName);

            const failRecord = this.context.failureRegistry.get(`${browserState.url}|${selector}`);
            if (failRecord && failRecord.failCount >= 2) {
              const blockMsg = `[FailureRegistry] ⛔ selector="${selector}" is now BLOCKED ` +
                `(${failRecord.failCount} no-op interactions on ${browserState.url})`;
              console.warn(blockMsg);
              logger.warning(blockMsg);
            }
          } else if (postActionState.url !== browserState.url) {
            // Navigated to a new URL — clear stale failures from the old page
            this.context.clearFailuresForUrl(browserState.url);
          }
        }
        // ──────────────────────────────────────────────────────────────────

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
        results.push(new ActionResult({ error: msg, isDone: false, includeInMemory: true }));
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

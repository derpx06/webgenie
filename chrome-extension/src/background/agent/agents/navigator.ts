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
import { convertZodToJsonSchema } from '@src/background/utils';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import { AgentStepRecord } from '../history';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';

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
    this.jsonSchema = convertZodToJsonSchema(this.modelOutputSchema, 'NavigatorAgentOutput', true);
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    if (!this.withStructuredOutput) {
      return super.invoke(inputMessages);
    }

    const structuredLlm = this.chatLLM.withStructuredOutput(this.jsonSchema, {
      includeRaw: true,
      name: this.modelOutputToolName,
    });

    try {
      const response = await structuredLlm.invoke(inputMessages, {
        signal: this.context.controller.signal,
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

      if (response.parsed) return response.parsed;

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

      const modelOutput = await this.invoke(this.context.messageManager.getMessages());

      if (this.isTaskInterrupted()) return agentOutput;

      // Process actions
      const actions = normalizeActions(modelOutput.action);
      modelOutput.action = actions;
      modelOutputString = JSON.stringify(modelOutput);

      // ── SELF-REFLECTION PROPAGATION ──────────────────────────────────────
      const brain = modelOutput.current_state as { evaluation_previous_goal?: string; memory?: string } | undefined;
      if (brain?.evaluation_previous_goal) {
        this.context.lastEvaluation = brain.evaluation_previous_goal;
      }
      if (brain?.memory) {
        this.context.lastMemory = brain.memory;
      }
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

      this.removeLastStateMessageFromMemory();
      this.context.messageManager.addModelOutput(modelOutput);

      actionResults = await this.doMultiAction(actions);
      this.context.actionResults = actionResults;

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
        this.context.messageManager.addMessageWithTokens(new HumanMessage(`Action result: ${r.extractedContent}`));
      }
      if (r.error) {
        const lastLine = r.error.toString().split('\n').pop() || '';
        this.context.messageManager.addMessageWithTokens(new HumanMessage(`Action error: ${lastLine}`));
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
    let errCount = 0;
    const browserContext = this.context.browserContext;
    const browserState = await browserContext.getState(this.context.options.useVision);
    const cachedPathHashes = await calcBranchPathHashSet(browserState);

    await browserContext.removeHighlight();

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
          const newState = await browserContext.getState(this.context.options.useVision);
          const newPathHashes = await calcBranchPathHashSet(newState);
          if (!newPathHashes.isSubsetOf(cachedPathHashes)) {
            const msg = `Something new appeared after action ${i} / ${actions.length}`;
            results.push(new ActionResult({ extractedContent: msg, includeInMemory: true }));
            break;
          }
        }

        const result = await actionInstance.call(actionArgs);
        if (!result) throw new Error(`Action ${actionName} returned undefined`);

        if (indexArg !== null) {
          const domElement = browserState.selectorMap.get(indexArg);
          if (domElement) {
            result.interactedElement = HistoryTreeProcessor.convertDomElementToHistoryElement(domElement);
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

        // ── FAILURE REGISTRY ───────────────────────────────────────────────
        // After executing the action, re-check the DOM path hash. If the page
        // state has NOT changed AND the action targeted a specific element,
        // register a failure so the element gets flagged as BLOCKED after
        // FAILURE_THRESHOLD repeated no-op interactions on the same URL.
        if (result && !result.isDone && !result.error && indexArg !== null) {
          const postActionState = await browserContext.getState(false);
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
        await this.delayBetweenActions();

      } catch (error) {
        if (error instanceof URLNotAllowedError) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        const failMsg = `[Action] [${i + 1}/${actions.length}] ${actionName} FAILED\n  args : ${JSON.stringify(actionArgs)}\n  error: ${msg}`;
        console.warn(`\n${failMsg}`);
        logger.error(failMsg);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);

        if (++errCount > 3) throw new Error('Too many errors in actions');
        results.push(new ActionResult({ error: msg, isDone: false, includeInMemory: true }));
      }
    }
    return results;
  }

  private async delayBetweenActions() {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 500);
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

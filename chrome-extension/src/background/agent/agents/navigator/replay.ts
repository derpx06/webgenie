import { createLogger } from '@src/background/log';
import { ActionResult } from '../../types';
import { AgentStepRecord } from '../../history';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import { type DOMHistoryElement } from '@src/background/browser/dom/history/view';
import { type BrowserState } from '@src/background/browser/views';
import type { AgentContext } from '../../types';
import { NavigatorActionRegistry } from './registry';

const logger = createLogger('NavigatorReplay');

export interface ParsedModelOutput {
  current_state?: {
    next_goal?: string;
  };
  action?: (Record<string, unknown> | null)[] | null;
}

export class HistoryReplayer {
  constructor(
    private context: AgentContext,
    private actionRegistry: NavigatorActionRegistry,
    private doMultiAction: (actions: Record<string, unknown>[]) => Promise<ActionResult[]>,
  ) {}

  /**
   * Parse and validate model output from history item
   */
  public parseHistoryModelOutput(historyItem: AgentStepRecord): {
    parsedOutput: ParsedModelOutput;
    goal: string;
    actionsToReplay: (Record<string, unknown> | null)[] | null;
  } {
    if (!historyItem.modelOutput) {
      throw new Error('No model output found in history item');
    }

    let parsedOutput: ParsedModelOutput;
    try {
      parsedOutput = JSON.parse(historyItem.modelOutput) as ParsedModelOutput;
    } catch (error) {
      throw new Error(`Could not parse modelOutput: ${error}`);
    }

    const goal = parsedOutput?.current_state?.next_goal || '';
    const actionsToReplay = parsedOutput?.action;

    if (
      !parsedOutput ||
      !actionsToReplay ||
      (Array.isArray(actionsToReplay) && actionsToReplay.length === 0) ||
      (Array.isArray(actionsToReplay) && actionsToReplay.length === 1 && actionsToReplay[0] === null)
    ) {
      throw new Error('No action to replay');
    }

    return { parsedOutput, goal, actionsToReplay };
  }

  /**
   * Execute actions from history with element index updates
   */
  public async executeHistoryActions(
    parsedOutput: ParsedModelOutput,
    historyItem: AgentStepRecord,
    delay: number,
  ): Promise<ActionResult[]> {
    const state = await this.context.browserContext.getState(this.context.options.useVision);
    if (!state) {
      throw new Error('Invalid browser state');
    }

    const updatedActions: (Record<string, unknown> | null)[] = [];
    for (let i = 0; i < parsedOutput.action!.length; i++) {
      const result = historyItem.result[i];
      if (!result) break;

      const interactedElement = result.interactedElement;
      const currentAction = parsedOutput.action![i];

      if (currentAction === null) {
        updatedActions.push(null);
        continue;
      }

      await this.context.browserContext.waitForPageAndFramesLoad();
      const updatedState = await this.context.browserContext.getState(this.context.options.useVision);
      const updatedAction = interactedElement
        ? await this.updateActionIndices(interactedElement, currentAction, updatedState)
        : currentAction;
      updatedActions.push(updatedAction);

      if (updatedAction === null) {
        throw new Error(`Could not find matching element ${i} in current page`);
      }
    }

    const validActions = updatedActions.filter((action): action is Record<string, unknown> => action !== null);
    const result = await this.doMultiAction(validActions);

    await new Promise((resolve) => setTimeout(resolve, delay));
    return result;
  }

  public async updateActionIndices(
    historicalElement: DOMHistoryElement,
    action: Record<string, unknown>,
    currentState: BrowserState,
  ): Promise<Record<string, unknown> | null> {
    if (!historicalElement || !currentState.elementTree) {
      return action;
    }

    const currentElement = await HistoryTreeProcessor.findHistoryElementInTree(
      historicalElement,
      currentState.elementTree,
    );

    if (!currentElement || currentElement.highlightIndex === null) {
      return null;
    }

    const actionName = Object.keys(action)[0];
    const actionArgs = action[actionName] as Record<string, unknown>;

    const actionInstance = this.actionRegistry.getAction(actionName);
    if (!actionInstance) {
      return action;
    }

    const oldIndex = actionInstance.getIndexArg(actionArgs);

    if (oldIndex !== null && oldIndex !== currentElement.highlightIndex) {
      const updatedAction: Record<string, unknown> = { [actionName]: { ...actionArgs } };
      actionInstance.setIndexArg(updatedAction[actionName] as Record<string, unknown>, currentElement.highlightIndex);
      logger.info(`Element moved in DOM, updated index from ${oldIndex} to ${currentElement.highlightIndex}`);
      return updatedAction;
    }

    return action;
  }
}

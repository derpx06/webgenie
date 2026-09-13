import { createLogger } from '@src/background/log';
import type { ActionResult , AgentContext } from '../../types';
import type { AgentStepRecord } from '../../history';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import { type DOMHistoryElement } from '@src/background/browser/dom/history/view';
import { type BrowserState } from '@src/background/browser/views';
import type { NavigatorActionRegistry } from './registry';

const logger = createLogger('NavigatorReplay');

export interface ParsedModelOutput {
  current_state?: {
    next_goal?: string;
  };
  action?: (Record<string, unknown> | null)[] | null;
}

type LegacyUpgrade = (args: Record<string, unknown>) => Record<string, unknown> | null;

/** Scroll arguments for an old scroll tool, keeping its optional element index. */
const scrollCall = (args: Record<string, unknown>, direction: string, pages?: number) => ({
  scroll: { direction, ...(pages ? { pages } : {}), ...(args.index != null ? { index: args.index } : {}) },
});

/** Tools removed or renamed since histories were saved, as the call that does the same now; null drops a read-only call. */
const LEGACY_ACTIONS: Record<string, LegacyUpgrade> = {
  scroll_to_top: args => scrollCall(args, 'top'),
  scroll_to_bottom: args => scrollCall(args, 'bottom'),
  next_page: args => scrollCall(args, 'down', 1),
  previous_page: args => scrollCall(args, 'up', 1),
  // ponytail: no percent position any more; the nearer end is the closest match.
  scroll_to_percent: args => scrollCall(args, Number(args.yPercent) >= 50 ? 'bottom' : 'top'),
  cache_content: args => ({ save_findings: { text: String(args.content ?? '') } }),
  search_google: args => ({ search_web: { query: String(args.query ?? ''), engine: 'google' } }),
  get_dropdown_options: () => null,
};

/** A saved action in today's tool names and arguments; anything not renamed is returned unchanged. */
export function upgradeLegacyAction(action: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!action) return action;
  const [name] = Object.keys(action);
  const upgrade = LEGACY_ACTIONS[name];
  return upgrade ? upgrade((action[name] ?? {}) as Record<string, unknown>) : action;
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
    const state = await this.context.browserContext.getState();
    if (!state) {
      throw new Error('Invalid browser state');
    }

    const updatedActions: (Record<string, unknown> | null)[] = [];
    for (let i = 0; i < parsedOutput.action!.length; i++) {
      const result = historyItem.result[i];
      if (!result) break;

      const interactedElement = result.interactedElement;
      const currentAction = upgradeLegacyAction(parsedOutput.action![i]);

      if (currentAction === null) {
        updatedActions.push(null);
        continue;
      }

      await this.context.browserContext.waitForPageAndFramesLoad();
      const updatedState = await this.context.browserContext.getState();
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

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { describe, expect, it } from 'vitest';
import type BrowserContext from '../../../browser/context';
import { ResponseParseError } from '../errors';
import { PlannerAgent, planToolSchema } from '../planner';
import { buildToolDefinitions } from '../../actions/builder';
import { cleanPlannerOutput, createPlannerParseFallbackOutput } from '../planner/utils';
import type { BasePrompt } from '../../prompts/base';
import { AgentContext } from '../../types';
import type MessageManager from '../../messages/service';
import type { EventManager } from '../../event/manager';
import { ExecutionState, type AgentEvent } from '../../event/types';
import type { BrowserObservation } from '../../validation/types';
import { plannerSystemPromptTemplate } from '../../prompts/templates/planner';

class ParseFailingPlannerAgent extends PlannerAgent {
  protected override async invokeWithTools(): Promise<never> {
    throw new ResponseParseError('Could not parse response');
  }
}

function makeContext() {
  const emittedEvents: AgentEvent[] = [];
  const messageManager = {
    getTranscript: () => [],
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
  } as unknown as MessageManager;
  const eventManager = {
    subscribe: () => undefined,
    clearSubscribers: () => undefined,
    emit: async (event: AgentEvent) => {
      emittedEvents.push(event);
    },
  } as unknown as EventManager;
  const context = new AgentContext(
    'task-parse-fallback',
    {} as BrowserContext,
    messageManager,
    eventManager,
    {},
  );
  context.memory.goalManager.updateGoals('follow sam altman on twitter', 'follow sam altman on twitter', 'Open X profile');
  context.activeObservation = {
    id: 'obs-x-home',
    tabId: 1,
    url: 'https://x.com/home',
    title: 'X',
    capturedAt: 1000,
    documentFingerprint: 'doc-x',
    layoutFingerprint: 'layout-x',
    targets: [],
  } satisfies BrowserObservation;
  return { context, emittedEvents };
}

describe('PlannerAgent parse fallback', () => {
  it('converts planner response parse failures into a conservative execution contract', async () => {
    const { context, emittedEvents } = makeContext();
    const prompt = {
      getSystemMessage: () => new SystemMessage('planner system'),
    } as BasePrompt;
    const agent = new ParseFailingPlannerAgent({
      chatLLM: {} as BaseChatModel,
      context,
      prompt,
    });

    const output = await agent.execute(new HumanMessage('Current URL: https://x.com/home'));

    expect(output.error).toBeUndefined();
    expect(output.result).toMatchObject({
      done: false,
      mode: 'multi_step_task',
    });
    expect(output.result?.next_step_contract).toMatchObject({
      goal: 'follow sam altman on twitter',
      mode: 'multi_step_task',
      expectedObservation: { observationId: 'obs-x-home' },
    });
    expect(context.currentContract?.id).toBe(output.result?.next_step_contract?.id);
    expect(emittedEvents.some(event => event.state === ExecutionState.STEP_FAIL)).toBe(false);
  });

  it('uses a navigation fallback when the observation already contains an actionable target', () => {
    const output = createPlannerParseFallbackOutput({
      goal: 'click the visible follow button',
      currentObservation: {
        id: 'obs-follow',
        tabId: 1,
        url: 'https://example.com/profile',
        title: 'Profile',
        capturedAt: 1000,
        documentFingerprint: 'doc',
        layoutFingerprint: 'layout',
        targets: [{
          index: 42,
          actionType: 'click_element',
          accessibleName: 'Follow @example',
          tagName: 'button',
        }],
      } satisfies BrowserObservation,
      reason: 'Could not parse response',
    });

    expect(output.macro_objective).toBe('NAVIGATE');
    expect(output.next_step_contract?.macroObjective).toBe('NAVIGATE');
  });
});

describe('PlannerAgent response shape', () => {
  it('exposes one flat plan tool with only the compact planner fields', () => {
    const [tool] = buildToolDefinitions([planToolSchema]);
    const parameters = tool.function.parameters as { properties: Record<string, unknown>; required: string[] };

    expect(tool.function.name).toBe('plan');
    expect(Object.keys(parameters.properties).sort()).toEqual([
      'done', 'final_answer', 'macro_objective', 'matching_items', 'next_goal', 'success_condition',
    ]);
    expect([...parameters.required].sort()).toEqual(['done', 'macro_objective', 'next_goal']);
    expect(plannerSystemPromptTemplate).toContain('plan tool');
  });
});

describe('cleanPlannerOutput', () => {
  const plan = (matching_items?: string[]) => ({
    done: false,
    macro_objective: 'FORM_FILL' as const,
    next_goal: 'Add the item to the cart.',
    matching_items,
  });

  it('turns a step with several matching items into a question offering them', () => {
    const output = cleanPlannerOutput(plan(['Item A, small, $20', 'Item A, large, $35']));
    expect(output.macro_objective).toBe('ASK_HUMAN');
    expect(output.mode).toBe('blocked_human_needed');
    expect(output.next_goal).toContain('Item A, small, $20; Item A, large, $35');
    expect(output.next_step_contract?.goal).toBe(output.next_goal);
  });

  it('leaves the plan alone with one match, after the user answered, or when done', () => {
    expect(cleanPlannerOutput(plan(['Item A, small, $20'])).macro_objective).toBe('FORM_FILL');
    expect(cleanPlannerOutput(plan(['Item A, small, $20', 'Item A, small, $20'])).macro_objective).toBe('FORM_FILL');
    expect(cleanPlannerOutput(plan(['A', 'B']), { userAnswered: true }).macro_objective).toBe('FORM_FILL');
    expect(cleanPlannerOutput({ ...plan(['A', 'B']), done: true, final_answer: 'ok' }).mode).toBe('direct_answer');
  });
});

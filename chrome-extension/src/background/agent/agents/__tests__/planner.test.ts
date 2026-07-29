import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { describe, expect, it } from 'vitest';
import type BrowserContext from '../../../browser/context';
import { ResponseParseError } from '../errors';
import { PLANNER_JSON_OUTPUT_INSTRUCTION, PlannerAgent, type PlannerOutput } from '../planner';
import { createPlannerParseFallbackOutput } from '../planner/utils';
import type { BasePrompt } from '../../prompts/base';
import { AgentContext } from '../../types';
import type MessageManager from '../../messages/service';
import type { EventManager } from '../../event/manager';
import { ExecutionState, type AgentEvent } from '../../event/types';
import type { BrowserObservation } from '../../validation/types';
import { plannerSystemPromptTemplate } from '../../prompts/templates/planner';

class ParseFailingPlannerAgent extends PlannerAgent {
  override async invoke(): Promise<PlannerOutput> {
    throw new ResponseParseError('Could not parse response');
  }
}

function makeContext() {
  const emittedEvents: AgentEvent[] = [];
  const messageManager = {
    getMessages: () => [new HumanMessage('Current URL: https://x.com/home')],
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
      provider: 'google',
    });

    const output = await agent.execute();

    expect(output.error).toBeUndefined();
    expect(output.result).toMatchObject({
      done: false,
      web_task: true,
      mode: 'multi_step_task',
    });
    expect(output.result?.next_step_contract).toMatchObject({
      goal: 'follow sam altman on twitter',
      mode: 'multi_step_task',
      expectedObservation: { observationId: 'obs-x-home' },
      replanTrigger: 'validation_unknown',
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
    expect(output.next_step_contract?.allowedActions).toContain('click_element');
  });
});

describe('PlannerAgent response shape', () => {
  it('instructs the model to emit compact planner DTO fields instead of internal contracts', () => {
    expect(PLANNER_JSON_OUTPUT_INSTRUCTION).toContain('"next_goal"');
    expect(PLANNER_JSON_OUTPUT_INSTRUCTION).toContain('"allowed_actions"');
    expect(PLANNER_JSON_OUTPUT_INSTRUCTION).not.toContain('"next_step_contract":');
    expect(PLANNER_JSON_OUTPUT_INSTRUCTION).toContain('Do not include next_step_contract');
    expect(plannerSystemPromptTemplate).toContain('Do NOT output internal contract fields');
    expect(plannerSystemPromptTemplate).not.toContain('"next_step_contract": {');
  });
});

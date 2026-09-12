import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { ActionResult, AgentContext } from '../../types';
import { ContextBuilder } from '../../memory';
import { DOMElementNode } from '../../../browser/dom/views';
import type { BrowserObservation } from '../../validation/types';
import type { BrowserState } from '../../../browser/views';
import type BrowserContext from '../../../browser/context';
import type MessageManager from '../../messages/service';
import type { EventManager } from '../../event/manager';
import { createBrowserObservation } from '../../validation/observation';
import {
  ExecutionRouter,
  ProgressLedger,
  TaskCheckpointStore,
  getReplanDecision,
  normalizeNextStepContract,
  normalizePlannerOutputContract,
  plannerLLMOutputSchema,
  shouldForceReplanAfterResume,
} from '..';

class MemoryStorage {
  private values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function element(index: number) {
  return new DOMElementNode({
    tagName: 'button',
    xpath: `/html/body/button[${index}]`,
    attributes: { 'aria-label': `Button ${index}` },
    children: [],
    isVisible: true,
    isInteractive: true,
    isTopElement: true,
    isInViewport: true,
    highlightIndex: index,
    backendNodeId: index + 100,
  });
}

function browserState(overrides: Partial<BrowserState> = {}): BrowserState {
  const root = new DOMElementNode({
    tagName: 'root',
    xpath: '',
    attributes: {},
    children: [],
    isVisible: true,
  });
  const selectorMap = overrides.selectorMap ?? new Map([[1, element(1)]]);
  const base: BrowserState = {
    elementTree: root,
    selectorMap,
    tabId: 1,
    url: 'https://example.com/start',
    title: 'Start',
    screenshot: null,
    scrollY: 0,
    scrollHeight: 1000,
    visualViewportHeight: 500,
    tabs: [{ id: 1, url: 'https://example.com/start', title: 'Start' }],
  };
  return { ...base, ...overrides };
}

function observation(): BrowserObservation {
  return createBrowserObservation(browserState(), 1000);
}

function contextStub() {
  const messageManager = {
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    getTranscript: () => [],
  };
  const eventManager = {
    subscribe: () => undefined,
    clearSubscribers: () => undefined,
    emit: async () => undefined,
  };
  return new AgentContext(
    'task-1',
    {} as BrowserContext,
    messageManager as unknown as MessageManager,
    eventManager as unknown as EventManager,
    {},
  );
}

describe('P1 contracts', () => {
  it('plan tool schema requires the compact planner fields and strips internal contract fields', () => {
    const parsed = plannerLLMOutputSchema.parse({
      done: false,
      macro_objective: 'NAVIGATE',
      next_goal: 'open example',
      allowed_actions: ['go_to_url'],
      next_step_contract: { id: 'contract-schema', createdAt: 1000 },
    });

    expect(parsed).toEqual({ done: false, macro_objective: 'NAVIGATE', next_goal: 'open example' });
    expect(plannerLLMOutputSchema.safeParse({ done: false, macro_objective: 'NAVIGATE' }).success).toBe(false);
  });

  it('normalizes invalid planner contracts into a safe blocked contract', () => {
    const normalized = normalizeNextStepContract(null, {
      goal: 'finish task',
      currentObservation: observation(),
    });

    expect(normalized.mode).toBe('blocked_human_needed');
    expect(normalized.macroObjective).toBe('ASK_HUMAN');
    expect(normalized.expectedObservation.observationId).toBe(observation().id);
  });

  it('builds a next-step contract from the planner output', () => {
    const obs = observation();
    const cleaned = normalizePlannerOutputContract({
      done: false,
      macro_objective: 'NAVIGATE',
      next_goal: 'open example',
      success_condition: 'URL is open',
    } satisfies Record<string, unknown>, { goal: 'open example', currentObservation: obs });

    expect(cleaned.mode).toBe('multi_step_task');
    expect(cleaned.next_step_contract).toMatchObject({
      mode: 'multi_step_task',
      goal: 'open example',
      macroObjective: 'NAVIGATE',
      successCondition: 'URL is open',
      expectedObservation: { observationId: obs.id },
    });
    expect(cleaned.next_step_contract?.id).toMatch(/^contract_/);
  });

  it('returns no contract when the planner reports the task done', () => {
    const cleaned = normalizePlannerOutputContract(
      { done: true, macro_objective: 'VERIFY_STATE', next_goal: '', final_answer: 'Example Domain' },
      { goal: 'read heading', currentObservation: observation() },
    );

    expect(cleaned).toMatchObject({ mode: 'direct_answer', next_step_contract: null, final_answer: 'Example Domain' });
  });
});

describe('P1 replanning and progress', () => {
  const decide = (overrides: Partial<Parameters<typeof getReplanDecision>[0]> = {}) => getReplanDecision({
    planned: true,
    navigatorDone: false,
    navigatorErrored: false,
    waitingForHuman: false,
    unvalidatedSteps: 0,
    stalled: false,
    stepsSinceLastPlan: 1,
    planningInterval: 3,
    ...overrides,
  });

  it('replans for each trigger and keeps the plan otherwise', () => {
    expect(decide({ planned: false })).toMatchObject({ shouldReplan: true, trigger: 'initial' });
    expect(decide({ waitingForHuman: true })).toMatchObject({ shouldReplan: true, trigger: 'human_needed' });
    expect(decide({ navigatorDone: true })).toMatchObject({ shouldReplan: true, trigger: 'contract_complete' });
    expect(decide({ navigatorErrored: true })).toMatchObject({ shouldReplan: true, trigger: 'navigator_error' });
    expect(decide({ unvalidatedSteps: 2 })).toMatchObject({ shouldReplan: true, trigger: 'validation' });
    expect(decide({ stalled: true })).toMatchObject({ shouldReplan: true, trigger: 'progress_stall' });
    expect(decide({ stepsSinceLastPlan: 3 })).toMatchObject({ shouldReplan: true, trigger: 'step_interval' });
    expect(decide()).toMatchObject({ shouldReplan: false, trigger: 'none' });
  });

  it('does not replan after a single unvalidated step', () => {
    expect(decide({ unvalidatedSteps: 1 }).shouldReplan).toBe(false);
  });

  it('applies triggers in precedence order', () => {
    expect(decide({ planned: false, navigatorDone: true, stalled: true }).trigger).toBe('initial');
    expect(decide({ waitingForHuman: true, navigatorDone: true }).trigger).toBe('human_needed');
    expect(decide({ navigatorDone: true, navigatorErrored: true, unvalidatedSteps: 5 }).trigger).toBe('contract_complete');
    expect(decide({ unvalidatedSteps: 2, stalled: true, stepsSinceLastPlan: 9 }).trigger).toBe('validation');
    expect(decide({ stalled: true, stepsSinceLastPlan: 9 }).trigger).toBe('progress_stall');
  });

  it('records validated progress from action evidence', () => {
    const record = ProgressLedger.recordFromActionResult({
      taskId: 'task-1',
      contractId: 'contract-1',
      observationId: 'obs-1',
      actionId: 'action-1',
      actionName: 'click_element',
      result: new ActionResult({
        executed: true,
        validated: 'passed',
        evidence: [{ kind: 'url_change', passed: true, message: 'URL changed' }],
      }),
    });

    expect(record).toMatchObject({
      taskId: 'task-1',
      contractId: 'contract-1',
      observationId: 'obs-1',
      actionId: 'action-1',
      status: 'completed',
    });
    expect(record.summary).toContain('click_element');
  });
});

describe('P1 checkpoints and traces', () => {
  it('saves and restores resumable task checkpoints', async () => {
    const store = new TaskCheckpointStore(new MemoryStorage());
    await store.save({
      taskId: 'task-1',
      task: 'open example',
      status: 'running',
      step: 2,
      currentContract: normalizeNextStepContract(null, { goal: 'open example', currentObservation: observation() }),
      lastObservationId: 'obs-old',
      validatedProgress: [],
      blockedState: null,
      updatedAt: 1000,
    });

    const restored = await store.load('task-1');

    expect(restored?.status).toBe('running');
    expect(restored?.step).toBe(2);
  });

  it('forces replan after restart when the fresh observation differs', () => {
    expect(shouldForceReplanAfterResume({
      checkpointObservationId: 'obs-old',
      currentObservationId: 'obs-new',
    })).toBe(true);
  });

});

describe('P1 context budget and routing', () => {
  it('injects current contract and validated progress into the context packet', () => {
    const ctx = contextStub();
    ctx.currentContract = normalizeNextStepContract(null, {
      goal: 'open example',
      currentObservation: observation(),
    });
    ctx.validatedProgress = [{
      id: 'progress-1',
      taskId: 'task-1',
      contractId: ctx.currentContract.id,
      observationId: 'obs-1',
      actionId: 'action-1',
      summary: 'URL changed',
      status: 'completed',
      evidence: [{ kind: 'url_change', passed: true, message: 'URL changed' }],
      createdAt: 1000,
    }];

    const packet = ContextBuilder.buildContextPacket(
      ctx,
      new SystemMessage('system'),
      new HumanMessage('browser state'),
    );
    const finalMessage = String(packet[packet.length - 1].content);

    expect(packet[0].content).toBe('system');
    expect(finalMessage).toContain('[CURRENT PLAN]');
    expect(finalMessage).toContain('[VALIDATED PROGRESS]');
    expect(finalMessage).toContain('URL changed');
    expect(finalMessage.endsWith('browser state')).toBe(true);
  });

  it('routes only exact URL tasks to a deterministic action; searches go through the planner', () => {
    const urlRoute = ExecutionRouter.routeTask('go to https://example.com/docs');

    expect(urlRoute?.contract.mode).toBe('single_browser_action');
    expect(urlRoute?.actions).toEqual([{ go_to_url: { url: 'https://example.com/docs' } }]);
    expect(ExecutionRouter.routeTask('search google for browser automation reliability')).toBeNull();
  });
});

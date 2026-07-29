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
  ContextBudgetReporter,
  ExecutionRouter,
  ProgressLedger,
  TaskCheckpointStore,
  TraceStore,
  getReplanDecision,
  normalizeNextStepContract,
  normalizePlannerOutputContract,
  shouldForceReplanAfterResume,
} from '..';
import { plannerOutputSchema } from '../../agents/planner';

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
  };
  const eventManager = {
    subscribe: () => undefined,
    clearSubscribers: () => undefined,
    emit: async () => undefined,
  };
  return new AgentContext(
    'task-1',
    {} as BrowserContext,
    messageManager as MessageManager,
    eventManager as unknown as EventManager,
    {},
  );
}

describe('P1 contracts', () => {
  it('planner output schema accepts compact DTO fields and rejects internal contract fields', () => {
    const parsed = plannerOutputSchema.parse({
      observation: 'Need navigation',
      challenges: 'None',
      done: false,
      macro_objective: 'NAVIGATE',
      final_answer: '',
      reasoning: 'Open direct URL',
      web_task: true,
      mode: 'single_browser_action',
      next_goal: 'open example',
      allowed_actions: ['go_to_url'],
      success_condition: 'URL changed',
      failure_signals: ['URL unchanged'],
      target_indexes: [],
    });

    expect(parsed.mode).toBe('single_browser_action');
    expect(parsed.next_goal).toBe('open example');
    expect(() => plannerOutputSchema.parse({
      ...parsed,
      next_step_contract: {
        id: 'contract-schema',
        createdAt: 1000,
      },
    })).toThrow();
  });

  it('planner output schema accepts minimal DTO fields before normalization', () => {
    const parsed = plannerOutputSchema.parse({
      observation: 'Need navigation',
      challenges: 'None',
      done: false,
      macro_objective: 'NAVIGATE',
      final_answer: '',
      reasoning: 'Open direct URL',
      web_task: true,
      mode: 'single_browser_action',
      next_goal: 'open example',
      allowed_actions: ['go_to_url'],
      success_condition: 'URL changed',
      failure_signals: ['URL unchanged'],
      target_indexes: [],
    });

    const cleaned = normalizePlannerOutputContract(parsed, {
      goal: 'open example',
      currentObservation: observation(),
    });

    expect(cleaned.next_step_contract).toMatchObject({
      mode: 'single_browser_action',
      macroObjective: 'NAVIGATE',
      allowedActions: ['go_to_url'],
    });
  });

  it('planner output schema fills safe top-level defaults before normalization', () => {
    const parsed = plannerOutputSchema.parse({
      done: false,
      macro_objective: 'NAVIGATE',
      web_task: true,
    });

    expect(parsed).toMatchObject({
      observation: '',
      challenges: '',
      final_answer: '',
      reasoning: '',
      mode: 'multi_step_task',
      next_goal: '',
      allowed_actions: [],
      success_condition: '',
      failure_signals: [],
      target_indexes: [],
    });
  });

  it('normalizes invalid planner contracts into a safe blocked contract', () => {
    const normalized = normalizeNextStepContract(null, {
      goal: 'finish task',
      currentObservation: observation(),
    });

    expect(normalized.mode).toBe('blocked_human_needed');
    expect(normalized.macroObjective).toBe('ASK_HUMAN');
    expect(normalized.allowedActions).toEqual(['ask_human']);
    expect(normalized.expectedObservation.observationId).toBe(observation().id);
  });

  it('builds a strict next-step contract from compact planner DTO output', () => {
    const obs = observation();
    const cleaned = normalizePlannerOutputContract({
      observation: 'Need to click',
      challenges: 'None',
      done: false,
      macro_objective: 'NAVIGATE',
      final_answer: '',
      reasoning: 'Go there',
      web_task: true,
      mode: 'single_browser_action',
      next_goal: 'open example',
      allowed_actions: ['go_to_url', 'input_text'],
      success_condition: 'URL is open',
      failure_signals: ['URL unchanged'],
      target_indexes: [1, 999],
    } satisfies Record<string, unknown>, { goal: 'open example', currentObservation: obs });

    expect(cleaned.mode).toBe('single_browser_action');
    expect(cleaned.next_step_contract?.id).toMatch(/^contract_/);
    expect(cleaned.next_step_contract?.createdAt).toBeGreaterThan(0);
    expect(cleaned.next_step_contract?.expectedObservation.observationId).toBe(obs.id);
    expect(cleaned.next_step_contract?.expectedObservation.requiredTargetIndexes).toEqual([1]);
    expect(cleaned.next_step_contract?.allowedActions).toEqual(['go_to_url']);
  });
});

describe('P1 replanning and progress', () => {
  it('replans immediately for failed and unknown validation', () => {
    expect(getReplanDecision({
      step: 1,
      navigatorDone: false,
      latestResults: [new ActionResult({ executed: true, validated: 'failed', retryability: 'replan' })],
      stepsSinceLastPlan: 1,
      planningInterval: 3,
      progressStalled: false,
    })).toMatchObject({ shouldReplan: true, trigger: 'validation_failed' });

    expect(getReplanDecision({
      step: 1,
      navigatorDone: false,
      latestResults: [new ActionResult({ executed: true, validated: 'unknown', retryability: 'retry_reobserve' })],
      stepsSinceLastPlan: 1,
      planningInterval: 3,
      progressStalled: false,
    })).toMatchObject({ shouldReplan: true, trigger: 'validation_unknown' });
  });

  it('allows one retry_same attempt before forcing a replan', () => {
    const result = new ActionResult({ executed: true, validated: 'failed', retryability: 'retry_same' });
    const first = getReplanDecision({
      step: 2,
      navigatorDone: false,
      latestResults: [result],
      stepsSinceLastPlan: 1,
      planningInterval: 3,
      progressStalled: false,
      retrySameAttemptsForContract: 0,
    });
    const second = getReplanDecision({
      step: 3,
      navigatorDone: false,
      latestResults: [result],
      stepsSinceLastPlan: 1,
      planningInterval: 3,
      progressStalled: false,
      retrySameAttemptsForContract: 1,
    });

    expect(first.shouldReplan).toBe(false);
    expect(first.reason).toContain('one retry');
    expect(second).toMatchObject({ shouldReplan: true, trigger: 'validation_failed' });
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

  it('stores linked trace events in order', async () => {
    const store = new TraceStore(new MemoryStorage());
    await store.append({ taskId: 'task-1', actor: 'planner', type: 'plan.created', payload: {}, timestamp: 1 });
    await store.append({ taskId: 'task-1', parentId: 'trace-1', actor: 'navigator', type: 'action.started', payload: {}, timestamp: 2 });

    const events = await store.list('task-1');

    expect(events.map(event => event.type)).toEqual(['plan.created', 'action.started']);
    expect(events[1].parentId).toBe('trace-1');
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

    const [system] = ContextBuilder.buildContextPacket(
      ctx,
      new SystemMessage('system'),
      new HumanMessage('browser state'),
    );

    expect(String(system.content)).toContain('<current_contract>');
    expect(String(system.content)).toContain('<validated_progress>');
    expect(String(system.content)).toContain('URL changed');
  });

  it('reports token budget sections for planner and navigator calls', () => {
    const report = ContextBudgetReporter.build({
      taskId: 'task-1',
      callId: 'call-1',
      actor: 'navigator',
      outputTokens: 12,
      sections: {
        systemPrompt: 'system words',
        structuredMemory: 'memory words',
        currentContract: 'contract words',
        validatedProgress: 'progress words',
        compactBrowserState: 'browser words',
        interactiveElements: 'element words',
        screenshots: '',
      },
    });

    expect(report.sections.map(section => section.name)).toEqual([
      'system prompt',
      'structured memory',
      'current contract',
      'validated progress',
      'compact browser state',
      'interactive elements',
      'screenshots',
    ]);
    expect(report.totalEstimatedInputTokens).toBeGreaterThan(0);
  });

  it('routes exact URL/search tasks to a deterministic single action without planner interpretation', () => {
    const urlRoute = ExecutionRouter.routeTask('go to https://example.com/docs');
    const searchRoute = ExecutionRouter.routeTask('search google for browser automation reliability');

    expect(urlRoute?.contract.mode).toBe('single_browser_action');
    expect(urlRoute?.actions).toEqual([{ go_to_url: { url: 'https://example.com/docs' } }]);
    expect(searchRoute?.actions[0]).toHaveProperty('search_web');
  });
});

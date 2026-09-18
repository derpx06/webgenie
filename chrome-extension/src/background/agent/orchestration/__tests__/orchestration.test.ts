import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { MemoryStorage, stubChrome } from '../../__tests__/fakes';
import { Blackboard } from '../blackboard';
import { briefFor } from '../brief';
import { RunCheckpointStore, isRunResumable } from '../checkpoint';
import {
  DEFAULT_NODE_BUDGET,
  blockedNodes,
  initialStates,
  isSingleNode,
  readyNodes,
  singleNodeDag,
  topologicalOrder,
  validateDag,
} from '../dag';
import { dagFromParts, decomposeTask, MAX_PLAN_NODES } from '../decompose';
import { CostGovernor } from '../governor';
import { resolveConcurrency, runSupervised } from '../pool';
import { Supervisor } from '../supervisor';
import { verifyRun } from '../verifier';
import type { NodeResult, NodeState, PlanDag, PlanNode, WorkerBrief } from '../types';

beforeEach(() => {
  stubChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const node = (id: string, over: Partial<PlanNode> = {}): PlanNode => ({
  id,
  goal: `do ${id}`,
  mode: 'parallel-safe',
  dependsOn: [],
  successCriteria: `${id} is done`,
  budget: { ...DEFAULT_NODE_BUDGET },
  ...over,
});

const dagOf = (nodes: PlanNode[], task = 'the task'): PlanDag => ({
  runId: 'run-1',
  task,
  nodes,
  budgetTokens: 1_000_000,
});

const states = (dag: PlanDag, over: Record<string, Partial<NodeState>> = {}): Record<string, NodeState> => {
  const all = initialStates(dag);
  for (const [id, patch] of Object.entries(over)) all[id] = { ...all[id], ...patch };
  return all;
};

describe('plan DAG', () => {
  it('runs an ordinary task as one node carrying the task text unchanged', () => {
    const dag = singleNodeDag('run-1', 'Book a table for two');

    expect(isSingleNode(dag)).toBe(true);
    expect(validateDag(dag)).toEqual([]);
    expect(dag.nodes[0]).toMatchObject({ goal: 'Book a table for two', dependsOn: [] });
    expect(readyNodes(dag, states(dag), 4, 0).map(n => n.id)).toEqual(['main']);
  });

  it('names unknown dependencies, duplicates, self-references and cycles', () => {
    expect(validateDag(dagOf([node('a', { dependsOn: ['ghost'] })]))).toEqual([
      'node a depends on unknown node ghost',
    ]);
    expect(validateDag(dagOf([node('a'), node('a')]))).toContain('duplicate node id a');
    expect(validateDag(dagOf([node('a', { dependsOn: ['a'] })]))).toContain('node a depends on itself');
    expect(validateDag(dagOf([node('a', { dependsOn: ['b'] }), node('b', { dependsOn: ['a'] })]))).toContain(
      'dependency cycle between a, b',
    );
    expect(validateDag(dagOf([]))).toContain('the plan has no nodes');
  });

  it('dispatches the parallel-safe nodes together and holds a node until its dependency is done', () => {
    const dag = dagOf([node('a'), node('b'), node('c'), node('d'), node('e', { dependsOn: ['a', 'b', 'c', 'd'] })]);

    expect(readyNodes(dag, states(dag), 4, 0).map(n => n.id)).toEqual(['a', 'b', 'c', 'd']);
    // Three slots means three workers, not four.
    expect(readyNodes(dag, states(dag), 3, 0)).toHaveLength(3);

    const nearlyDone = states(dag, {
      a: { status: 'done' },
      b: { status: 'done' },
      c: { status: 'done' },
      d: { status: 'running' },
    });
    expect(readyNodes(dag, nearlyDone, 4, 1)).toEqual([]);
    nearlyDone.d.status = 'done';
    expect(readyNodes(dag, nearlyDone, 4, 0).map(n => n.id)).toEqual(['e']);
  });

  it('gives a serial node the browser to itself', () => {
    const dag = dagOf([node('a'), node('s', { mode: 'serial' })]);

    // Nothing else goes out while the serial node waits, and it waits for the running workers to end.
    expect(readyNodes(dag, states(dag), 4, 1)).toEqual([]);
    expect(readyNodes(dag, states(dag), 4, 0).map(n => n.id)).toEqual(['s']);
  });

  it('finds what a failed node makes unrunnable, and orders nodes after their dependencies', () => {
    const dag = dagOf([node('a'), node('b', { dependsOn: ['a'] }), node('c', { dependsOn: ['b'] }), node('d')]);

    expect(blockedNodes(dag, states(dag, { a: { status: 'failed' } })).map(n => n.id)).toEqual(['b', 'c']);
    expect(blockedNodes(dag, states(dag))).toEqual([]);
    expect(topologicalOrder(dag).map(n => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('blackboard', () => {
  it('gives an address to one worker and tells the next one it is taken', async () => {
    const board = new Blackboard('run-1', new MemoryStorage());

    expect(await board.claim('https://example.test/list?page=1', 'a')).toBe(true);
    // The same page with another fragment is the same page.
    expect(await board.claim('https://example.test/list?page=1#results', 'b')).toBe(false);
    // The node that holds it may take it again: a retry is never blocked by its own first attempt.
    expect(await board.claim('https://example.test/list?page=1', 'a')).toBe(true);
    expect(await board.claim('https://example.test/list?page=2', 'b')).toBe(true);
    expect(board.owner('https://example.test/list?page=1')).toBe('a');
    expect(board.entries().filter(entry => entry.kind === 'url')).toHaveLength(2);
  });

  it('is append-only and comes back from storage as it was', async () => {
    const storage = new MemoryStorage();
    const board = new Blackboard('run-1', storage);
    await board.append('fact', 'a', 'the price is 42');
    await board.claim('https://example.test/', 'a');
    await board.append('failure', 'b', 'https://blocked.test/', 'the site refused');

    const restored = await Blackboard.load('run-1', storage);
    expect(restored.entries().map(entry => entry.seq)).toEqual([0, 1, 2]);
    expect(restored.facts(['a'])).toHaveLength(1);
    expect(restored.facts(['b'])).toEqual([]);
    expect(restored.failures()).toHaveLength(1);
    expect(restored.evidence()).toContain('the price is 42');
    expect(restored.render(500)).toContain('https://blocked.test/');
  });

  it('leaves a worker its own reads out of the taken list', async () => {
    const board = new Blackboard('run-1', new MemoryStorage());
    await board.claim('https://a.test/', 'a');
    await board.claim('https://b.test/', 'b');

    expect(board.render(500, 'a')).toContain('https://b.test/');
    expect(board.render(500, 'a')).not.toContain('https://a.test/');
  });
});

describe('worker brief', () => {
  const policy = { level: 0 as const, screenshots: true, concurrency: 4, model: 'default' as const, exhausted: false };

  it('sends an ordinary task exactly as the user wrote it', async () => {
    const dag = singleNodeDag('run-1', 'Find the cheapest flight');
    const brief = briefFor({ dag, node: dag.nodes[0], blackboard: new Blackboard('run-1', new MemoryStorage()), policy });

    expect(brief.task).toBe('Find the cheapest flight');
  });

  it('gives a worker its part, its dependencies answers and the pages already read, and nothing else', async () => {
    const dag = dagOf([node('a'), node('b'), node('c', { dependsOn: ['a'] })], 'compare two shops');
    const board = new Blackboard('run-1', new MemoryStorage());
    await board.append('fact', 'a', 'shop A charges 10');
    await board.append('fact', 'b', 'shop B charges 12');
    await board.claim('https://b.test/prices', 'b');

    const brief = briefFor({ dag, node: dag.nodes[2], blackboard: board, policy });

    expect(brief.task.split('\n')[0]).toBe('do c');
    expect(brief.task).toContain('shop A charges 10');
    // b is not a dependency of c: its answer is none of c's business.
    expect(brief.task).not.toContain('shop B charges 12');
    expect(brief.task).toContain('https://b.test/prices');
    // Not the whole job: the executor's completion checks read the task text as what this answer must cover.
    expect(brief.task).not.toContain('compare two shops');
  });

  it('follows the governor: no screenshots and the cheap model once the budget is low', async () => {
    const dag = dagOf([node('a'), node('b')]);
    const brief = briefFor({
      dag,
      node: dag.nodes[0],
      blackboard: new Blackboard('run-1', new MemoryStorage()),
      policy: { level: 3, screenshots: false, concurrency: 1, model: 'cheap', exhausted: false },
    });

    expect(brief.useVision).toBe(false);
    expect(brief.model).toBe('cheap');
  });
});

describe('cost governor', () => {
  it('counts uncached input only', () => {
    const governor = new CostGovernor(1_000, 4);
    governor.spend(400, 300);

    expect(governor.spentTokens).toBe(100);
    expect(governor.remaining()).toBe(900);
  });

  it('degrades in order: screenshots, then concurrency, then the model', () => {
    const seen: number[] = [];
    const governor = new CostGovernor(1_000, 4, policy => seen.push(policy.level));

    expect(governor.policy()).toMatchObject({ level: 0, screenshots: true, concurrency: 4, model: 'default' });
    governor.spend(600);
    expect(governor.policy()).toMatchObject({ level: 1, screenshots: false, concurrency: 4, model: 'default' });
    governor.spend(200);
    expect(governor.policy()).toMatchObject({ level: 2, screenshots: false, concurrency: 1, model: 'default' });
    governor.spend(150);
    expect(governor.policy()).toMatchObject({ level: 3, screenshots: false, concurrency: 1, model: 'cheap' });
    // Spent out, but still not a failure: what runs finishes, nothing new is dispatched.
    governor.spend(100);
    expect(governor.policy().exhausted).toBe(true);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('never lets a node spend more than the run has left', () => {
    const governor = new CostGovernor(1_000, 2);
    governor.spend(900);

    expect(governor.allowanceFor(500)).toBe(100);
  });
});

describe('supervisor', () => {
  it('kills a worker that stopped making progress', () => {
    let now = 1_000;
    const supervisor = new Supervisor({ stuckMs: 500 }, () => now);
    supervisor.started('a');

    expect(supervisor.killReason('a', 10_000)).toBeNull();
    now += 499;
    expect(supervisor.killReason('a', 10_000)).toBeNull();
    now += 1;
    expect(supervisor.killReason('a', 10_000)).toBe('stuck');
    supervisor.progress('a', 'clicked next');
    expect(supervisor.killReason('a', 10_000)).toBeNull();
  });

  it('kills a worker doing the same thing over and over, and one over its budget', () => {
    const supervisor = new Supervisor({ loopThreshold: 3 }, () => 0);
    supervisor.started('a');
    supervisor.progress('a', 'scrolled');
    supervisor.progress('a', 'scrolled');
    expect(supervisor.killReason('a', 10_000)).toBeNull();
    supervisor.progress('a', 'scrolled');
    expect(supervisor.killReason('a', 10_000)).toBe('looping');

    supervisor.started('b');
    supervisor.progress('b', 'read a page', 12_000);
    expect(supervisor.killReason('b', 10_000)).toBe('over_budget');
  });

  it('retries with growing backoff, escalates, then gives up, recording every reason', () => {
    const supervisor = new Supervisor({ maxAttempts: 3, escalateAfter: 2, backoffMs: 1_000, maxBackoffMs: 3_000 }, () => 0);

    expect(supervisor.decide('a', 1, 'stuck')).toMatchObject({ action: 'retry', afterMs: 1_000, escalate: false });
    expect(supervisor.decide('a', 2, 'stuck')).toMatchObject({ action: 'retry', afterMs: 2_000, escalate: true });
    expect(supervisor.decide('a', 3, 'stuck')).toMatchObject({ action: 'give_up' });
    expect(supervisor.canRetry(2)).toBe(true);
    expect(supervisor.canRetry(3)).toBe(false);
    expect(supervisor.notes('a')).toHaveLength(3);
    expect(supervisor.notes('a')[1]).toContain('stronger model');
  });
});

describe('worker pool', () => {
  const brief: WorkerBrief = {
    runId: 'run-1',
    nodeId: 'a',
    task: 'do a',
    goal: 'do a',
    successCriteria: 'a is done',
    maxSteps: 10,
    useVision: false,
    model: 'default',
  };
  const answer: NodeResult = { ok: true, answer: '42', tokens: 100 };

  it('never asks for more workers than the machine can hold', () => {
    vi.stubGlobal('navigator', { deviceMemory: 4, hardwareConcurrency: 16 });
    expect(resolveConcurrency(8)).toBe(2);
    vi.stubGlobal('navigator', { deviceMemory: 64, hardwareConcurrency: 4 });
    expect(resolveConcurrency(8)).toBe(2);
    vi.stubGlobal('navigator', { deviceMemory: 64, hardwareConcurrency: 64 });
    expect(resolveConcurrency(3)).toBe(3);
    expect(resolveConcurrency(0)).toBe(1);
  });

  it('passes a finished worker through and reports the supervisor kill on a stuck one', async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new Supervisor({ stuckMs: 1_000 }, () => Date.now());
      const good = await runSupervised(async () => answer, brief, supervisor, 10_000, { pollMs: 100 });
      expect(good).toEqual({ result: answer });

      let aborted = false;
      const hang = runSupervised(
        (_brief, control) =>
          new Promise<NodeResult>(() => {
            control.signal.addEventListener('abort', () => (aborted = true));
          }),
        brief,
        supervisor,
        10_000,
        { pollMs: 100 },
      );
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await hang).toEqual({ killed: 'stuck' });
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a worker that threw and one the run stopped', async () => {
    const supervisor = new Supervisor({}, () => Date.now());
    const threw = await runSupervised(async () => {
      throw new Error('the tab closed');
    }, brief, supervisor, 10_000, { pollMs: 50 });
    expect(threw.error).toBe('the tab closed');

    const stopping = new AbortController();
    const stopped = runSupervised(
      (_brief, control) => new Promise<NodeResult>((_resolve, reject) => control.signal.addEventListener('abort', () => reject(new Error('aborted')))),
      brief,
      supervisor,
      10_000,
      { pollMs: 50, signal: stopping.signal },
    );
    stopping.abort();
    expect(await stopped).toEqual({ error: 'the run was stopped' });
  });
});

describe('verifier', () => {
  const claims = [
    { nodeId: 'a', text: 'shop A charges 10' },
    { nodeId: 'b', text: 'shop B charges 12' },
  ];

  it('checks the claims against the evidence in a call of its own', async () => {
    let prompt = '';
    const report = await verifyRun({
      task: 'compare the shops',
      claims,
      evidence: '- [a] fact: shop A charges 10\n- [b] fact: shop B charges 12',
      ask: async text => {
        prompt = text;
        return '{"verdicts":[{"nodeId":"a","holds":true,"reason":"in the evidence"},{"nodeId":"b","holds":true,"reason":"in the evidence"}]}';
      },
    });

    expect(report.passed).toBe(true);
    expect(report.redispatch).toEqual([]);
    // The check sees the claims and the evidence, and nothing of the conversation that produced them.
    expect(prompt).toContain('shop A charges 10');
    expect(prompt).toContain('You did not do it');
  });

  it('re-dispatches the worker whose claim the evidence does not carry', async () => {
    const report = await verifyRun({
      task: 'compare the shops',
      claims,
      evidence: '- [a] fact: shop A charges 10',
      ask: async () =>
        'Here you go: {"verdicts":[{"nodeId":"a","holds":true,"reason":"shown"},{"nodeId":"b","holds":false,"reason":"nothing in the evidence shows shop B"}]}',
    });

    expect(report.passed).toBe(false);
    expect(report.redispatch).toEqual(['b']);
  });

  it('refuses a failed node\'s claim without asking, and stays inconclusive when the check cannot be made', async () => {
    const failed = await verifyRun({ task: 't', claims, evidence: '', ask: async () => '{"verdicts":[]}', failedNodes: ['b'] });
    expect(failed.verdicts.find(verdict => verdict.nodeId === 'b')).toMatchObject({ holds: false });
    expect(failed.redispatch).toContain('b');

    const broken = await verifyRun({
      task: 't',
      claims,
      evidence: 'some evidence',
      ask: async () => {
        throw new Error('the provider is down');
      },
    });
    expect(broken).toMatchObject({ inconclusive: true, passed: false, redispatch: [] });

    const garbage = await verifyRun({ task: 't', claims, evidence: 'e', ask: async () => 'I think it is all fine' });
    expect(garbage.inconclusive).toBe(true);
  });

  it('marks a claim the check skipped as not holding', async () => {
    const report = await verifyRun({
      task: 't',
      claims,
      evidence: 'e',
      ask: async () => '{"verdicts":[{"nodeId":"a","holds":true,"reason":"shown"}]}',
    });

    expect(report.verdicts.find(verdict => verdict.nodeId === 'b')).toMatchObject({ holds: false });
  });
});

describe('decomposition', () => {
  it('builds a plan from the model\'s parts', () => {
    const dag = dagFromParts('run-1', 'compare two shops', [
      { id: 'a', goal: 'read shop A', mode: 'parallel-safe', dependsOn: [], successCriteria: 'the price is read', steps: 10 },
      { id: 'b', goal: 'read shop B', mode: 'parallel-safe', dependsOn: [] },
      { id: 'c', goal: 'compare', mode: 'serial', dependsOn: ['a', 'b'] },
    ]);

    expect(dag).not.toBeNull();
    expect(dag!.nodes.map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(dag!.nodes[0].budget.steps).toBe(10);
    expect(dag!.nodes[2].mode).toBe('serial');
    // No part may spend the whole run's budget.
    expect(dag!.nodes[0].budget.tokens).toBe(Math.floor(dag!.budgetTokens / 3));
  });

  it('refuses a plan it cannot run', () => {
    expect(dagFromParts('run-1', 't', [{ id: 'a', goal: 'x', dependsOn: ['ghost'] }])).toBeNull();
    expect(dagFromParts('run-1', 't', [{ id: 'a', goal: '' }])).toBeNull();
    expect(dagFromParts('run-1', 't', [])).toBeNull();
    expect(dagFromParts('run-1', 't', Array.from({ length: MAX_PLAN_NODES + 1 }, (_, i) => ({ id: `n${i}`, goal: 'x' })))).toBeNull();
  });

  it('falls back to the ordinary single-node task whenever the split is unusable', async () => {
    const asked: string[] = [];
    const bad = await decomposeTask({ runId: 'run-1', task: 'Book a table', ask: async prompt => (asked.push(prompt), 'no idea') });
    expect(isSingleNode(bad)).toBe(true);
    expect(bad.nodes[0].goal).toBe('Book a table');
    expect(asked[0]).toContain('Book a table');

    const failed = await decomposeTask({
      runId: 'run-1',
      task: 'Book a table',
      ask: async () => {
        throw new Error('the provider is down');
      },
    });
    expect(isSingleNode(failed)).toBe(true);

    const split = await decomposeTask({
      runId: 'run-1',
      task: 'compare two shops',
      ask: async () => '{"parts":[{"id":"a","goal":"read A"},{"id":"b","goal":"read B"}]}',
    });
    expect(split.nodes).toHaveLength(2);
  });
});

describe('run checkpoint', () => {
  it('saves, loads and clears a run, and knows which one can be picked up', async () => {
    const storage = new MemoryStorage();
    const store = new RunCheckpointStore(storage);
    const dag = dagOf([node('a')]);
    await store.save({ runId: 'run-1', task: 't', dag, nodes: initialStates(dag), spentTokens: 10, status: 'running', updatedAt: 0 });

    const loaded = await store.load('run-1');
    expect(loaded).toMatchObject({ runId: 'run-1', spentTokens: 10 });
    expect(loaded!.updatedAt).toBeGreaterThan(0);
    expect(isRunResumable(loaded)).toBe(true);
    expect(isRunResumable({ ...loaded!, status: 'completed' })).toBe(false);
    expect(isRunResumable(null)).toBe(false);

    await store.clear('run-1');
    expect(await store.load('run-1')).toBeNull();
  });
});

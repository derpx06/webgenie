/**
 * The orchestration gate: a real plan with four workers side by side and a node that waits for all four, each worker a
 * real `Executor` with a real planner/navigator loop, on the scripted model and browser from `agent/__tests__/fakes.ts`.
 * One worker hangs and is killed by the supervisor; the run is then stopped mid-flight the way a dying service worker
 * stops it, resumed from its checkpoint, and the claims are checked by a separate call at the end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import {
  FakeBrowserContext,
  FakeChatModel,
  MemoryStorage,
  done,
  plan,
  planDone,
  settle,
  stubChrome,
  until,
} from '../../__tests__/fakes';
import type { Script } from '../../__tests__/fakes';
import { TaskCheckpointStore } from '../../contracts';
import { Executor } from '../../executor';
import { Orchestrator } from '../orchestrator';
import { createWorkerRunner, workerTaskId } from '../worker';
import type { NodeRunner, OrchestrationEvent, PlanDag, PlanNode, WorkerBrief } from '../types';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
  // The pool caps concurrency by the machine; a test decides the machine.
  vi.stubGlobal('navigator', { deviceMemory: 32, hardwareConcurrency: 32 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const parallel = (id: string, deps: string[] = []): PlanNode => ({
  id,
  goal: `read ${id}`,
  mode: 'parallel-safe',
  dependsOn: deps,
  successCriteria: `${id} is read`,
  budget: { steps: 10, tokens: 200_000 },
});

/** Four independent reads and one node that needs all four. */
function fanInDag(): PlanDag {
  return {
    runId: 'run-fan-in',
    task: 'Read four pages and report the four values together',
    budgetTokens: 1_000_000,
    nodes: [parallel('a'), parallel('b'), parallel('c'), parallel('d'), parallel('e', ['a', 'b', 'c', 'd'])],
  };
}

interface WorkerScript {
  planner: Script[];
  navigator: Script[];
}

/** A worker that reads one page and answers; the page holds the value the answer must rest on. */
const readsAndAnswers = (id: string, value: string): WorkerScript => ({
  planner: [plan({ macro_objective: 'EXTRACT_DATA', next_goal: `Read ${id}` }), planDone()],
  navigator: [done(value)],
});

/** A worker whose model call never comes back: the supervisor's stuck worker. */
const hangs = (): WorkerScript => ({
  planner: [() => new Promise(() => {})],
  navigator: [],
});

/** Remembers every key ever written: a worker's own checkpoint is deleted when its task ends. */
class LoggingStorage extends MemoryStorage {
  readonly written = new Set<string>();
  override async set<T>(key: string, value: T): Promise<void> {
    this.written.add(key);
    return super.set(key, value);
  }
}

function harness() {
  const storage = new LoggingStorage();
  const scripts: Record<string, WorkerScript> = {};
  const starts: Record<string, number> = {};
  const briefs: WorkerBrief[] = [];
  const closed: string[] = [];
  const tabs: Record<string, number> = {};
  let live = 0;
  let maxLive = 0;
  let nextTab = 100;

  const base = createWorkerRunner({
    openWorkspace: async brief => {
      const tabId = nextTab++;
      tabs[brief.nodeId] = tabId;
      const browser = new FakeBrowserContext([
        { url: `https://${brief.nodeId}.test/`, title: brief.nodeId, text: [`value of ${brief.nodeId}`] },
      ]);
      return {
        browserContext: browser.asBrowserContext(),
        tabId,
        close: async () => {
          closed.push(brief.nodeId);
        },
      };
    },
    createExecutor: async ({ taskId, brief, workspace }) => {
      const script = scripts[brief.nodeId];
      const llm = new FakeChatModel({ planner: script.planner, navigator: script.navigator });
      const executor = new Executor(brief.task, taskId, workspace.browserContext, llm.asChatModel(), {
        agentOptions: { maxSteps: brief.maxSteps, useVision: brief.useVision },
      });
      // Each worker's step checkpoint is keyed by its own task id: `<runId>:<nodeId>`.
      executor.getContext().checkpointStore = new TaskCheckpointStore(storage);
      return executor;
    },
  });

  const runner: NodeRunner = async (brief, control) => {
    starts[brief.nodeId] = (starts[brief.nodeId] ?? 0) + 1;
    briefs.push(brief);
    live += 1;
    maxLive = Math.max(maxLive, live);
    try {
      return await base(brief, control);
    } finally {
      live -= 1;
    }
  };

  const events: OrchestrationEvent[] = [];
  const asked: string[] = [];
  const ask = async (prompt: string) => {
    asked.push(prompt);
    const ids = [...prompt.matchAll(/^- ([a-z]): /gm)].map(match => match[1]);
    return JSON.stringify({
      verdicts: ids.map(id => ({ nodeId: id, holds: true, reason: `the evidence shows ${id}` })),
    });
  };

  const orchestrator = (overrides: Partial<ConstructorParameters<typeof Orchestrator>[0]> = {}) =>
    new Orchestrator({
      runner,
      storage,
      ask,
      concurrency: 4,
      pollMs: 100,
      limits: { stuckMs: 3_000, maxAttempts: 4 },
      // The backoff itself is the supervisor's unit test; here a retry must not stall the fake clock.
      sleep: async () => {},
      onEvent: event => events.push(event),
      ...overrides,
    });

  return { storage, scripts, starts, briefs, closed, tabs, events, asked, runner, orchestrator, maxLive: () => maxLive };
}

describe('Orchestrator', () => {
  it('runs four workers side by side, kills the stuck one, resumes from the checkpoint and passes the verifier', async () => {
    const h = harness();
    const dag = fanInDag();
    for (const id of ['a', 'b', 'd']) h.scripts[id] = readsAndAnswers(id, `value of ${id}`);
    h.scripts.c = hangs();
    h.scripts.e = readsAndAnswers('e', 'value of a, value of b, value of c, value of d');

    const first = h.orchestrator();
    const run = first.run(dag);

    // c's model call never returns; the supervisor notices and kills the worker.
    await until(() => h.events.some(event => event.kind === 'node.killed' && event.nodeId === 'c'));
    expect(h.maxLive()).toBeGreaterThanOrEqual(4);

    // The service worker dies here: what is finished is finished, what was running was not.
    first.stop();
    const stopped = await settle(run);
    expect(stopped.status).toBe('stopped');
    expect(stopped.nodes.a.status).toBe('done');
    expect(stopped.nodes.b.status).toBe('done');
    expect(stopped.nodes.d.status).toBe('done');
    expect(stopped.nodes.c.status).toBe('pending');
    expect(stopped.nodes.c.notes.join(' ')).toContain('stuck');
    expect(stopped.nodes.e.status).toBe('pending');

    // The worker that hung comes back healthy.
    h.scripts.c = readsAndAnswers('c', 'value of c');

    const second = h.orchestrator();
    const outcome = await settle(second.resume(dag.runId));

    expect(outcome.status).toBe('completed');
    expect(Object.values(outcome.nodes).map(state => state.status)).toEqual(['done', 'done', 'done', 'done', 'done']);
    // No finished subtask was lost or paid for twice.
    expect(h.starts.a).toBe(1);
    expect(h.starts.b).toBe(1);
    expect(h.starts.d).toBe(1);
    expect(outcome.nodes.a.answer).toBe('value of a');

    // The node with the dependency edge ran last, and was told what the four before it found.
    const eBrief = h.briefs.find(brief => brief.nodeId === 'e')!;
    expect(eBrief.task).toContain('value of a');
    expect(eBrief.task.split('\n')[0]).toBe('read e');
    // It was told what the others found, never told to do their parts.
    expect(eBrief.task).not.toContain('Read four pages and report');

    // Each worker had its own tab and its own storage namespace.
    expect(new Set(Object.values(h.tabs)).size).toBe(5);
    expect(workerTaskId(eBrief)).toBe('run-fan-in:e');
    // Each worker checkpointed under its own key; the run has one of its own.
    expect([...h.storage.written]).toEqual(
      expect.arrayContaining([
        'agent:checkpoint:run-fan-in:a',
        'agent:checkpoint:run-fan-in:e',
        'orchestration:run:run-fan-in',
        'orchestration:blackboard:run-fan-in',
      ]),
    );
    expect(h.closed).toContain('c');

    // The check is its own call, made after the run, over the blackboard's evidence.
    expect(outcome.verification?.passed).toBe(true);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toContain('value of a');
    expect(h.asked[0]).toContain('You did not do it');
    expect(outcome.answer).toContain('value of c');
  }, 60_000);

  it('re-dispatches the worker whose claim the verifier refuses', async () => {
    const h = harness();
    const dag: PlanDag = {
      runId: 'run-verify',
      task: 'Read two pages',
      budgetTokens: 1_000_000,
      nodes: [parallel('a'), parallel('b')],
    };
    h.scripts.a = readsAndAnswers('a', 'value of a');
    h.scripts.b = readsAndAnswers('b', 'a guess with nothing behind it');

    let round = 0;
    const orchestrator = h.orchestrator({
      concurrency: 2,
      ask: async () => {
        round += 1;
        // The first check refuses b; after it runs again with an answer that is in the evidence, it holds.
        return JSON.stringify({
          verdicts: [
            { nodeId: 'a', holds: true, reason: 'shown' },
            { nodeId: 'b', holds: round > 1, reason: round > 1 ? 'shown' : 'nothing in the evidence shows it' },
          ],
        });
      },
    });

    h.scripts.b = readsAndAnswers('b', 'value of b');
    const outcome = await settle(orchestrator.run(dag));

    expect(round).toBe(2);
    expect(h.starts.b).toBe(2);
    expect(h.starts.a).toBe(1);
    expect(outcome.verification?.passed).toBe(true);
    expect(outcome.status).toBe('completed');
  }, 60_000);

  it('runs a one-node plan exactly as an ordinary task, with no extra call', async () => {
    const h = harness();
    const dag: PlanDag = {
      runId: 'run-single',
      task: 'What does the page say the answer is?',
      budgetTokens: 1_000_000,
      nodes: [
        {
          id: 'main',
          goal: 'What does the page say the answer is?',
          mode: 'serial',
          dependsOn: [],
          successCriteria: 'answered',
          budget: { steps: 10, tokens: 500_000 },
        },
      ],
    };
    h.scripts.main = readsAndAnswers('main', 'value of main');

    const outcome = await settle(h.orchestrator().run(dag));

    expect(outcome.status).toBe('completed');
    // The worker got the user's words, not a brief; and nothing verified it, as today.
    expect(h.briefs[0].task).toBe('What does the page say the answer is?');
    expect(h.asked).toHaveLength(0);
    expect(outcome.answer).toBe('value of main');
  }, 60_000);

  it('skips what a failed part makes impossible instead of hanging on it', async () => {
    const h = harness();
    const dag: PlanDag = {
      runId: 'run-blocked',
      task: 'Read a page and then use it',
      budgetTokens: 1_000_000,
      nodes: [parallel('a'), parallel('b', ['a'])],
    };
    h.scripts.a = { planner: [() => new Error('the provider refused')], navigator: [] };
    h.scripts.b = readsAndAnswers('b', 'value of b');

    const outcome = await settle(h.orchestrator().run(dag));

    expect(outcome.status).toBe('failed');
    expect(outcome.nodes.a.status).toBe('failed');
    expect(outcome.nodes.a.attempts).toBe(4);
    expect(outcome.nodes.b.status).toBe('skipped');
    expect(outcome.nodes.b.notes.join(' ')).toContain('depends on');
    expect(h.starts.b ?? 0).toBe(0);
  }, 60_000);
});

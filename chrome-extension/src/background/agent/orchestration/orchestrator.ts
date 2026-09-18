/**
 * Runs a plan: dispatches what is ready, supervises what is running, writes the blackboard and a checkpoint after
 * every node, spends one budget across all workers, and has an independent pass re-check the claims at the end.
 *
 * A one-node plan takes the same path with nothing added: one worker, the user's task text, no blackboard context, no
 * verification call unless one is asked for. Everything below only starts to matter once a plan has parts.
 */
import { createLogger } from '@src/background/log';
import { record } from '@src/background/trace';
import type { KeyValueStorage } from '../contracts/checkpoint';
import { Blackboard } from './blackboard';
import { briefFor } from './brief';
import { RunCheckpointStore } from './checkpoint';
import { blockedNodes, initialStates, isSingleNode, readyNodes, topologicalOrder, validateDag } from './dag';
import { CostGovernor } from './governor';
import { resolveConcurrency, runSupervised } from './pool';
import { Supervisor, type SupervisorLimits } from './supervisor';
import { verifyRun } from './verifier';
import type {
  AskFn,
  Claim,
  NodeRunner,
  NodeState,
  OrchestrationEvent,
  PlanDag,
  PlanNode,
  RunCheckpoint,
  RunOutcome,
  VerificationReport,
} from './types';

const logger = createLogger('Orchestrator');

export interface OrchestratorDeps {
  runner: NodeRunner;
  storage: KeyValueStorage;
  /** The verifier's model call; without one a run is not verified. Never a worker's own call. */
  ask?: AskFn;
  concurrency?: number;
  limits?: Partial<SupervisorLimits>;
  now?: () => number;
  /** How often a running worker is checked for being stuck, looping or over budget. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: OrchestrationEvent) => void;
  /** Verify a single-node plan too; off by default so an ordinary task costs exactly what it costs today. */
  verifySingleNode?: boolean;
  /** Verification rounds, each of which may re-dispatch the workers whose claim did not hold. */
  maxVerifyRounds?: number;
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class Orchestrator {
  private readonly checkpoints: RunCheckpointStore;
  private readonly supervisor: Supervisor;
  private readonly now: () => number;
  private stopping = new AbortController();

  constructor(private readonly deps: OrchestratorDeps) {
    this.checkpoints = new RunCheckpointStore(deps.storage);
    this.now = deps.now ?? Date.now;
    this.supervisor = new Supervisor(deps.limits, this.now);
  }

  /** Stops dispatching and aborts the running workers; what is finished stays finished and stays checkpointed. */
  stop(): void {
    this.stopping.abort();
  }

  async run(dag: PlanDag): Promise<RunOutcome> {
    const problems = validateDag(dag);
    if (problems.length > 0) throw new Error(`the plan cannot run: ${problems.join('; ')}`);
    const blackboard = new Blackboard(dag.runId, this.deps.storage, this.now);
    return this.drive(dag, initialStates(dag), blackboard, 0);
  }

  /**
   * Picks a run up where it stopped: the plan, the blackboard and every finished subtask come back from the
   * checkpoint, and only what was still running or still pending runs again. The browser state comes back the way a
   * single task's does — each worker restores its own tab and its own step checkpoint (`contracts/checkpoint.ts`).
   */
  async resume(runId: string): Promise<RunOutcome> {
    const checkpoint = await this.checkpoints.load(runId);
    if (!checkpoint) throw new Error(`no checkpoint for run ${runId}`);
    const states = checkpoint.nodes;
    for (const state of Object.values(states)) {
      // A worker that was running when the worker died did not finish; its node is pending again.
      if (state.status === 'running') state.status = 'pending';
    }
    const blackboard = await Blackboard.load(runId, this.deps.storage, this.now);
    this.stopping = new AbortController();
    return this.drive(checkpoint.dag, states, blackboard, checkpoint.spentTokens);
  }

  private async drive(
    dag: PlanDag,
    states: Record<string, NodeState>,
    blackboard: Blackboard,
    alreadySpent: number,
  ): Promise<RunOutcome> {
    const baseConcurrency = resolveConcurrency(this.deps.concurrency ?? 3);
    const governor = new CostGovernor(dag.budgetTokens, baseConcurrency, policy =>
      this.emit({ kind: 'degrade', runId: dag.runId, detail: `level ${policy.level}: ${JSON.stringify(policy)}` }),
    );
    governor.spend(alreadySpent);
    const byId = new Map(dag.nodes.map(node => [node.id, node]));
    const running = new Map<string, Promise<void>>();
    const sleep = this.deps.sleep ?? wait;
    this.emit({ kind: 'run.start', runId: dag.runId, detail: `${dag.nodes.length} nodes, concurrency ${baseConcurrency}` });

    const save = (status: RunCheckpoint['status'], verification?: VerificationReport) =>
      this.checkpoints.save({
        runId: dag.runId,
        task: dag.task,
        dag,
        nodes: states,
        spentTokens: governor.spentTokens,
        status,
        verification,
        updatedAt: this.now(),
      });

    const attempt = async (node: PlanNode): Promise<void> => {
      const state = states[node.id];
      state.status = 'running';
      state.attempts += 1;
      const policy = governor.policy();
      const brief = briefFor({
        dag,
        node,
        blackboard,
        policy,
        model: state.escalated ? 'strong' : policy.model,
      });
      this.emit({ kind: 'node.start', runId: dag.runId, nodeId: node.id, detail: `attempt ${state.attempts}` });
      record({ level: 'info', kind: 'span', component: 'Orchestrator', msg: 'node.start', data: { runId: dag.runId, nodeId: node.id, attempt: state.attempts, model: brief.model, vision: brief.useVision } });

      const outcome = await runSupervised(this.deps.runner, brief, this.supervisor, governor.allowanceFor(node.budget.tokens), {
        pollMs: this.deps.pollMs,
        signal: this.stopping.signal,
      });
      const spent = outcome.result?.tokens ?? 0;
      state.tokens += spent;
      governor.spend(spent);

      if (outcome.result?.ok) {
        state.status = 'done';
        state.answer = outcome.result.answer;
        for (const url of outcome.result.urls ?? []) await blackboard.claim(url, node.id);
        for (const fact of outcome.result.facts ?? []) await blackboard.append('fact', node.id, fact);
        await blackboard.append('artifact', node.id, node.goal, outcome.result.answer);
        this.emit({ kind: 'node.done', runId: dag.runId, nodeId: node.id, detail: outcome.result.answer.slice(0, 120) });
        await save('running');
        return;
      }

      const reason = outcome.killed ?? outcome.error ?? 'the worker ended without an answer';
      state.lastError = reason;
      await blackboard.append('failure', node.id, node.goal, reason);
      if (outcome.killed) this.emit({ kind: 'node.killed', runId: dag.runId, nodeId: node.id, detail: reason });

      if (this.stopping.signal.aborted) {
        // The run was stopped from outside: the node is neither failed nor done, it simply did not happen.
        state.status = 'pending';
        await save('stopped');
        return;
      }

      const decision = this.supervisor.decide(node.id, state.attempts, reason);
      state.notes.push(decision.reason);
      if (decision.action === 'give_up') {
        state.status = 'failed';
        this.emit({ kind: 'node.failed', runId: dag.runId, nodeId: node.id, detail: decision.reason });
        await save('running');
        return;
      }
      state.escalated = state.escalated || decision.escalate;
      this.emit({ kind: 'node.retry', runId: dag.runId, nodeId: node.id, detail: decision.reason });
      await save('running');
      await sleep(decision.afterMs);
      // Set last: while the attempt promise is alive the node stays out of the ready set.
      state.status = 'pending';
    };

    const pump = async (): Promise<void> => {
      for (;;) {
        const policy = governor.policy();
        const slots = policy.concurrency - running.size;
        const ready = policy.exhausted || this.stopping.signal.aborted ? [] : readyNodes(dag, states, slots, running.size);
        for (const node of ready) {
          const promise = attempt(node).finally(() => running.delete(node.id));
          running.set(node.id, promise);
        }
        if (running.size > 0) {
          await Promise.race(running.values());
          continue;
        }
        const pending = Object.entries(states).filter(([, state]) => state.status === 'pending');
        if (pending.length === 0) return;
        // A stopped run keeps its pending nodes pending: that is what resume() picks up.
        if (this.stopping.signal.aborted) return;
        // Nothing runs and nothing can start: a dependency failed, or the budget is gone.
        const blocked = new Set(blockedNodes(dag, states).map(node => node.id));
        const why = policy.exhausted ? 'the run budget is spent' : 'a part it depends on did not finish';
        for (const [id, state] of pending) {
          state.status = 'skipped';
          state.notes.push(blocked.has(id) ? 'a part it depends on did not finish' : why);
        }
        return;
      }
    };

    await pump();

    let verification: VerificationReport | undefined;
    const rounds = this.deps.maxVerifyRounds ?? 2;
    const verifiable = this.deps.ask && (!isSingleNode(dag) || this.deps.verifySingleNode) && !this.stopping.signal.aborted;
    for (let round = 0; verifiable && round < rounds; round++) {
      const claims: Claim[] = topologicalOrder(dag)
        .filter(node => states[node.id].status === 'done')
        .map(node => ({ nodeId: node.id, text: states[node.id].answer ?? '' }));
      const failed = Object.entries(states)
        .filter(([, state]) => state.status === 'failed' || state.status === 'skipped')
        .map(([id]) => id);
      verification = await verifyRun({
        task: dag.task,
        claims,
        evidence: blackboard.evidence(),
        ask: this.deps.ask!,
        failedNodes: failed,
        signal: this.stopping.signal,
      });
      this.emit({ kind: 'verify', runId: dag.runId, detail: `round ${round + 1}: ${verification.passed ? 'passed' : verification.redispatch.join(', ') || 'failed'}` });
      await save('running', verification);
      if (verification.passed || verification.inconclusive) break;

      // Re-dispatch what did not hold, while the supervisor still allows the node another attempt.
      const again = verification.redispatch.filter(id => {
        const state = states[id];
        return Boolean(byId.get(id) && state && this.supervisor.canRetry(state.attempts));
      });
      if (again.length === 0 || round === rounds - 1) break;
      for (const id of again) {
        states[id].status = 'pending';
        states[id].notes.push('re-dispatched: the verifier did not find the claim in the evidence');
      }
      await pump();
    }

    const finished = Object.values(states).every(state => state.status === 'done');
    const status: RunCheckpoint['status'] = this.stopping.signal.aborted ? 'stopped' : finished ? 'completed' : 'failed';
    const answer = this.answerOf(dag, states);
    await save(status, verification);
    this.emit({ kind: 'run.end', runId: dag.runId, detail: `${status}, ${governor.spentTokens} tokens` });
    logger.info(`run ${dag.runId} ${status} after ${governor.spentTokens} uncached input tokens`);
    return { runId: dag.runId, status, answer, nodes: states, spentTokens: governor.spentTokens, verification };
  }

  /** One node's answer as it is; several nodes' answers in plan order, each labelled with its part. */
  private answerOf(dag: PlanDag, states: Record<string, NodeState>): string {
    const done = topologicalOrder(dag).filter(node => states[node.id].status === 'done');
    if (isSingleNode(dag)) return states[dag.nodes[0].id].answer ?? '';
    return done.map(node => `${node.goal}: ${states[node.id].answer ?? ''}`).join('\n');
  }

  private emit(event: OrchestrationEvent): void {
    this.deps.onEvent?.(event);
    record({ level: 'info', kind: 'event', component: 'Orchestrator', msg: event.kind, data: { ...event } });
  }
}

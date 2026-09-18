/**
 * The plan as a graph: which subtasks may run now, which must wait, and which must have the browser to themselves.
 * A plan with one node is the ordinary task path — one worker, no dependencies, the task text unchanged — so nothing
 * an ordinary task does passes through anything below.
 */
import type { NodeState, PlanDag, PlanNode } from './types';

export const DEFAULT_NODE_BUDGET = { steps: 25, tokens: 250_000 } as const;
export const DEFAULT_RUN_BUDGET_TOKENS = 1_000_000;

/** Everything wrong with a plan, in one pass: unknown dependencies, duplicate ids, self-references and cycles. */
export function validateDag(dag: PlanDag): string[] {
  const problems: string[] = [];
  if (dag.nodes.length === 0) problems.push('the plan has no nodes');
  const ids = new Set<string>();
  for (const node of dag.nodes) {
    if (ids.has(node.id)) problems.push(`duplicate node id ${node.id}`);
    ids.add(node.id);
  }
  for (const node of dag.nodes) {
    for (const dep of node.dependsOn) {
      if (dep === node.id) problems.push(`node ${node.id} depends on itself`);
      else if (!ids.has(dep)) problems.push(`node ${node.id} depends on unknown node ${dep}`);
    }
  }
  // Kahn: whatever cannot be peeled off is in a cycle.
  const pending = new Map(dag.nodes.map(node => [node.id, node.dependsOn.filter(dep => ids.has(dep) && dep !== node.id)]));
  let peeled = true;
  while (peeled) {
    peeled = false;
    for (const [id, deps] of pending) {
      if (deps.every(dep => !pending.has(dep))) {
        pending.delete(id);
        peeled = true;
      }
    }
  }
  if (pending.size > 0) problems.push(`dependency cycle between ${[...pending.keys()].sort().join(', ')}`);
  return problems;
}

/** The nodes in plan order; a node is listed after everything it depends on. */
export function topologicalOrder(dag: PlanDag): PlanNode[] {
  const byId = new Map(dag.nodes.map(node => [node.id, node]));
  const placed = new Set<string>();
  const order: PlanNode[] = [];
  const visit = (node: PlanNode, seen: Set<string>) => {
    if (placed.has(node.id) || seen.has(node.id)) return;
    seen.add(node.id);
    for (const dep of node.dependsOn) {
      const parent = byId.get(dep);
      if (parent) visit(parent, seen);
    }
    placed.add(node.id);
    order.push(node);
  };
  for (const node of dag.nodes) visit(node, new Set());
  return order;
}

/**
 * What may be dispatched now, at most `slots` of them. A node waits for every dependency to be `done`; a dependency
 * that failed for good leaves its dependents unrunnable (the caller marks them `skipped`). A `serial` node runs with
 * the browser to itself: it waits for the running nodes to end and holds the pool while it runs.
 */
export function readyNodes(dag: PlanDag, states: Record<string, NodeState>, slots: number, running: number): PlanNode[] {
  if (slots <= 0) return [];
  const status = (id: string) => states[id]?.status ?? 'pending';
  const runnable = dag.nodes.filter(
    node => status(node.id) === 'pending' && node.dependsOn.every(dep => status(dep) === 'done'),
  );
  const serial = runnable.find(node => node.mode === 'serial');
  if (serial) {
    // A serial node goes first so it cannot starve behind an endless supply of parallel work.
    return running === 0 ? [serial] : [];
  }
  return runnable.slice(0, slots);
}

/** Nodes that can never run because something they depend on failed or was skipped. */
export function blockedNodes(dag: PlanDag, states: Record<string, NodeState>): PlanNode[] {
  const status = (id: string) => states[id]?.status ?? 'pending';
  const lost = new Set(dag.nodes.filter(node => ['failed', 'skipped'].includes(status(node.id))).map(node => node.id));
  if (lost.size === 0) return [];
  const blocked: PlanNode[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of dag.nodes) {
      if (status(node.id) !== 'pending' || lost.has(node.id)) continue;
      if (node.dependsOn.some(dep => lost.has(dep))) {
        lost.add(node.id);
        blocked.push(node);
        grew = true;
      }
    }
  }
  return blocked;
}

export function initialStates(dag: PlanDag): Record<string, NodeState> {
  return Object.fromEntries(dag.nodes.map(node => [node.id, { status: 'pending' as const, attempts: 0, tokens: 0, notes: [] }]));
}

/** The ordinary task: one node, the task text as its goal, no dependencies. */
export function singleNodeDag(runId: string, task: string, options: Partial<PlanDag> & { steps?: number } = {}): PlanDag {
  return {
    runId,
    task,
    budgetTokens: options.budgetTokens ?? DEFAULT_RUN_BUDGET_TOKENS,
    startUrl: options.startUrl,
    nodes: [
      {
        id: 'main',
        goal: task,
        mode: 'serial',
        dependsOn: [],
        successCriteria: 'The task is answered or carried out.',
        budget: { steps: options.steps ?? DEFAULT_NODE_BUDGET.steps, tokens: options.budgetTokens ?? DEFAULT_RUN_BUDGET_TOKENS },
        startUrl: options.startUrl,
      },
    ],
  };
}

export function isSingleNode(dag: PlanDag): boolean {
  return dag.nodes.length === 1;
}

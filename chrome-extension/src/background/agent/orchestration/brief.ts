/**
 * The brief a worker gets: its own subtask, what its dependencies found, and which addresses other workers already
 * read. Nothing else — not the other subtasks, not their transcripts, not the run's history. That is a correctness
 * rule first (a worker that cannot see another worker's page cannot report it as its own) and a token win second.
 *
 * A single-node plan gets the user's task text unchanged, so the ordinary path sends exactly what it sends today.
 */
import type { Blackboard } from './blackboard';
import { isSingleNode } from './dag';
import type { GovernorPolicy } from './governor';
import type { PlanDag, PlanNode, WorkerBrief } from './types';

export function briefFor(params: {
  dag: PlanDag;
  node: PlanNode;
  blackboard: Blackboard;
  policy: GovernorPolicy;
  maxSteps?: number;
  model?: WorkerBrief['model'];
}): WorkerBrief {
  const { dag, node, blackboard, policy } = params;
  const common = {
    runId: dag.runId,
    nodeId: node.id,
    goal: node.goal,
    successCriteria: node.successCriteria,
    maxSteps: params.maxSteps ?? node.budget.steps,
    useVision: policy.screenshots,
    model: params.model ?? policy.model,
    startUrl: node.startUrl ?? dag.startUrl,
  };
  if (isSingleNode(dag)) return { ...common, task: dag.task };

  const parts = [`Overall task (for context only): ${dag.task}`, `Your part: ${node.goal}`, `Done when: ${node.successCriteria}`];
  const found = blackboard.facts(node.dependsOn);
  if (found.length > 0) {
    parts.push(
      'What the earlier parts already established (treat as given, do not re-check):',
      ...found.map(entry => `- ${entry.subject}${entry.note ? ` — ${entry.note}` : ''}`),
    );
  }
  const taken = blackboard.render(800, node.id);
  if (taken) parts.push('Pages another part of this task already read (do not read them again):', taken);
  parts.push('Answer your part only. Do not do the other parts.');
  return { ...common, task: parts.join('\n') };
}

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

  // The worker's task text is its own part, never the whole job: the completion checks in `validation/done-evidence.ts`
  // read the task text as what the answer must cover, so a worker holding the whole task would have every answer
  // refused for leaving the other parts out. The other parts are also none of its business.
  const lines = [node.goal, `Done when: ${node.successCriteria}`];
  const found = [...blackboard.answers(node.dependsOn), ...blackboard.facts(node.dependsOn)];
  if (found.length > 0) {
    lines.push(
      'Already established by the earlier parts of this job (take as given, do not check it again):',
      ...found.map(entry => `- ${entry.subject}${entry.note ? ` — ${entry.note}` : ''}`),
    );
  }
  const taken = blackboard.render(800, node.id);
  if (taken) {
    lines.push('Already covered by other parts of this job — pages read, and routes that led nowhere. Do not repeat these:', taken);
  }
  lines.push('This is one part of a larger job. Do this part only.');
  return { ...common, task: lines.join('\n') };
}

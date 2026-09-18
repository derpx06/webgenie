/**
 * Turns a task into a plan graph with one model call, before any page is opened. The call is asked to split only what
 * really splits — parts that can be worked on in separate tabs without one waiting on the other — and to answer with a
 * single part otherwise. Anything unusable (bad JSON, a cycle, a part that depends on nothing existing) falls back to
 * the single-node plan, which is today's ordinary path, so a decomposition that goes wrong costs one call and nothing
 * else.
 */
import { createLogger } from '@src/background/log';
import { DEFAULT_NODE_BUDGET, DEFAULT_RUN_BUDGET_TOKENS, singleNodeDag, validateDag } from './dag';
import type { AskFn, NodeMode, PlanDag, PlanNode } from './types';

const logger = createLogger('Decompose');

export const MAX_PLAN_NODES = 8;

export function decomposePrompt(task: string, startUrl?: string): string {
  return [
    'Split a browsing task into parts that can be worked on at the same time, each in its own browser tab.',
    `Task: ${task}`,
    startUrl ? `The browser is on: ${startUrl}` : '',
    '',
    'Rules:',
    '- Split only what genuinely runs side by side, for example several independent lookups, each on its own page.',
    '- A part that needs another part\'s answer lists that part in dependsOn.',
    '- mode is "serial" for a part that must have the browser to itself (signing in, anything that buys or changes an',
    '  account, anything that depends on where the other parts left the page) and "parallel-safe" otherwise.',
    '- If the task is one line of work, or the parts would each need the others\' state, answer with a single part.',
    `- At most ${MAX_PLAN_NODES} parts.`,
    '',
    'Answer with JSON only:',
    '{"parts":[{"id":"a","goal":"<what this part does>","mode":"parallel-safe","dependsOn":[],',
    '  "successCriteria":"<how to tell it is done>","steps":<a step budget, 5-40>}]}',
  ]
    .filter(Boolean)
    .join('\n');
}

interface RawPart {
  id?: unknown;
  goal?: unknown;
  mode?: unknown;
  dependsOn?: unknown;
  successCriteria?: unknown;
  steps?: unknown;
  startUrl?: unknown;
}

function parseParts(text: string): RawPart[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { parts?: unknown };
    return Array.isArray(parsed.parts) ? (parsed.parts as RawPart[]) : null;
  } catch {
    return null;
  }
}

/** A model's answer as a plan, or null when it is not one this layer can run. */
export function dagFromParts(
  runId: string,
  task: string,
  parts: RawPart[],
  options: { budgetTokens?: number; startUrl?: string } = {},
): PlanDag | null {
  if (parts.length === 0 || parts.length > MAX_PLAN_NODES) return null;
  const budgetTokens = options.budgetTokens ?? DEFAULT_RUN_BUDGET_TOKENS;
  const nodes: PlanNode[] = [];
  for (const [index, part] of parts.entries()) {
    const id = typeof part.id === 'string' && part.id.trim() ? part.id.trim() : `part_${index + 1}`;
    const goal = typeof part.goal === 'string' ? part.goal.trim() : '';
    if (!goal) return null;
    const steps = typeof part.steps === 'number' && part.steps > 0 ? Math.min(Math.round(part.steps), 60) : DEFAULT_NODE_BUDGET.steps;
    const mode: NodeMode = part.mode === 'serial' ? 'serial' : 'parallel-safe';
    nodes.push({
      id,
      goal,
      mode,
      dependsOn: Array.isArray(part.dependsOn) ? part.dependsOn.filter((dep): dep is string => typeof dep === 'string') : [],
      successCriteria: typeof part.successCriteria === 'string' && part.successCriteria.trim() ? part.successCriteria.trim() : `${goal} is done.`,
      // Each part may spend at most its share of the run, so one runaway part cannot eat the budget of the rest.
      budget: { steps, tokens: Math.floor(budgetTokens / parts.length) },
      startUrl: typeof part.startUrl === 'string' ? part.startUrl : options.startUrl,
    });
  }
  const dag: PlanDag = { runId, task, nodes, budgetTokens, startUrl: options.startUrl };
  const problems = validateDag(dag);
  if (problems.length > 0) {
    logger.warning(`the decomposition was refused: ${problems.join('; ')}`);
    return null;
  }
  return dag;
}

export async function decomposeTask(params: {
  runId: string;
  task: string;
  ask: AskFn;
  budgetTokens?: number;
  startUrl?: string;
  steps?: number;
  signal?: AbortSignal;
}): Promise<PlanDag> {
  const fallback = () =>
    singleNodeDag(params.runId, params.task, {
      budgetTokens: params.budgetTokens ?? DEFAULT_RUN_BUDGET_TOKENS,
      startUrl: params.startUrl,
      steps: params.steps,
    });
  let answer: string;
  try {
    answer = await params.ask(decomposePrompt(params.task, params.startUrl), params.signal);
  } catch (error) {
    logger.warning(`the task was not split: ${error instanceof Error ? error.message : String(error)}`);
    return fallback();
  }
  const parts = parseParts(answer);
  if (!parts) return fallback();
  return dagFromParts(params.runId, params.task, parts, { budgetTokens: params.budgetTokens, startUrl: params.startUrl }) ?? fallback();
}

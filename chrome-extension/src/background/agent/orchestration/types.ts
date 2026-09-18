/**
 * What the orchestration layer passes around: a plan as a graph of subtasks, the state of each one, the brief a worker
 * gets, and the run checkpoint that survives a crash. Nothing here talks to Chrome or to a model; the parts that do
 * take their dependencies as arguments, so the whole layer runs in tests on the fakes in `agent/__tests__/fakes.ts`.
 */

/** A node that may share the browser with other nodes, or one that must have the run to itself (logins, checkouts). */
export type NodeMode = 'parallel-safe' | 'serial';

export interface NodeBudget {
  /** Navigator steps the worker may take before the supervisor stops it. */
  steps: number;
  /** Uncached input tokens the node may spend before the supervisor stops it. */
  tokens: number;
}

export interface PlanNode {
  id: string;
  /** The subtask in the user's terms; it becomes the worker's task text. */
  goal: string;
  mode: NodeMode;
  /** Ids of nodes that must finish first; their answers are the only cross-node context this node sees. */
  dependsOn: string[];
  /** How the verifier and the worker's planner know this node is done. */
  successCriteria: string;
  budget: NodeBudget;
  /** Where the worker's tab starts; without one it starts where the run started. */
  startUrl?: string;
}

export interface PlanDag {
  runId: string;
  /** The user's task, unchanged; a single-node plan carries it as that node's goal too. */
  task: string;
  nodes: PlanNode[];
  /** Uncached input tokens for the whole run, across every worker. */
  budgetTokens: number;
  startUrl?: string;
}

export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface NodeState {
  status: NodeStatus;
  /** Finished attempts, including the killed ones. */
  attempts: number;
  answer?: string;
  /** Uncached input tokens this node has spent over all its attempts. */
  tokens: number;
  lastError?: string;
  /** Why the supervisor killed, retried or escalated this node; kept in the checkpoint. */
  notes: string[];
  /** The stronger model was asked for after a failed attempt. */
  escalated?: boolean;
}

export type ModelTier = 'cheap' | 'default' | 'strong';

/** Everything a worker is told. Deliberately narrow: its own goal, its dependencies' answers, and what pages are taken. */
export interface WorkerBrief {
  runId: string;
  nodeId: string;
  /** The task text the worker's executor runs, brief and dependency context included. */
  task: string;
  goal: string;
  successCriteria: string;
  maxSteps: number;
  /** Off once the cost governor drops screenshots. */
  useVision: boolean;
  /** The governor's model tier; the run's deps decide what each tier means. */
  model: ModelTier;
  startUrl?: string;
}

export interface NodeResult {
  ok: boolean;
  /** The worker's answer for its subtask; the claim the verifier re-checks. */
  answer: string;
  /** Uncached input tokens (input minus the provider's cache reads), as the trace review counts them. */
  tokens: number;
  /** Addresses the worker read, for the blackboard. */
  urls?: string[];
  /** What the worker learned, one line each, for the blackboard and for dependent nodes. */
  facts?: string[];
  error?: string;
}

/** Runs one subtask. Production wires it to an Executor on its own tab (`worker.ts`); tests script it. */
export type NodeRunner = (
  brief: WorkerBrief,
  control: {
    signal: AbortSignal;
    /** Called whenever the worker does something; the same signature twice in a row reads as a loop. */
    onProgress: (signature: string, tokens?: number) => void;
  },
) => Promise<NodeResult>;

export interface RunCheckpoint {
  runId: string;
  task: string;
  dag: PlanDag;
  nodes: Record<string, NodeState>;
  spentTokens: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  verification?: VerificationReport;
  updatedAt: number;
}

export interface Claim {
  nodeId: string;
  text: string;
}

export interface Verdict {
  nodeId: string;
  holds: boolean;
  reason: string;
}

export interface VerificationReport {
  verdicts: Verdict[];
  /** Node ids whose claim did not hold and that are worth running again. */
  redispatch: string[];
  passed: boolean;
  /** The check could not be made (the model call failed); nothing is re-dispatched on a guess. */
  inconclusive?: boolean;
}

export interface RunOutcome {
  runId: string;
  status: RunCheckpoint['status'];
  /** The run's answer: one node's answer, or the nodes' answers in plan order. */
  answer: string;
  nodes: Record<string, NodeState>;
  spentTokens: number;
  verification?: VerificationReport;
}

/** One model call that answers a prompt with text; used for decomposition and verification, never for page work. */
export type AskFn = (prompt: string, signal?: AbortSignal) => Promise<string>;

export interface OrchestrationEvent {
  kind:
    | 'run.start'
    | 'node.start'
    | 'node.done'
    | 'node.failed'
    | 'node.killed'
    | 'node.retry'
    | 'degrade'
    | 'verify'
    | 'run.end';
  runId: string;
  nodeId?: string;
  detail: string;
}

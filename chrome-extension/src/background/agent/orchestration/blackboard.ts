/**
 * The run's shared, append-only record: what each worker learned, which addresses are taken, what it produced and what
 * failed. Nothing is ever edited or removed, so a crash loses at most the last write, and a worker that starts late
 * reads the same history as one that started first.
 *
 * Its point is that two workers never read the same page twice: `claim()` hands an address to exactly one node, and
 * everyone else is told who has it. The block the workers see is rendered by `TaskLedger` (`memory/in-chat/ledger.ts`),
 * the same compaction-proof format a single task already uses for its own visits and dead ends.
 */
import { TaskLedger } from '../memory/in-chat/ledger';
import { addressKey } from '../validation/service';
import type { KeyValueStorage } from '../contracts/checkpoint';

export type BlackboardKind = 'fact' | 'url' | 'artifact' | 'failure';

export interface BlackboardEntry {
  seq: number;
  kind: BlackboardKind;
  nodeId: string;
  /** The address for a url, a short name for an artifact, the action or goal for a failure, the claim for a fact. */
  subject: string;
  note: string;
  at: number;
}

function blackboardKey(runId: string): string {
  return `orchestration:blackboard:${runId}`;
}

/** An address as the blackboard compares it: the same page with a different fragment is the same page. */
function keyOf(url: string): string {
  try {
    return addressKey(url) || url;
  } catch {
    return url;
  }
}

export class Blackboard {
  private records: BlackboardEntry[] = [];
  /** Writes are serialized: the store is one key, and two workers appending at once would otherwise lose one. */
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly runId: string,
    private readonly storage: KeyValueStorage,
    private readonly now: () => number = Date.now,
  ) {}

  static async load(runId: string, storage: KeyValueStorage, now: () => number = Date.now): Promise<Blackboard> {
    const blackboard = new Blackboard(runId, storage, now);
    blackboard.records = (await storage.get<BlackboardEntry[]>(blackboardKey(runId))) ?? [];
    return blackboard;
  }

  entries(): BlackboardEntry[] {
    return [...this.records];
  }

  async append(kind: BlackboardKind, nodeId: string, subject: string, note = ''): Promise<BlackboardEntry> {
    const entry: BlackboardEntry = { seq: this.records.length, kind, nodeId, subject, note, at: this.now() };
    this.records.push(entry);
    await this.flush();
    return entry;
  }

  /**
   * Gives `nodeId` an address no one has read yet. `false` means another node already has it, and the caller should
   * spend its steps elsewhere; the same node claiming the same address again gets `true`, so a retry is never blocked.
   */
  async claim(url: string, nodeId: string): Promise<boolean> {
    const key = keyOf(url);
    const owner = this.records.find(entry => entry.kind === 'url' && keyOf(entry.subject) === key);
    if (owner && owner.nodeId !== nodeId) return false;
    if (!owner) await this.append('url', nodeId, url);
    return true;
  }

  /** Who holds an address, if anyone. */
  owner(url: string): string | null {
    const key = keyOf(url);
    return this.records.find(entry => entry.kind === 'url' && keyOf(entry.subject) === key)?.nodeId ?? null;
  }

  /** Facts, newest last; from `nodeIds` only when given, which is how a worker gets its dependencies' results alone. */
  facts(nodeIds?: string[]): BlackboardEntry[] {
    return this.records.filter(
      entry => entry.kind === 'fact' && (!nodeIds || nodeIds.includes(entry.nodeId)),
    );
  }

  /** What the given nodes reported when they finished; this is what a part that depends on them is told. */
  answers(nodeIds: string[]): BlackboardEntry[] {
    return this.records.filter(entry => entry.kind === 'artifact' && nodeIds.includes(entry.nodeId));
  }

  failures(): BlackboardEntry[] {
    return this.records.filter(entry => entry.kind === 'failure');
  }

  /** Every fact, artifact and failure as one text, which is all the verifier is allowed to check a claim against. */
  evidence(maxChars = 8_000): string {
    const lines = this.records
      .filter(entry => entry.kind !== 'url')
      .map(entry => `- [${entry.nodeId}] ${entry.kind}: ${entry.subject}${entry.note ? ` — ${entry.note}` : ''}`);
    const urls = this.records.filter(entry => entry.kind === 'url').map(entry => `- [${entry.nodeId}] read ${entry.subject}`);
    return [...lines, ...urls].join('\n').slice(0, maxChars);
  }

  /** The addresses and failures as a worker sees them, in the ledger's format so compaction cannot drop it. */
  render(maxChars = 1_200, exceptNode?: string): string {
    const ledger = new TaskLedger();
    for (const entry of this.records) {
      if (entry.kind === 'url' && entry.nodeId !== exceptNode) ledger.visited(entry.subject, `read by ${entry.nodeId}`);
      if (entry.kind === 'failure') ledger.deadEnd(entry.subject, entry.note);
    }
    return ledger.render(maxChars);
  }

  private flush(): Promise<void> {
    this.writing = this.writing.then(() => this.storage.set(blackboardKey(this.runId), this.records));
    return this.writing;
  }
}

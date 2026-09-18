/**
 * What this task already tried, written by the harness and not by the model: every address it landed on and how often,
 * every action the guards refused and why, and every page it backed out of. 442 wasted steps across the reviewed tasks
 * are loops and re-visits — one task opened the same three pages nine times — because the only record of them was the
 * step summary, which the context builder compresses first. This block is rebuilt from the ledger on every call, so no
 * compaction can drop it, and near-identical entries collapse into one line with a count.
 */

export type LedgerKind = 'visit' | 'refused' | 'dead_end';

export interface LedgerEntry {
  kind: LedgerKind;
  /** What the entry is about: an address for a visit or a dead end, the action's name for a refusal. */
  subject: string;
  /** The latest short note: a page title, the reason an action was refused, why a page was left. */
  note: string;
  times: number;
}

/** A note short enough that twenty of them still fit the block. */
function short(text: string, maxChars = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

export class TaskLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  private add(kind: LedgerKind, subject: string, note: string): void {
    if (!subject) return;
    const key = `${kind}|${subject}`;
    const known = this.entries.get(key);
    if (known) {
      known.times++;
      // The newest note wins: a page that gave results after a filter is no longer the page that gave none.
      if (note) known.note = short(note);
      return;
    }
    this.entries.set(key, { kind, subject: short(subject, 90), note: short(note), times: 1 });
  }

  /** An address the task landed on, with whatever the page says it is. */
  visited(address: string, note = ''): void {
    this.add('visit', address, note);
  }

  /** An action a guard refused, by tool name, with the start of the reason. */
  refused(action: string, reason: string): void {
    this.add('refused', action, reason);
  }

  /** A page the task backed out of: going there again costs the same steps it cost the first time. */
  deadEnd(address: string, why: string): void {
    this.add('dead_end', address, why);
  }

  /** Every entry, newest first within its kind; for tests and traces. */
  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }

  /**
   * The block as the models see it, within `maxChars`. What prevents a loop comes first — dead ends, refusals, then the
   * addresses seen more than once — and a page seen exactly once is dropped before anything else when the budget is
   * tight: it is the least likely to be revisited by mistake and the most numerous.
   */
  render(maxChars: number): string {
    const rank = (entry: LedgerEntry) =>
      entry.kind === 'dead_end' ? 0 : entry.kind === 'refused' ? 1 : entry.times > 1 ? 2 : 3;
    const ordered = this.all().sort((a, b) => rank(a) - rank(b) || b.times - a.times);
    if (ordered.length === 0) return '';

    const label = { visit: 'seen', refused: 'refused', dead_end: 'dead end' } as const;
    const lines: string[] = [];
    let used = 0;
    let dropped = 0;
    for (const entry of ordered) {
      const count = entry.times > 1 ? ` x${entry.times}` : '';
      const line = `- ${label[entry.kind]} ${entry.subject}${count}${entry.note ? `: ${entry.note}` : ''}`;
      if (used + line.length + 1 > maxChars) {
        dropped++;
        continue;
      }
      lines.push(line);
      used += line.length + 1;
    }
    if (dropped > 0) lines.push(`- and ${dropped} more pages seen once`);
    return lines.join('\n');
  }
}

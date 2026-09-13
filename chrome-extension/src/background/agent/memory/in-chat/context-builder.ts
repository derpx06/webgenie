import { AIMessage, HumanMessage, ToolMessage, type BaseMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '../../types';
import type { TranscriptEntry } from '../../messages/service';
import { defangTags } from '../../messages/utils';

/**
 * Navigator tool turns sent as real messages: at least MIN_RECENT_TURNS, from a boundary that moves only every TURN_BLOCK
 * turns. Between moves each call's messages extend the previous call's, so providers can reuse the cached prefix (a
 * sliding window changed the prompt right after the task on every step). Older turns are summarized as text.
 */
const MIN_RECENT_TURNS = 3;
const TURN_BLOCK = 8;
const EARLIER_STEPS_CHARS = 1500;
const PLANNER_STEPS_CHARS = 4000;
const STEP_TEXT_CHARS = 200;
const FINDINGS_CHARS = 1500;

interface ToolTurn {
  kind: 'turn';
  ai: AIMessage;
  results: ToolMessage[];
}

type TranscriptItem = { kind: 'user'; message: BaseMessage } | ToolTurn;

function oneLine(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

function isComplete(turn: ToolTurn): boolean {
  const answered = new Set(turn.results.map(result => result.tool_call_id));
  const calls = turn.ai.tool_calls ?? [];
  return calls.length > 0 && calls.length === turn.results.length && calls.every(call => !!call.id && answered.has(call.id));
}

/** User messages and complete tool turns, in order. Entries from older versions and incomplete turns are skipped. */
function readTranscript(entries: TranscriptEntry[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const { message, type } of entries) {
    if (type === 'task' || type === 'human_answer') {
      items.push({ kind: 'user', message });
    } else if (type === 'turn_ai' && message instanceof AIMessage) {
      items.push({ kind: 'turn', ai: message, results: [] });
    } else if (type === 'turn_tool' && message instanceof ToolMessage) {
      const last = items[items.length - 1];
      if (last?.kind === 'turn') last.results.push(message);
    }
  }
  return items.filter(item => item.kind === 'user' || isComplete(item));
}

/** One line per tool turn (actions, results, memory); the newest lines are kept within the budget. */
export function renderTurnsAsText(turns: Array<{ ai: AIMessage; results: ToolMessage[] }>, maxChars: number): string {
  const lines = turns.map(({ ai, results }) => {
    const resultById = new Map(
      results.map(result => [result.tool_call_id, typeof result.content === 'string' ? result.content : JSON.stringify(result.content)]),
    );
    let memory = '';
    const actions = (ai.tool_calls ?? []).map(call => {
      const args = { ...(call.args as Record<string, unknown>) };
      if (!memory && typeof args.memory === 'string') memory = args.memory;
      delete args.memory;
      return `${call.name} ${JSON.stringify(args)} → ${oneLine(resultById.get(call.id ?? '') ?? '', STEP_TEXT_CHARS)}`;
    });
    return `- ${actions.join('; ')}${memory ? ` (memory: ${oneLine(memory, STEP_TEXT_CHARS)})` : ''}`;
  });

  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (used + lines[i].length + 1 > maxChars) {
      kept.unshift(`- ...${i + 1} earlier steps omitted`);
      break;
    }
    kept.unshift(lines[i]);
    used += lines[i].length + 1;
  }
  return kept.join('\n');
}

function withHeader(state: HumanMessage, header: string): HumanMessage {
  if (!header) return state;
  if (typeof state.content === 'string') return new HumanMessage(`${header}\n\n${state.content}`);
  return new HumanMessage({ content: [{ type: 'text', text: `${header}\n\n` }, ...state.content] });
}

export class ContextBuilder {
  private static formatLinesWithBudget(lines: string[], maxChars: number): string {
    let result = '';
    for (let i = 0; i < lines.length; i++) {
      const line = `${lines[i]}\n`;
      if (result.length + line.length > maxChars) {
        result += `... and ${lines.length - i} more items [truncated due to token budget]`;
        break;
      }
      result += line;
    }
    return result.trim();
  }

  /** Non-empty blocks shown above the browser state. */
  private static stateSections(context: AgentContext, actor: 'planner' | 'navigator'): string[] {
    const sections: string[] = [];
    if (context.taskStartUrl) sections.push(`[TASK STARTED ON]\n${context.taskStartUrl}`);
    const addList = (title: string, lines: string[], maxChars: number) => {
      if (lines.length > 0) sections.push(`[${title}]\n${this.formatLinesWithBudget(lines, maxChars)}`);
    };

    addList('COMPLETED EARLIER TASKS', context.taskArchive.getRecords().map(record => `- "${record.goal}" → ${record.outcome}`), 900);

    const contract = context.currentContract;
    const contractBlock = contract
      ? [
        '[CURRENT PLAN]',
        `goal: ${contract.goal}`,
        `phase: ${contract.macroObjective}`,
        `success condition: ${contract.successCondition}`,
      ].join('\n')
      : '';
    if (contractBlock) sections.push(contractBlock);

    // The navigator has each action's result as a tool message; the validation summary would repeat it.
    const progressLines = actor === 'planner' ? (context.validatedProgress ?? []).slice(-12).map(record => `- ${record.status}: ${record.summary}`) : [];
    const validatedBlock = progressLines.length > 0
      ? `[VALIDATED PROGRESS]\n${this.formatLinesWithBudget(progressLines, 1000)}`
      : '';
    if (validatedBlock) sections.push(validatedBlock);

    // Saved findings, newest kept within the budget, shown oldest first.
    const findings: string[] = [];
    let used = 0;
    const saved = context.findings ?? [];
    for (let i = saved.length - 1; i >= 0; i--) {
      const line = `- ${saved[i].trim()}`.slice(0, FINDINGS_CHARS);
      if (used + line.length + 1 > FINDINGS_CHARS) {
        findings.unshift(`- ...${i + 1} earlier findings omitted`);
        break;
      }
      findings.unshift(line);
      used += line.length + 1;
    }
    if (findings.length > 0) sections.push(`[FINDINGS]\n${findings.join('\n')}`);
    if (context.downloads?.size) sections.push(`[DOWNLOADS]\n${[...context.downloads.values()].map(line => `- ${line}`).join('\n')}`);

    if (context.blockedState) sections.push(`[BLOCKED]\n${JSON.stringify(context.blockedState).slice(0, 700)}`);
    return sections;
  }

  /**
   * The messages for one model call: the static system prompt, the user's tasks and answers (plus, for the
   * navigator, its last tool turns), then one message with the context blocks and the current browser state.
   * The planner gets the steps as text so its packet never contains tool calls.
   * Stable content comes first so providers can cache the prefix.
   */
  public static buildContextPacket(
    context: AgentContext,
    systemMessage: SystemMessage,
    currentStateMessage: HumanMessage,
    actor: 'planner' | 'navigator' = 'navigator',
  ): BaseMessage[] {
    const items = readTranscript(context.messageManager.getTranscript());
    const turns = items.filter((item): item is ToolTurn => item.kind === 'turn');
    const firstRecent = Math.max(0, Math.floor((turns.length - MIN_RECENT_TURNS) / TURN_BLOCK) * TURN_BLOCK);
    const recentTurns = new Set<TranscriptItem>(actor === 'navigator' ? turns.slice(firstRecent) : []);

    const transcript: BaseMessage[] = [];
    for (const item of items) {
      if (item.kind === 'user') transcript.push(item.message);
      else if (recentTurns.has(item)) transcript.push(item.ai, ...item.results);
    }

    const sections = this.stateSections(context, actor);
    const olderTurns = turns.filter(turn => !recentTurns.has(turn));
    if (olderTurns.length > 0) {
      sections.push(
        actor === 'planner'
          ? `[Steps so far, oldest first]\n${renderTurnsAsText(olderTurns, PLANNER_STEPS_CHARS)}`
          : `[Earlier steps]\n${renderTurnsAsText(olderTurns, EARLIER_STEPS_CHARS)}`,
      );
    }
    // Plans, progress, findings and step summaries are model-written and may quote page text.
    const header = defangTags(sections.join('\n\n'));

    return [systemMessage, ...transcript, withHeader(currentStateMessage, header)];
  }
}

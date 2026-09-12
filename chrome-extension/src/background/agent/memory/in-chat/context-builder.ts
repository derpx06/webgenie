import { AIMessage, HumanMessage, ToolMessage, type BaseMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '../../types';
import type { TranscriptEntry } from '../../messages/service';

/** Navigator tool turns sent as real messages; older turns are summarized as text. */
const RECENT_TURNS = 5;
const EARLIER_STEPS_CHARS = 1500;
const PLANNER_STEPS_CHARS = 4000;
const STEP_TEXT_CHARS = 200;

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
  private static stateSections(context: AgentContext): string[] {
    const memory = context.memory;
    const sections: string[] = [];
    if (context.taskStartUrl) sections.push(`[TASK STARTED ON]\n${context.taskStartUrl}`);
    const addList = (title: string, lines: string[], maxChars: number) => {
      if (lines.length > 0) sections.push(`[${title}]\n${this.formatLinesWithBudget(lines, maxChars)}`);
    };

    addList('ACTIVE FACTS', memory.getActiveItemsByType('fact').map(item => `- ${item.content}`), 1050);
    addList('ACTIVE CONSTRAINTS', memory.getActiveItemsByType('constraint').map(item => `- ${item.content}`), 750);
    addList('ACTIVE DECISIONS', memory.getActiveItemsByType('decision').map(item => `- ${item.content}`), 750);
    addList('PINNED MEMORY', memory.getActiveItemsByType('pinned').map(item => `- ${item.content}`), 600);
    const progress = memory.progressTracker.getProgressString();
    if (progress !== 'No progress recorded yet.') sections.push(`[PROGRESS STATUS]\n${progress.slice(0, 600)}`);
    addList('COMPLETED EARLIER TASKS', memory.taskArchive.getRecords().map(record => `- "${record.goal}" → ${record.outcome}`), 900);

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

    const progressLines = (context.validatedProgress ?? []).slice(-12).map(record => `- ${record.status}: ${record.summary}`);
    const validatedBlock = progressLines.length > 0
      ? `[VALIDATED PROGRESS]\n${this.formatLinesWithBudget(progressLines, 1000)}`
      : '';
    if (validatedBlock) sections.push(validatedBlock);

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
    const recentTurns = new Set<TranscriptItem>(actor === 'navigator' ? turns.slice(-RECENT_TURNS) : []);

    const transcript: BaseMessage[] = [];
    for (const item of items) {
      if (item.kind === 'user') transcript.push(item.message);
      else if (recentTurns.has(item)) transcript.push(item.ai, ...item.results);
    }

    const sections = this.stateSections(context);
    const olderTurns = turns.filter(turn => !recentTurns.has(turn));
    if (olderTurns.length > 0) {
      sections.push(
        actor === 'planner'
          ? `[Steps so far, oldest first]\n${renderTurnsAsText(olderTurns, PLANNER_STEPS_CHARS)}`
          : `[Earlier steps]\n${renderTurnsAsText(olderTurns, EARLIER_STEPS_CHARS)}`,
      );
    }
    const header = sections.join('\n\n');

    return [systemMessage, ...transcript, withHeader(currentStateMessage, header)];
  }
}

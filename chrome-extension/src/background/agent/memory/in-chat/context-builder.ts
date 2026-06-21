import { SystemMessage } from '@langchain/core/messages';
import type { HumanMessage, BaseMessage } from '@langchain/core/messages';
import type { AgentContext } from '../../types';

export class ContextBuilder {
  private static capCharacters(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '... [truncated due to token limit]';
  }

  private static formatLinesWithBudget(lines: string[], maxChars: number): string {
    if (lines.length === 0) return 'None';
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

  /**
   * Builds the structured context packet for LLM consumption.
   * Ensures raw history is replaced by structured memory state.
   */
  public static buildContextPacket(
    context: AgentContext,
    systemMessage: SystemMessage,
    currentStateMessage: HumanMessage
  ): BaseMessage[] {
    const memory = context.memory;
    const goalManager = memory.goalManager;
    const progressTracker = memory.progressTracker;
    const recentActions = memory.recentActions;

    // 1. Build the goals block (budget ~200 tokens -> 600 chars)
    const rawGoalsBlock = [
      `PRIMARY GOAL: ${goalManager.getPrimaryGoal() || 'None'}`,
      `CURRENT GOAL: ${goalManager.getCurrentGoal() || 'None'}`,
      `CURRENT SUBGOAL: ${goalManager.getCurrentSubgoal() || 'None'}`,
      `GOAL REVISION: ${goalManager.getGoalRevision()}`,
    ].join('\n');
    const goalsBlock = this.capCharacters(rawGoalsBlock, 600);

    // 2. Build the facts block (budget ~350 tokens -> 1050 chars)
    const activeFacts = memory.getActiveItemsByType('fact').map(f => `- ${f.content}`);
    const factsBlock = this.formatLinesWithBudget(activeFacts, 1050);

    // 3. Build the constraints block (budget ~250 tokens -> 750 chars)
    const activeConstraints = memory.getActiveItemsByType('constraint').map(c => `- ${c.content}`);
    const constraintsBlock = this.formatLinesWithBudget(activeConstraints, 750);

    // 4. Build the decisions block (budget ~250 tokens -> 750 chars)
    const activeDecisions = memory.getActiveItemsByType('decision').map(d => `- ${d.content}`);
    const decisionsBlock = this.formatLinesWithBudget(activeDecisions, 750);

    // 5. Build the progress block (budget ~200 tokens -> 600 chars)
    const progressBlock = this.capCharacters(progressTracker.getProgressString(), 600);

    // 6. Build the pinned memory block (budget ~200 tokens -> 600 chars)
    const activePinned = memory.getActiveItemsByType('pinned').map(p => `- ${p.content}`);
    const pinnedBlock = this.formatLinesWithBudget(activePinned, 600);

    // 7. Build the recent actions block (budget ~200 tokens -> 600 chars)
    const actions = recentActions.getActions().map((act, i) => `Step Action ${i + 1}: ${act}`);
    const actionsBlock = this.formatLinesWithBudget(actions, 600);

    // 8. Build the task archive / references block (budget ~300 tokens -> 900 chars)
    const records = memory.taskArchive.getRecords().map(r => `- Goal: "${r.goal}" | Outcome: "${r.outcome}" | Summary: ${r.summary}`);
    const taskArchiveBlock = this.formatLinesWithBudget(records, 900);

    // Assemble the structured memory content
    const memoryStateContent = `
<structured_memory>
[GOAL HIERARCHY]
${goalsBlock}

[ACTIVE FACTS]
${factsBlock}

[ACTIVE CONSTRAINTS]
${constraintsBlock}

[ACTIVE DECISIONS]
${decisionsBlock}

[PROGRESS STATUS]
${progressBlock}

[PINNED SENSITIVE MEMORY]
${pinnedBlock}

[RECENT EXECUTION HISTORY]
${actionsBlock}

[COMPLETED TASK REFERENCES]
${taskArchiveBlock}
</structured_memory>
`.trim();

    const combinedSystemContent = `${systemMessage.content}\n\n${memoryStateContent}`;
    const mergedSystemMessage = new SystemMessage({
      content: combinedSystemContent
    });

    // We build the final message pack:
    // - Merged System Message (instructions + memory state)
    // - Current Browser State (Interactive elements, screenshot, URL)
    return [
      mergedSystemMessage,
      currentStateMessage
    ];
  }
}

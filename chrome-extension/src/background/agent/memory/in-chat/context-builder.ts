import { HumanMessage, type BaseMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '../../types';

export class ContextBuilder {
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

    // 1. Build the goals block
    const goalsBlock = [
      `PRIMARY GOAL: ${goalManager.getPrimaryGoal() || 'None'}`,
      `CURRENT GOAL: ${goalManager.getCurrentGoal() || 'None'}`,
      `CURRENT SUBGOAL: ${goalManager.getCurrentSubgoal() || 'None'}`,
      `GOAL REVISION: ${goalManager.getGoalRevision()}`,
    ].join('\n');

    // 2. Build the facts block
    const activeFacts = memory.getActiveItemsByType('fact');
    const factsBlock = activeFacts.length > 0
      ? activeFacts.map(f => `- ${f.content}`).join('\n')
      : 'None';

    // 3. Build the constraints block
    const activeConstraints = memory.getActiveItemsByType('constraint');
    const constraintsBlock = activeConstraints.length > 0
      ? activeConstraints.map(c => `- ${c.content}`).join('\n')
      : 'None';

    // 4. Build the decisions block
    const activeDecisions = memory.getActiveItemsByType('decision');
    const decisionsBlock = activeDecisions.length > 0
      ? activeDecisions.map(d => `- ${d.content}`).join('\n')
      : 'None';

    // 5. Build the progress block
    const progressBlock = progressTracker.getProgressString();

    // 6. Build the pinned memory block
    const activePinned = memory.getActiveItemsByType('pinned');
    const pinnedBlock = activePinned.length > 0
      ? activePinned.map(p => `- ${p.content}`).join('\n')
      : 'None';

    // 7. Build the recent actions block
    const actions = recentActions.getActions();
    const actionsBlock = actions.length > 0
      ? actions.map((act, i) => `Step Action ${i + 1}: ${act}`).join('\n')
      : 'None';

    // 8. Build the task archive / references block
    const records = memory.taskArchive.getRecords();
    const taskArchiveBlock = records.length > 0
      ? records.map(r => `- Goal: "${r.goal}" | Outcome: "${r.outcome}" | Summary: ${r.summary}`).join('\n')
      : 'None';

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

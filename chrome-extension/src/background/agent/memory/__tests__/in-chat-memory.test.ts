import { describe, it, expect } from 'vitest';
import { GoalManager, ProgressTracker, RecentActionBuffer, InChatMemory, ContextBuilder, TaskArchive, ConversationTimeline, jaroWinklerSimilarity } from '..';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { AgentContext } from '../../types';

describe('GoalManager & Revisions', () => {
  it('tracks Goal Updates, Goal Revisions, and Conflicting Goals', () => {
    const gm = new GoalManager('Buy Dell Laptop');
    expect(gm.getPrimaryGoal()).toBe('Buy Dell Laptop');
    expect(gm.getGoalRevision()).toBe(0);

    // Goal Revision 2: Buy Lenovo Laptop (Conflict with Dell)
    gm.updateGoals('Buy Lenovo Laptop', 'Search Lenovo', 'Compare processors');
    expect(gm.getPrimaryGoal()).toBe('Buy Lenovo Laptop');
    expect(gm.getCurrentGoal()).toBe('Search Lenovo');
    expect(gm.getCurrentSubgoal()).toBe('Compare processors');
    expect(gm.getGoalRevision()).toBe(1);

    // Verify Dell got abandoned/archived
    expect(gm.abandonedGoals.length).toBe(1);
    expect(gm.abandonedGoals[0].content).toBe('Buy Dell Laptop');
    expect(gm.abandonedGoals[0].status).toBe('abandoned');

    // Complete current subgoal
    gm.completeGoal('Compare processors');
    expect(gm.getCurrentSubgoal()).toBe('');
    expect(gm.completedGoals.length).toBe(1);
    expect(gm.completedGoals[0].content).toBe('Compare processors');
    expect(gm.completedGoals[0].status).toBe('completed');
  });
});

describe('InChatMemory Registry & Resolution', () => {
  it('handles Fact Updates, Constraint Updates, Decision Recall, Pinned Memory, and Contradiction Resolution', () => {
    const memory = new InChatMemory('Initial Task');
    
    // Add Facts
    memory.addFact('budget = 80000', 'MEDIUM', 'task-1');
    memory.addFact('budget = 60000', 'MEDIUM', 'task-1'); // Updates budget
    memory.resolveConflicts();

    const activeFacts = memory.getActiveItemsByType('fact');
    expect(activeFacts.length).toBe(1);
    expect(activeFacts[0].content).toBe('budget = 60000');
    expect(activeFacts[0].sourceTaskId).toBe('task-1');

    // Constraint Update overrides
    memory.addConstraint('OS = Linux', 'HIGH');
    memory.addConstraint('OS = Windows', 'HIGH');
    memory.resolveConflicts();

    const activeConstraints = memory.getActiveItemsByType('constraint');
    expect(activeConstraints.length).toBe(1);
    expect(activeConstraints[0].content).toBe('OS = Windows');

    // Decision Recall
    memory.addDecision('selected = Lenovo T14 because of battery', 'HIGH');
    expect(memory.getActiveItemsByType('decision')[0].content).toContain('Lenovo T14');

    // Pinned Memory Persistence
    memory.addPinned('OTP = 998877', 'CRITICAL');
    expect(memory.getActiveItemsByType('pinned')[0].content).toBe('OTP = 998877');
  });

  it('runs timeline tracking on fact and decision updates', () => {
    const memory = new InChatMemory('Task Timeline');
    memory.addFact('city = Pune');
    memory.addDecision('hotel = Marriott');

    const events = memory.timeline.getEvents();
    expect(events.some(e => e.type === 'FACT_UPDATED')).toBe(true);
    expect(events.some(e => e.type === 'DECISION_MADE')).toBe(true);
  });
});

describe('Compression Safety & Context Packet Generation', () => {
  it('protects structured items from compression and formats Context Packet correctly', () => {
    const mockContext = {
      memory: new InChatMemory('Task Goal'),
    } as unknown as AgentContext;

    const memory = mockContext.memory;
    memory.addFact('user = Bob', 'MEDIUM');
    memory.addConstraint('avoid HP', 'HIGH');
    memory.addDecision('chosen = Mac', 'HIGH');
    memory.addPinned('Token = abc', 'CRITICAL');
    memory.progressTracker.updateProgress(['step A'], ['step C'], ['step B']);
    memory.recentActions.pushAction('clicked button');

    // Build context packet
    const systemMsg = new SystemMessage('System instructions');
    const stateMsg = new HumanMessage('Interactive page elements');

    const [mergedSystem, state] = ContextBuilder.buildContextPacket(mockContext, systemMsg, stateMsg);
    expect(state).toBe(stateMsg);

    const content = mergedSystem.content;
    expect(content).toContain('PRIMARY GOAL: Task Goal');
    expect(content).toContain('- user = Bob');
    expect(content).toContain('- avoid HP');
    expect(content).toContain('- chosen = Mac');
    expect(content).toContain('- Token = abc');
    expect(content).toContain('Completed: * step A');
    expect(content).toContain('Step Action 1: clicked button');
  });
});

describe('Simulations (300-Step & 15-Task)', () => {
  it('runs a 300-step conversation simulation successfully', () => {
    const memory = new InChatMemory('Long Running Task');
    
    // Simulate 300 steps of executing actions
    for (let i = 1; i <= 300; i++) {
      memory.recentActions.pushAction(`action ${i}`);
      if (i % 50 === 0) {
        memory.addFact(`stepCheckpoint = ${i}`, 'MEDIUM');
        memory.resolveConflicts();
      }
    }

    // Recent action buffer must only hold the last 5 actions
    const actions = memory.recentActions.getActions();
    expect(actions.length).toBe(5);
    expect(actions[4]).toBe('action 300');
    expect(actions[0]).toBe('action 296');

    // Facts must be resolved and keep only the latest checkpoint
    const activeFacts = memory.getActiveItemsByType('fact');
    expect(activeFacts.length).toBe(1);
    expect(activeFacts[0].content).toBe('stepCheckpoint = 300');
  });

  it('runs a 15-task conversation simulation successfully', () => {
    const memory = new InChatMemory('15-Task Conversation');

    for (let taskNum = 1; taskNum <= 15; taskNum++) {
      // Task Start
      memory.addTimelineEvent('TASK_STARTED', `Starting task #${taskNum}`, { taskNum });
      
      // Update goal
      memory.goalManager.updateGoals(`Primary Task Goal ${taskNum}`, `Goal ${taskNum}`, `Subgoal ${taskNum}`);
      
      // Perform actions & store outcome
      memory.addFact(`fact_from_task_${taskNum} = success`, 'MEDIUM');
      memory.addDecision(`decision_in_task_${taskNum} = complete`, 'HIGH');
      
      // Archive task outcome
      memory.taskArchive.addRecord({
        taskId: `task-id-${taskNum}`,
        goal: `Goal ${taskNum}`,
        outcome: `Result of task ${taskNum}`,
        decisions: [`decision_in_task_${taskNum} = complete`],
        facts: [`fact_from_task_${taskNum} = success`],
        summary: `Task #${taskNum} summary`
      });

      memory.addTimelineEvent('TASK_COMPLETED', `Completed task #${taskNum}`, { taskNum });
    }

    // Verify task archive has exactly 15 records
    const records = memory.taskArchive.getRecords();
    expect(records.length).toBe(15);
    expect(records[0].taskId).toBe('task-id-1');
    expect(records[14].taskId).toBe('task-id-15');

    // Verify timeline contains all execution events
    const events = memory.timeline.getEvents();
    expect(events.filter(e => e.type === 'TASK_STARTED').length).toBe(15);
    expect(events.filter(e => e.type === 'TASK_COMPLETED').length).toBe(15);
  });
});

describe('Jaro-Winkler String Similarity & Semantic Deduplication', () => {
  it('correctly calculates Jaro-Winkler similarity scores', () => {
    expect(jaroWinklerSimilarity('hello', 'hello')).toBe(1.0);
    expect(jaroWinklerSimilarity('martha', 'marhta')).toBeGreaterThan(0.9);
    expect(jaroWinklerSimilarity('abc', 'xyz')).toBe(0.0);
  });

  it('semantically deduplicates facts and decisions with high similarity', () => {
    const memory = new InChatMemory('Semantic Deduplication Test');
    
    // Add two semantically very similar facts
    memory.addFact('the budget is about $500', 'MEDIUM');
    memory.addFact('the budget is around $500', 'MEDIUM');
    
    memory.resolveConflicts();
    const activeFacts = memory.getActiveItemsByType('fact');
    expect(activeFacts.length).toBe(1);
    expect(activeFacts[0].content).toBe('the budget is around $500');

    // Add two different facts (similarity <= 0.85)
    memory.addFact('select Lenovo laptop', 'MEDIUM');
    memory.addFact('avoid Dell desktop', 'MEDIUM');

    memory.resolveConflicts();
    const allFacts = memory.getActiveItemsByType('fact');
    expect(allFacts.length).toBe(3); // Consolidated budget fact + 2 distinct facts
  });
});

describe('FailureRegistry Selector Blocking & Prompt Annotation', () => {
  it('registers failures and flags blocked selectors', () => {
    const mockBrowserContext = {} as any;
    const mockMessageManager = {} as any;
    const mockEventManager = {} as any;
    
    const context = new AgentContext(
      'task-id',
      mockBrowserContext,
      mockMessageManager,
      mockEventManager,
      {}
    );

    const selector = 'button-checkout';
    const url = 'https://example.com/checkout';

    expect(context.isSelectorBlocked(selector, url)).toBe(false);

    // Register first failure
    context.registerFailure(selector, url, 'click_element');
    expect(context.isSelectorBlocked(selector, url)).toBe(false);

    // Register second failure (reaches FAILURE_THRESHOLD)
    context.registerFailure(selector, url, 'click_element');
    expect(context.isSelectorBlocked(selector, url)).toBe(true);

    // Check mapping serialization/deserialization
    const serialized = context.memory.toJSON();
    expect(serialized.failureRegistry).toBeDefined();

    const newMemory = new InChatMemory('Deserialized Memory');
    newMemory.fromJSON(serialized);
    expect(newMemory.failureRegistry.get(`${url}|${selector}`)).toBeDefined();
    expect(newMemory.failureRegistry.get(`${url}|${selector}`)?.failCount).toBe(2);
  });
});

describe('ContextBuilder Token Budgeting & Safeguards', () => {
  it('truncates sections when exceeding character budget limits', () => {
    const mockContext = {
      memory: new InChatMemory('Task Goal'),
    } as unknown as AgentContext;

    const memory = mockContext.memory;
    // Add many facts directly to bypass Jaro-Winkler semantic deduplication
    for (let i = 0; i < 50; i++) {
      memory.addItem('fact', `completely unique fact content representing distinct knowledge item index ${i} to fill the buffer`, 'MEDIUM');
    }

    const systemMsg = new SystemMessage('System instructions');
    const stateMsg = new HumanMessage('Interactive page elements');

    const [mergedSystem] = ContextBuilder.buildContextPacket(mockContext, systemMsg, stateMsg);
    const content = mergedSystem.content;

    // Verify it is truncated with the budget warning suffix
    expect(content).toContain('truncated due to token budget');
  });
});

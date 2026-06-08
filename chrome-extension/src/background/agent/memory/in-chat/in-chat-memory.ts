import { GoalManager } from './goal-manager';
import { ProgressTracker } from './progress-tracker';
import { RecentActionBuffer } from './recent-actions';
import { TaskArchive } from './task-archive';
import { ConversationTimeline, type TimelineEventType } from './conversation-timeline';
import type { MemoryItem } from './types';
import { createLogger } from '../../../log';

const logger = createLogger('Memory');

export class InChatMemory {
  public goalManager: GoalManager;
  public progressTracker: ProgressTracker;
  public recentActions: RecentActionBuffer;
  public taskArchive: TaskArchive;
  public timeline: ConversationTimeline;
  private items: MemoryItem[] = [];

  constructor(primaryGoal = '') {
    this.goalManager = new GoalManager(primaryGoal);
    this.progressTracker = new ProgressTracker();
    this.recentActions = new RecentActionBuffer(5);
    this.taskArchive = new TaskArchive();
    this.timeline = new ConversationTimeline();

    // Wire goal changed events to the timeline
    this.goalManager.onGoalChanged = (description, metadata) => {
      this.addTimelineEvent('GOAL_CHANGED', description, metadata);
    };
  }

  public getItems(): MemoryItem[] {
    return [...this.items];
  }

  public getActiveItems(): MemoryItem[] {
    return this.items.filter(item => item.active);
  }

  public getActiveItemsByType(type: MemoryItem['type']): MemoryItem[] {
    return this.items.filter(item => item.active && item.type === type);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  public addTimelineEvent(type: TimelineEventType, description: string, metadata?: Record<string, any>): void {
    this.timeline.addEvent(type, description, metadata);
    logger.info(`[Timeline] [${type}] ${description}`);
  }

  public addItem(
    type: MemoryItem['type'],
    content: string,
    importance: MemoryItem['importance'],
    confidence = 1.0,
    sourceTaskId?: string
  ): MemoryItem {
    const existing = this.items.find(
      item => item.active && item.type === type && item.content.toLowerCase().trim() === content.toLowerCase().trim()
    );
    if (existing) {
      existing.updatedAt = Date.now();
      existing.confidence = confidence;
      if (sourceTaskId) existing.sourceTaskId = sourceTaskId;
      return existing;
    }

    const newItem: MemoryItem = {
      id: this.generateId(),
      type,
      content,
      importance,
      active: true,
      confidence,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceTaskId,
    };

    this.items.push(newItem);
    return newItem;
  }

  public addFact(content: string, importance: MemoryItem['importance'] = 'MEDIUM', sourceTaskId?: string): void {
    const isNew = !this.items.some(
      item => item.active && item.type === 'fact' && item.content.toLowerCase().trim() === content.toLowerCase().trim()
    );
    this.addItem('fact', content, importance, 1.0, sourceTaskId);
    if (isNew) {
      this.addTimelineEvent('FACT_UPDATED', `Fact added/updated: ${content}`, { sourceTaskId });
    }
  }

  public addConstraint(content: string, importance: MemoryItem['importance'] = 'HIGH', sourceTaskId?: string): void {
    this.addItem('constraint', content, importance, 1.0, sourceTaskId);
  }

  public addDecision(content: string, importance: MemoryItem['importance'] = 'HIGH', sourceTaskId?: string): void {
    const isNew = !this.items.some(
      item => item.active && item.type === 'decision' && item.content.toLowerCase().trim() === content.toLowerCase().trim()
    );
    this.addItem('decision', content, importance, 1.0, sourceTaskId);
    if (isNew) {
      this.addTimelineEvent('DECISION_MADE', `Decision made: ${content}`, { sourceTaskId });
    }
  }

  public addPinned(content: string, importance: MemoryItem['importance'] = 'CRITICAL', sourceTaskId?: string): void {
    this.addItem('pinned', content, importance, 1.0, sourceTaskId);
  }

  /**
   * Resolves contradictory memory items by deactivating superseded items.
   * Compares items that represent the same semantic slot/key.
   */
  public resolveConflicts(): void {
    const slots = new Map<string, MemoryItem>();

    // Map each item with its original index
    const indexedItems = this.items.map((item, index) => ({ item, index }));

    // Process from newest to oldest (higher index/updatedAt first)
    const sorted = indexedItems.sort((a, b) => {
      if (b.item.updatedAt !== a.item.updatedAt) {
        return b.item.updatedAt - a.item.updatedAt;
      }
      return b.index - a.index;
    });

    for (const { item } of sorted) {
      if (!item.active) continue;

      // Extract slot/key if content follows a pattern like "budget = 80000" or "budget: 80000"
      const match = item.content.match(/^([a-zA-Z0-9_\-\s]+)\s*(?:=|:|is|set to)\s*(.+)$/i);
      if (match) {
        const slotKey = match[1].trim().toLowerCase();
        if (slots.has(slotKey)) {
          // Deactivate the older conflicting item
          item.active = false;
        } else {
          slots.set(slotKey, item);
        }
      }
    }
  }

  /**
   * Import memory states extracted from the Navigator's response
   */
  public importFromLLMResponse(currentState: any, sourceTaskId?: string): void {
    if (!currentState) return;

    if (Array.isArray(currentState.extracted_facts)) {
      for (const fact of currentState.extracted_facts) {
        if (fact) this.addFact(fact, 'MEDIUM', sourceTaskId);
      }
    }

    if (Array.isArray(currentState.extracted_constraints)) {
      for (const constraint of currentState.extracted_constraints) {
        if (constraint) this.addConstraint(constraint, 'HIGH', sourceTaskId);
      }
    }

    if (Array.isArray(currentState.extracted_decisions)) {
      for (const decision of currentState.extracted_decisions) {
        if (decision) this.addDecision(decision, 'HIGH', sourceTaskId);
      }
    }

    if (Array.isArray(currentState.pinned_items)) {
      for (const pinned of currentState.pinned_items) {
        if (pinned) this.addPinned(pinned, 'CRITICAL', sourceTaskId);
      }
    }

    // Update Progress
    if (
      currentState.progress_completed !== undefined ||
      currentState.progress_remaining !== undefined ||
      currentState.progress_current !== undefined
    ) {
      this.progressTracker.updateProgress(
        currentState.progress_completed,
        currentState.progress_remaining,
        currentState.progress_current
      );
    }

    // De-duplicate/supersede conflicting items
    this.resolveConflicts();
  }

  public toJSON() {
    return {
      goals: this.goalManager.toJSON(),
      progress: this.progressTracker.toJSON(),
      recentActions: this.recentActions.toJSON(),
      taskArchive: this.taskArchive.toJSON(),
      timeline: this.timeline.toJSON(),
      items: this.items,
    };
  }

  public fromJSON(data: any): void {
    if (!data) return;
    if (data.goals) this.goalManager.fromJSON(data.goals);
    if (data.progress) this.progressTracker.fromJSON(data.progress);
    if (data.recentActions) this.recentActions.fromJSON(data.recentActions);
    if (data.taskArchive) this.taskArchive.fromJSON(data.taskArchive);
    if (data.timeline) this.timeline.fromJSON(data.timeline);
    if (Array.isArray(data.items)) {
      this.items = [...data.items];
    }
  }
}

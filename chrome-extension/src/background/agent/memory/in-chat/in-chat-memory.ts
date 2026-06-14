import { GoalManager } from './goal-manager';
import { ProgressTracker } from './progress-tracker';
import { RecentActionBuffer } from './recent-actions';
import { TaskArchive } from './task-archive';
import { ConversationTimeline, type TimelineEventType } from './conversation-timeline';
import type { MemoryItem } from './types';
import type { FailureRecord } from '../../types';
import { createLogger } from '../../../log';

const logger = createLogger('Memory');

export function jaroWinklerSimilarity(s1: string, s2: string): number {
  s1 = s1.trim().toLowerCase();
  s2 = s2.trim().toLowerCase();
  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(len2, i + matchWindow + 1);
    for (let j = start; j < end; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (s1Matches[i]) {
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefixLen = 0;
  const maxPrefix = Math.min(4, Math.min(len1, len2));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLen++;
    } else {
      break;
    }
  }

  const p = 0.1;
  return jaro + prefixLen * p * (1 - jaro);
}

export class InChatMemory {
  public goalManager: GoalManager;
  public progressTracker: ProgressTracker;
  public recentActions: RecentActionBuffer;
  public taskArchive: TaskArchive;
  public timeline: ConversationTimeline;
  public failureRegistry: Map<string, FailureRecord>;
  private items: MemoryItem[] = [];

  constructor(primaryGoal = '') {
    this.goalManager = new GoalManager(primaryGoal);
    this.progressTracker = new ProgressTracker();
    this.recentActions = new RecentActionBuffer(5);
    this.taskArchive = new TaskArchive();
    this.timeline = new ConversationTimeline();
    this.failureRegistry = new Map<string, FailureRecord>();

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
    const existing = this.items.find(
      item => item.active && item.type === 'fact' && jaroWinklerSimilarity(item.content, content) > 0.85
    );

    if (existing) {
      const wasDifferent = existing.content !== content;
      existing.content = content;
      existing.updatedAt = Date.now();
      if (sourceTaskId) existing.sourceTaskId = sourceTaskId;
      if (wasDifferent) {
        this.addTimelineEvent('FACT_UPDATED', `Fact consolidated: ${content}`, { sourceTaskId });
      }
    } else {
      this.addItem('fact', content, importance, 1.0, sourceTaskId);
      this.addTimelineEvent('FACT_UPDATED', `Fact added: ${content}`, { sourceTaskId });
    }
  }

  public addConstraint(content: string, importance: MemoryItem['importance'] = 'HIGH', sourceTaskId?: string): void {
    this.addItem('constraint', content, importance, 1.0, sourceTaskId);
  }

  public addDecision(content: string, importance: MemoryItem['importance'] = 'HIGH', sourceTaskId?: string): void {
    const existing = this.items.find(
      item => item.active && item.type === 'decision' && jaroWinklerSimilarity(item.content, content) > 0.85
    );

    if (existing) {
      existing.content = content;
      existing.updatedAt = Date.now();
      if (sourceTaskId) existing.sourceTaskId = sourceTaskId;
    } else {
      this.addItem('decision', content, importance, 1.0, sourceTaskId);
      this.addTimelineEvent('DECISION_MADE', `Decision made: ${content}`, { sourceTaskId });
    }
  }

  public addPinned(content: string, importance: MemoryItem['importance'] = 'CRITICAL', sourceTaskId?: string): void {
    this.addItem('pinned', content, importance, 1.0, sourceTaskId);
  }

  /**
   * Resolves contradictory memory items by deactivating superseded items.
   * Compares items that represent the same semantic slot/key and semantically similar items.
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

    const activeFacts: MemoryItem[] = [];
    const activeConstraints: MemoryItem[] = [];
    const activeDecisions: MemoryItem[] = [];

    for (const { item } of sorted) {
      if (!item.active) continue;

      // 1. Slot-key regex conflict resolution
      const match = item.content.match(/^([a-zA-Z0-9_\-\s]+)\s*(?:=|:|is|set to)\s*(.+)$/i);
      if (match) {
        const slotKey = match[1].trim().toLowerCase();
        if (slots.has(slotKey)) {
          item.active = false;
          continue;
        } else {
          slots.set(slotKey, item);
        }
      }

      // 2. Semantic Jaro-Winkler similarity deduplication
      if (item.type === 'fact') {
        const similar = activeFacts.find(f => jaroWinklerSimilarity(f.content, item.content) > 0.85);
        if (similar) {
          item.active = false;
          continue;
        }
        activeFacts.push(item);
      } else if (item.type === 'constraint') {
        const similar = activeConstraints.find(c => jaroWinklerSimilarity(c.content, item.content) > 0.85);
        if (similar) {
          item.active = false;
          continue;
        }
        activeConstraints.push(item);
      } else if (item.type === 'decision') {
        const similar = activeDecisions.find(d => jaroWinklerSimilarity(d.content, item.content) > 0.85);
        if (similar) {
          item.active = false;
          continue;
        }
        activeDecisions.push(item);
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
      failureRegistry: Array.from(this.failureRegistry.entries()),
    };
  }

  public fromJSON(data: any): void {
    if (!data) return;
    if (data.goals) this.goalManager.fromJSON(data.goals);
    if (data.progress) this.progressTracker.fromJSON(data.progress);
    if (data.recentActions) this.recentActions.fromJSON(data.recentActions);
    if (data.taskArchive) this.taskArchive.fromJSON(data.taskArchive);
    if (data.timeline) this.timeline.fromJSON(data.timeline);
    if (Array.isArray(data.failureRegistry)) {
      this.failureRegistry.clear();
      for (const [key, val] of data.failureRegistry) {
        this.failureRegistry.set(key, val);
      }
    }
    if (Array.isArray(data.items)) {
      this.items = [...data.items];
    }
  }
}

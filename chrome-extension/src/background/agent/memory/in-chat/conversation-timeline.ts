export type TimelineEventType =
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'GOAL_CHANGED'
  | 'DECISION_MADE'
  | 'FACT_UPDATED';

export interface TimelineEvent {
  type: TimelineEventType;
  description: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export class ConversationTimeline {
  private events: TimelineEvent[] = [];

  public addEvent(type: TimelineEventType, description: string, metadata?: Record<string, any>): void {
    this.events.push({
      type,
      description,
      timestamp: Date.now(),
      metadata,
    });
  }

  public getEvents(): TimelineEvent[] {
    return [...this.events];
  }

  public toJSON(): TimelineEvent[] {
    return this.events;
  }

  public fromJSON(data: any): void {
    if (Array.isArray(data)) {
      this.events = [...data];
    }
  }
}

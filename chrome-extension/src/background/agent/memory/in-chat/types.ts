export interface Goal {
  id: string;
  content: string;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: number;
  completedAt?: number;
}

export interface MemoryItem {
  id: string;
  type: 'fact' | 'constraint' | 'decision' | 'progress' | 'goal' | 'pinned';
  content: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  active: boolean;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  sourceTaskId?: string;
  metadata?: Record<string, any>;
}

export type UserIntent =
  | 'CONTINUE_TASK'
  | 'MODIFY_TASK'
  | 'NEW_TASK'
  | 'QUESTION'
  | 'REFERENCE_PREVIOUS_TASK';

export interface GoalContext {
  primaryGoal: string;
  currentGoal: string;
  currentSubgoal: string;
  goalRevision: number;
  completedGoals: Goal[];
  abandonedGoals: Goal[];
  archivedGoals: {
    primaryGoal: string;
    currentGoal: string;
    currentSubgoal: string;
    goalRevision: number;
    archivedAt: number;
  }[];
}

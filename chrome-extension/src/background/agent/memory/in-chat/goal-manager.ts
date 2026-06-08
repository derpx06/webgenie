import type { Goal, GoalContext } from './types';

export class GoalManager {
  public primaryGoal: string = '';
  public currentGoal: string = '';
  public currentSubgoal: string = '';
  public goalRevision: number = 0;
  public completedGoals: Goal[] = [];
  public abandonedGoals: Goal[] = [];

  public onGoalChanged?: (description: string, metadata?: Record<string, any>) => void;

  constructor(primaryGoal = '') {
    if (primaryGoal) {
      this.primaryGoal = primaryGoal;
      this.currentGoal = primaryGoal;
      this.currentSubgoal = 'Initialize task execution';
    }
  }

  public getPrimaryGoal(): string {
    return this.primaryGoal;
  }

  public getCurrentGoal(): string {
    return this.currentGoal;
  }

  public getCurrentSubgoal(): string {
    return this.currentSubgoal;
  }

  public getGoalRevision(): number {
    return this.goalRevision;
  }

  public completeGoal(content: string): void {
    const cleanContent = content.trim().toLowerCase();
    if (this.currentSubgoal.trim().toLowerCase() === cleanContent) {
      const g: Goal = {
        id: Math.random().toString(36).substring(2, 11),
        content: this.currentSubgoal,
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      this.completedGoals.push(g);
      this.currentSubgoal = '';
      this.triggerChange(`Subgoal completed: ${content}`);
    } else if (this.currentGoal.trim().toLowerCase() === cleanContent) {
      const g: Goal = {
        id: Math.random().toString(36).substring(2, 11),
        content: this.currentGoal,
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      this.completedGoals.push(g);
      this.currentGoal = '';
      this.triggerChange(`Current goal completed: ${content}`);
    }
  }

  public updateGoals(primary?: string, current?: string, subgoal?: string): void {
    let changed = false;
    const oldPrimary = this.primaryGoal;
    const oldCurrent = this.currentGoal;
    const oldSubgoal = this.currentSubgoal;

    if (primary !== undefined && primary !== this.primaryGoal) {
      // Conflicting primary goal cannot remain active!
      if (this.primaryGoal) {
        this.abandonActiveGoal(this.primaryGoal, 'Primary goal changed / superseded');
      }
      this.primaryGoal = primary;
      changed = true;
    }

    if (current !== undefined && current !== this.currentGoal) {
      if (this.currentGoal) {
        this.abandonActiveGoal(this.currentGoal, 'Current goal changed / superseded');
      }
      this.currentGoal = current;
      changed = true;
    }

    if (subgoal !== undefined && subgoal !== this.currentSubgoal) {
      if (this.currentSubgoal) {
        this.abandonActiveGoal(this.currentSubgoal, 'Current subgoal changed / superseded');
      }
      this.currentSubgoal = subgoal;
      changed = true;
    }

    if (changed) {
      this.goalRevision++;
      const desc = `Goals updated: Primary="${this.primaryGoal}", Current="${this.currentGoal}", Subgoal="${this.currentSubgoal}" (Revision ${this.goalRevision})`;
      this.triggerChange(desc, {
        primaryGoal: this.primaryGoal,
        currentGoal: this.currentGoal,
        currentSubgoal: this.currentSubgoal,
        goalRevision: this.goalRevision,
      });
    }
  }

  private abandonActiveGoal(content: string, reason: string): void {
    if (!content || content === 'Initialize task execution') return;
    if (this.abandonedGoals.some(g => g.content === content)) return;
    const g: Goal = {
      id: Math.random().toString(36).substring(2, 11),
      content,
      status: 'abandoned',
      createdAt: Date.now(),
      completedAt: Date.now(),
    };
    this.abandonedGoals.push(g);
  }

  private triggerChange(description: string, metadata?: Record<string, any>): void {
    if (this.onGoalChanged) {
      this.onGoalChanged(description, metadata);
    }
  }

  public toJSON(): GoalContext {
    return {
      primaryGoal: this.primaryGoal,
      currentGoal: this.currentGoal,
      currentSubgoal: this.currentSubgoal,
      goalRevision: this.goalRevision,
      completedGoals: this.completedGoals,
      abandonedGoals: this.abandonedGoals,
      archivedGoals: this.abandonedGoals.map(g => ({
        primaryGoal: g.content,
        currentGoal: '',
        currentSubgoal: '',
        goalRevision: this.goalRevision,
        archivedAt: g.completedAt || Date.now(),
      })),
    };
  }

  public fromJSON(data: Partial<GoalContext>): void {
    if (!data) return;
    if (data.primaryGoal !== undefined) this.primaryGoal = data.primaryGoal;
    if (data.currentGoal !== undefined) this.currentGoal = data.currentGoal;
    if (data.currentSubgoal !== undefined) this.currentSubgoal = data.currentSubgoal;
    if (data.goalRevision !== undefined) this.goalRevision = data.goalRevision;
    if (data.completedGoals !== undefined) this.completedGoals = [...data.completedGoals];
    if (data.abandonedGoals !== undefined) this.abandonedGoals = [...data.abandonedGoals];
  }
}

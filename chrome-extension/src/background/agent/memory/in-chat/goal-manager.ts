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
    if (!content) return;
    const cleanContent = content.trim().toLowerCase();
    
    const isSubgoalMatch = this.currentSubgoal && (
      this.currentSubgoal.trim().toLowerCase() === cleanContent ||
      this.calculateSimilarity(this.currentSubgoal, content) >= 0.82
    );

    const isCurrentGoalMatch = this.currentGoal && (
      this.currentGoal.trim().toLowerCase() === cleanContent ||
      this.calculateSimilarity(this.currentGoal, content) >= 0.82
    );

    if (isSubgoalMatch) {
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
    } else if (isCurrentGoalMatch) {
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
        const isSemanticMatch = this.calculateSimilarity(this.primaryGoal, primary) >= 0.82;
        if (!isSemanticMatch) {
          this.abandonActiveGoal(this.primaryGoal, 'Primary goal changed / superseded');
        }
      }
      this.primaryGoal = primary;
      changed = true;
    }

    if (current !== undefined && current !== this.currentGoal) {
      if (this.currentGoal) {
        const isSemanticMatch = this.calculateSimilarity(this.currentGoal, current) >= 0.82;
        if (!isSemanticMatch) {
          this.abandonActiveGoal(this.currentGoal, 'Current goal changed / superseded');
        }
      }
      this.currentGoal = current;
      changed = true;
    }

    if (subgoal !== undefined && subgoal !== this.currentSubgoal) {
      if (this.currentSubgoal) {
        const isSemanticMatch = this.calculateSimilarity(this.currentSubgoal, subgoal) >= 0.82;
        if (!isSemanticMatch) {
          this.abandonActiveGoal(this.currentSubgoal, 'Current subgoal changed / superseded');
        }
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

  private calculateSimilarity(s1: string, s2: string): number {
    s1 = s1.trim().toLowerCase();
    s2 = s2.trim().toLowerCase();
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    // Common English stop words to filter out for cleaner token matching
    const STOP_WORDS = new Set(['the', 'a', 'an', 'on', 'of', 'to', 'for', 'with', 'at', 'by', 'from', 'and', 'or', 'in', 'is', 'are', 'that', 'this']);

    // 1. Check Jaccard Token similarity
    const cleanTokens = (str: string) =>
      str.replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(token => token && !STOP_WORDS.has(token));
        
    const set1 = new Set(cleanTokens(s1));
    const set2 = new Set(cleanTokens(s2));
    
    if (set1.size > 0 && set2.size > 0) {
      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      const jaccard = intersection.size / union.size;
      // If tokens match closely (e.g. >= 0.8), return high similarity
      if (jaccard >= 0.8) return jaccard;
    }

    // 2. Fallback to Jaro-Winkler character-level similarity
    return this.jaroWinkler(s1, s2);
  }

  private jaroWinkler(s1: string, s2: string): number {
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

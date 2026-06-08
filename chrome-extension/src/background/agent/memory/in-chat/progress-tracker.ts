export class ProgressTracker {
  private completed: string[] = [];
  private remaining: string[] = [];
  private current: string[] = [];

  public getCompleted(): string[] {
    return [...this.completed];
  }

  public getRemaining(): string[] {
    return [...this.remaining];
  }

  public getCurrent(): string[] {
    return [...this.current];
  }

  public updateProgress(completed?: string[], remaining?: string[], current?: string[]): void {
    if (completed !== undefined) {
      this.completed = [...completed];
    }
    if (remaining !== undefined) {
      this.remaining = [...remaining];
    }
    if (current !== undefined) {
      this.current = [...current];
    }
  }

  public getProgressString(): string {
    const lines: string[] = [];
    if (this.completed.length > 0) {
      lines.push(`Completed: ${this.completed.map(item => `* ${item}`).join(', ')}`);
    }
    if (this.current.length > 0) {
      lines.push(`Currently working on: ${this.current.map(item => `* ${item}`).join(', ')}`);
    }
    if (this.remaining.length > 0) {
      lines.push(`Remaining: ${this.remaining.map(item => `* ${item}`).join(', ')}`);
    }
    return lines.join('\n') || 'No progress recorded yet.';
  }

  public toJSON() {
    return {
      completed: this.completed,
      remaining: this.remaining,
      current: this.current,
    };
  }

  public fromJSON(data: { completed?: string[]; remaining?: string[]; current?: string[] }): void {
    if (data.completed) this.completed = [...data.completed];
    if (data.remaining) this.remaining = [...data.remaining];
    if (data.current) this.current = [...data.current];
  }
}

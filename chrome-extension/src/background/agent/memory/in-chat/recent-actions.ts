export class RecentActionBuffer {
  private actions: string[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 5) {
    this.maxSize = maxSize;
  }

  public pushAction(action: string): void {
    if (!action) return;
    this.actions.push(action);
    if (this.actions.length > this.maxSize) {
      this.actions.shift();
    }
  }

  public getActions(): string[] {
    return [...this.actions];
  }

  public clear(): void {
    this.actions = [];
  }

  public toJSON() {
    return {
      actions: this.actions,
      maxSize: this.maxSize,
    };
  }

  public fromJSON(data: { actions?: string[]; maxSize?: number }): void {
    if (data.actions) this.actions = [...data.actions];
  }
}

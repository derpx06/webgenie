/** A finished task of this conversation, kept in memory only so follow-ups can refer to earlier answers. */
export interface TaskRecord {
  taskId: string;
  goal: string;
  outcome: string;
}

export class TaskArchive {
  private records: TaskRecord[] = [];

  public addRecord(record: TaskRecord): void {
    this.records.push(record);
  }

  public getRecords(): TaskRecord[] {
    return [...this.records];
  }
}

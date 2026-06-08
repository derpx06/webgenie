export interface TaskRecord {
  taskId: string;
  goal: string;
  outcome: string;
  decisions: string[];
  facts: string[];
  summary: string;
}

export class TaskArchive {
  private records: TaskRecord[] = [];

  public addRecord(record: TaskRecord): void {
    this.records.push(record);
  }

  public getRecords(): TaskRecord[] {
    return [...this.records];
  }

  public toJSON(): TaskRecord[] {
    return this.records;
  }

  public fromJSON(data: any): void {
    if (Array.isArray(data)) {
      this.records = [...data];
    }
  }
}

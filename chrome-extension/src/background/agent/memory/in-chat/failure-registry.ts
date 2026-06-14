export interface FailureRecord {
  selector: string;
  url: string;
  actionType: string;
  failCount: number;
  lastFailTimestamp: number;
}

export class FailureRegistry {
  private records: Map<string, FailureRecord> = new Map();

  private getRecordKey(url: string, selector: string, actionType: string): string {
    const domain = this.extractDomain(url);
    return `${domain}::${selector}::${actionType}`;
  }

  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return url;
    }
  }

  /**
   * Register a failed action attempt on a selector.
   */
  public registerFailure(url: string, selector: string, actionType: string): void {
    if (!selector) return;
    const key = this.getRecordKey(url, selector, actionType);
    const existing = this.records.get(key);
    if (existing) {
      existing.failCount += 1;
      existing.lastFailTimestamp = Date.now();
    } else {
      this.records.set(key, {
        selector,
        url,
        actionType,
        failCount: 1,
        lastFailTimestamp: Date.now(),
      });
    }
  }

  /**
   * Check if a selector on a specific URL domain is blocked (failed >= 2 times).
   */
  public isBlocked(url: string, selector: string): boolean {
    if (!selector) return false;
    const domain = this.extractDomain(url);
    for (const [key, record] of this.records.entries()) {
      if (
        key.startsWith(`${domain}::${selector}::`) &&
        record.failCount >= 2
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clear the failure registry (e.g. for a new task session).
   */
  public clear(): void {
    this.records.clear();
  }

  public toJSON() {
    return Array.from(this.records.entries());
  }

  public fromJSON(data: any): void {
    if (Array.isArray(data)) {
      this.records = new Map(data);
    }
  }
}

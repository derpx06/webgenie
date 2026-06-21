import Dexie from 'dexie';
import type { IStorageProvider } from './IStorageProvider';

export class WebGenieDB extends Dexie {
  keyValues!: Dexie.Table<{ key: string, value: any }, string>;

  constructor() {
    super('WebGenieEnterpriseDB');
    this.version(1).stores({
      keyValues: 'key' // Primary key is 'key'
    });
  }
}

export class IndexedDBStorageProvider implements IStorageProvider {
  private db: WebGenieDB;

  constructor() {
    this.db = new WebGenieDB();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const record = await this.db.keyValues.get(key);
      return record ? (record.value as T) : null;
    } catch (error) {
      console.error(`[IndexedDBStorageProvider] Failed to get key: ${key}`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await this.db.keyValues.put({ key, value });
    } catch (error) {
      console.error(`[IndexedDBStorageProvider] Failed to set key: ${key}`, error);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.db.keyValues.delete(key);
    } catch (error) {
      console.error(`[IndexedDBStorageProvider] Failed to remove key: ${key}`, error);
    }
  }
}

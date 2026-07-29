import { IndexedDBStorageProvider } from '../../adapters/IndexedDBStorageProvider';
import type { TraceEvent } from './types';

interface KeyValueStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

function makeId(): string {
  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function traceKey(taskId: string): string {
  return `agent:trace:${taskId}`;
}

export class TraceStore {
  constructor(private readonly storage: KeyValueStorage = new IndexedDBStorageProvider()) {}

  async append(event: Omit<TraceEvent, 'id'> & { id?: string }): Promise<TraceEvent> {
    const fullEvent: TraceEvent = {
      ...event,
      id: event.id ?? makeId(),
    };
    const events = await this.list(fullEvent.taskId);
    events.push(fullEvent);
    await this.storage.set(traceKey(fullEvent.taskId), events);
    return fullEvent;
  }

  async list(taskId: string): Promise<TraceEvent[]> {
    return (await this.storage.get<TraceEvent[]>(traceKey(taskId))) ?? [];
  }
}

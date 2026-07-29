import { IndexedDBStorageProvider } from '../../adapters/IndexedDBStorageProvider';
import type { TaskCheckpoint } from './types';

interface KeyValueStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

function checkpointKey(taskId: string): string {
  return `agent:checkpoint:${taskId}`;
}

export class TaskCheckpointStore {
  constructor(private readonly storage: KeyValueStorage = new IndexedDBStorageProvider()) {}

  async save(checkpoint: TaskCheckpoint): Promise<void> {
    await this.storage.set(checkpointKey(checkpoint.taskId), {
      ...checkpoint,
      updatedAt: checkpoint.updatedAt || Date.now(),
    });
  }

  async load(taskId: string): Promise<TaskCheckpoint | null> {
    return this.storage.get<TaskCheckpoint>(checkpointKey(taskId));
  }

  async clear(taskId: string): Promise<void> {
    await this.storage.remove(checkpointKey(taskId));
  }
}

export function isCheckpointResumable(checkpoint: TaskCheckpoint | null): checkpoint is TaskCheckpoint {
  return checkpoint !== null && ['running', 'waiting_human', 'paused'].includes(checkpoint.status);
}

export function shouldForceReplanAfterResume(params: {
  checkpointObservationId: string | null;
  currentObservationId: string | null;
}): boolean {
  if (!params.checkpointObservationId || !params.currentObservationId) return true;
  return params.checkpointObservationId !== params.currentObservationId;
}

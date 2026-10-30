import { IndexedDBStorageProvider } from '../../adapters/IndexedDBStorageProvider';
import type { TaskCheckpoint } from './types';

/** The slice of `IStorageProvider` a checkpoint needs; the orchestration layer stores its run state the same way. */
export interface KeyValueStorage {
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

  /**
   * The saved checkpoint, or null when there is none.
   *
   * The storage layer rethrows a read it could not make, because a failed read is not an absent value. Here that
   * distinction is spent and then swallowed deliberately: a fresh task must still start when an unrelated record is
   * unreadable. `loadFailed` records whether the null means "nothing saved" or "could not tell", so a caller deciding
   * whether to offer the user a resume does not report the second as the first.
   */
  loadFailed = false;

  async load(taskId: string): Promise<TaskCheckpoint | null> {
    this.loadFailed = false;
    try {
      return await this.storage.get<TaskCheckpoint>(checkpointKey(taskId));
    } catch (error) {
      this.loadFailed = true;
      console.error(`[TaskCheckpointStore] Could not read the checkpoint for ${taskId}`, error);
      return null;
    }
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

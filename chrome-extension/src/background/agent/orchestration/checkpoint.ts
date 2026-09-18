/**
 * The run's checkpoint, written after every node. It is the task-level twin of `contracts/checkpoint.ts` (which keeps
 * one worker's own step state) and lives in the same IndexedDB key-value store, under `orchestration:run:<runId>`.
 * Between the two, a background worker that dies mid-run loses the step a worker was on, never a finished subtask.
 */
import { IndexedDBStorageProvider } from '../../adapters/IndexedDBStorageProvider';
import type { KeyValueStorage } from '../contracts/checkpoint';
import type { RunCheckpoint } from './types';

export function runKey(runId: string): string {
  return `orchestration:run:${runId}`;
}

export class RunCheckpointStore {
  constructor(private readonly storage: KeyValueStorage = new IndexedDBStorageProvider()) {}

  async save(checkpoint: RunCheckpoint): Promise<void> {
    await this.storage.set(runKey(checkpoint.runId), { ...checkpoint, updatedAt: checkpoint.updatedAt || Date.now() });
  }

  async load(runId: string): Promise<RunCheckpoint | null> {
    return this.storage.get<RunCheckpoint>(runKey(runId));
  }

  async clear(runId: string): Promise<void> {
    await this.storage.remove(runKey(runId));
  }
}

export function isRunResumable(checkpoint: RunCheckpoint | null): checkpoint is RunCheckpoint {
  return checkpoint !== null && ['running', 'stopped'].includes(checkpoint.status);
}

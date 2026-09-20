/**
 * Reads the background's trace table. Extension pages share one IndexedDB origin, so this opens
 * `WebGenieTraces` directly — nothing is sent anywhere and no other store is touched.
 *
 * Both reads walk a cursor over an index and stop at a cap, so a 50 000-record store never lands in
 * memory or blocks the main thread for long.
 */
import type { TraceRecordLike, TaskOverview, TaskDetail, TraceSlim } from '@trace-summary';
import { slimRecord, summarizeTask } from '@trace-summary';

const TRACE_DB = 'WebGenieTraces';
const STORE = 'records';

/** Tasks listed at once. */
export const MAX_TASKS = 25;
/** Records walked while listing, newest first. */
const MAX_SCAN = 80_000;
/** Records held for one opened task. */
export const MAX_TASK_RECORDS = 20_000;

export interface TraceStoreStatus {
  /** The store has never been created: capture has not run in this browser. */
  missing: boolean;
  records: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(TRACE_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
  });
}

/** Walk `index` with a cursor, handing each record to `take`; stop when it returns false. */
function walk(
  db: IDBDatabase,
  index: string,
  range: IDBKeyRange | null,
  direction: IDBCursorDirection,
  take: (entry: TraceRecordLike) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).index(index).openCursor(range, direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (take(cursor.value as TraceRecordLike)) cursor.continue();
      else resolve();
    };
  });
}

export async function readStatus(): Promise<TraceStoreStatus> {
  const db = await openDb();
  if (!db) return { missing: true, records: 0 };
  try {
    return {
      missing: false,
      records: await new Promise<number>((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
    };
  } finally {
    db.close();
  }
}

/**
 * The overview carries no wall-clock or health numbers: the listing pass keeps only the records those
 * fields come from (model calls, task events, the executor's task line). Open a task for the rest.
 */
function overviewRelevant(entry: TraceRecordLike): boolean {
  return entry.kind === 'llm' || entry.kind === 'event' || entry.msg.includes('Executing task:');
}

/** The newest tasks, newest first. */
export async function listRecentTasks(): Promise<TaskOverview[]> {
  const db = await openDb();
  if (!db) return [];
  const byTask = new Map<string, TraceSlim[]>();
  try {
    let scanned = 0;
    await walk(db, 'ts', null, 'prev', entry => {
      if (++scanned > MAX_SCAN) return false;
      const taskId = entry.taskId;
      if (!taskId) return true;
      let entries = byTask.get(taskId);
      if (!entries) {
        // Newest first, so a task unseen once MAX_TASKS are collected is older than all of them.
        if (byTask.size >= MAX_TASKS) return false;
        entries = [];
        byTask.set(taskId, entries);
      }
      if (overviewRelevant(entry)) entries.push(slimRecord(entry));
      return true;
    });
  } finally {
    db.close();
  }
  return [...byTask.entries()]
    .map(([taskId, entries]) => summarizeTask(taskId, entries).overview)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export interface TaskDetailResult {
  detail: TaskDetail;
  /** The task has more records than `MAX_TASK_RECORDS`; the rollup covers only the oldest of them. */
  truncated: boolean;
}

export async function readTaskDetail(taskId: string): Promise<TaskDetailResult | null> {
  const db = await openDb();
  if (!db) return null;
  const entries: TraceSlim[] = [];
  let truncated = false;
  try {
    await walk(db, 'taskId', IDBKeyRange.only(taskId), 'next', entry => {
      if (entries.length >= MAX_TASK_RECORDS) {
        truncated = true;
        return false;
      }
      entries.push(slimRecord(entry));
      return true;
    });
  } finally {
    db.close();
  }
  if (entries.length === 0) return null;
  return { detail: summarizeTask(taskId, entries), truncated };
}

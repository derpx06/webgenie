/// <reference types="vite/client" />
// Persistent structured trace sink for the background service worker.
// Every createLogger() call, agent event, LLM call and key span lands here as one record in IndexedDB
// (database "WebGenieTraces", table "records"), so a task can be replayed from logs after the worker dies.
import Dexie from 'dexie';
import { advancedSettingsStore } from '@extension/storage';

export type TraceLevel = 'debug' | 'info' | 'warning' | 'error';
export type TraceKind = 'log' | 'event' | 'llm' | 'span' | 'trace';

export interface TraceRecord {
  seq?: number;
  ts: number;
  level: TraceLevel;
  kind: TraceKind;
  component: string;
  msg: string;
  taskId?: string;
  step?: number;
  durationMs?: number;
  data?: unknown;
}

class TraceDB extends Dexie {
  records!: Dexie.Table<TraceRecord, number>;

  constructor() {
    super('WebGenieTraces');
    this.version(1).stores({ records: '++seq, ts, taskId, component, kind, level' });
  }
}

const MAX_RECORDS = 50_000;
const FLUSH_MS = 500;
const FLUSH_BATCH = 200;
const MAX_STRING = 8_000;
const SECRET_KEY = /^(api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|token|authorization|secret|client[-_]?secret|password|credentials?|bedrock[-_]?secret[-_]?key)$/i;
const SECRET_VALUE = /\bya29\.[\w-]+|\bsk-[\w-]{16,}|\bAIza[\w-]{30,}|Bearer\s+[\w.-]+/g;

let db: TraceDB | null = null;
let enabled = import.meta.env.DEV;
let context: { taskId?: string; step?: number } = {};
let buffer: TraceRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writesSincePrune = 0;

function redactString(value: string): string {
  const redacted = value.replace(SECRET_VALUE, '[redacted]');
  return redacted.length > MAX_STRING ? `${redacted.slice(0, MAX_STRING)}…[+${redacted.length - MAX_STRING} chars]` : redacted;
}

/** Make any value safe to persist: redact secrets, flatten errors, bound depth/breadth/string length. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
      cause: value.cause !== undefined && depth < 3 ? sanitize(value.cause, depth + 1) : undefined,
    };
  }
  if (depth >= 4) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, depth + 1));
  if (value instanceof Map) return sanitize(Object.fromEntries(Array.from(value.entries()).slice(0, 50)), depth + 1);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  if (typeof indexedDB === 'undefined') return;
  try {
    db ??= new TraceDB();
    await db.records.bulkAdd(batch);
    writesSincePrune += batch.length;
    if (writesSincePrune >= 5_000) {
      writesSincePrune = 0;
      const excess = (await db.records.count()) - MAX_RECORDS;
      if (excess > 0) await db.records.bulkDelete(await db.records.orderBy('seq').limit(excess).primaryKeys());
    }
  } catch (error) {
    console.warn('[Trace] flush failed', error); // not the logger: that would recurse
  }
}

/** Append one record. Never throws: tracing must not break the agent. */
export function record(entry: Omit<TraceRecord, 'ts'> & { ts?: number }): void {
  if (!enabled) return;
  try {
    buffer.push({
      ts: Date.now(),
      ...context,
      ...entry,
      msg: redactString(entry.msg),
      data: entry.data === undefined ? undefined : sanitize(entry.data),
    });
    if (buffer.length >= FLUSH_BATCH) void flush();
    else if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_MS);
  } catch {
    // swallow: a record that cannot be serialized is dropped, the agent keeps running
  }
}

/** Correlate every subsequent record with a task and step. The background runs one executor at a time. */
export function setTraceContext(next: { taskId?: string; step?: number }): void {
  context = next;
}

function refreshEnabled(): void {
  advancedSettingsStore
    .getSettings()
    .then(settings => {
      enabled = import.meta.env.DEV || Boolean(settings.enableDeveloperOptions && settings.captureTraces);
    })
    .catch(() => {});
}

if (typeof chrome !== 'undefined' && chrome.storage) {
  refreshEnabled();
  advancedSettingsStore.subscribe(refreshEnabled);
  chrome.runtime?.onSuspend?.addListener(() => void flush());
}

/// <reference types="vite/client" />
// Persistent structured trace sink for the background service worker.
// Every createLogger() call, agent event, LLM call and key span lands here as one record in IndexedDB
// (database "WebGenieTraces", table "records"), so a task can be replayed from logs after the worker dies.
import Dexie from 'dexie';
import { advancedSettingsStore } from '@extension/storage';

type TraceLevel = 'debug' | 'info' | 'warning' | 'error';
type TraceKind = 'log' | 'event' | 'llm' | 'span' | 'trace' | 'session';

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
/** Session records hold a model call's whole page state (25k+ characters on real sites). */
const SESSION_MAX_STRING = 200_000;
const stringCap = (kind: TraceKind | undefined) => (kind === 'session' ? SESSION_MAX_STRING : MAX_STRING);
const SECRET_KEY = /^(api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|token|authorization|secret|client[-_]?secret|password|credentials?|bedrock[-_]?secret[-_]?key)$/i;
const SECRET_VALUE = /\bya29\.[\w-]+|\bsk-[\w-]{16,}|\bAIza[\w-]{30,}|Bearer\s+[\w.-]+/g;

let db: TraceDB | null = null;
let enabled = import.meta.env.DEV;
let context: { taskId?: string; step?: number } = {};
let buffer: TraceRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writesSincePrune = 0;
/** Values the agent typed into password fields; scrubbed from every record. */
const secrets = new Set<string>();

export function registerSecret(value: string): void {
  if (value.length < 4 || secrets.has(value)) return;
  secrets.add(value);
  // A plan or memory note can name the value before it is typed: scrub what this task already recorded.
  buffer = buffer.map(scrubbed);
  void scrubStored(context.taskId);
}

function scrubbed(entry: TraceRecord): TraceRecord {
  const max = stringCap(entry.kind);
  return { ...entry, msg: redactString(entry.msg, max), data: entry.data === undefined ? undefined : sanitize(entry.data, 0, max) };
}

/** Writes already under way finish first: IndexedDB runs write transactions on a store in creation order. */
async function scrubStored(taskId: string | undefined): Promise<void> {
  if (!taskId || typeof indexedDB === 'undefined') return;
  try {
    db ??= new TraceDB();
    await db.records.where('taskId').equals(taskId).modify((entry, ref) => {
      ref.value = scrubbed(entry);
    });
  } catch (error) {
    console.warn('[Trace] scrub failed', error); // not the logger: that would recurse
  }
}

/** Registered secrets replaced in text leaving the background (event details, answers); no truncation. */
export function redactSecrets(value: string): string {
  let redacted = value;
  for (const secret of secrets) redacted = redacted.split(secret).join('[redacted]');
  return redacted;
}

function redactString(value: string, max = MAX_STRING): string {
  let redacted = value.replace(SECRET_VALUE, '[redacted]');
  for (const secret of secrets) redacted = redacted.split(secret).join('[redacted]');
  return redacted.length > max ? `${redacted.slice(0, max)}…[+${redacted.length - max} chars]` : redacted;
}

/** Make any value safe to persist: redact secrets, flatten errors, bound depth/breadth/string length. */
export function sanitize(value: unknown, depth = 0, max = MAX_STRING): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value, max);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, max),
      stack: value.stack ? redactString(value.stack, max) : undefined,
      cause: value.cause !== undefined && depth < 3 ? sanitize(value.cause, depth + 1, max) : undefined,
    };
  }
  // Session records (the larger cap) keep tool arguments whole, lists inside them included.
  if (depth >= (max > MAX_STRING ? 8 : 4)) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, depth + 1, max));
  if (value instanceof Map) return sanitize(Object.fromEntries(Array.from(value.entries()).slice(0, 50)), depth + 1, max);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1, max);
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
    const max = stringCap(entry.kind);
    buffer.push({
      ts: Date.now(),
      ...context,
      ...entry,
      msg: redactString(entry.msg, max),
      data: entry.data === undefined ? undefined : sanitize(entry.data, 0, max),
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

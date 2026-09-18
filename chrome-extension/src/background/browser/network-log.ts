/**
 * What the page asked the network for, per tab: method, address, status, content type, size and, for JSON, a short
 * sample of the body. Recorded from CDP Network events on the session the agent already holds, so nothing is injected
 * into the page and nothing leaves the browser.
 *
 * The point of it: a site that paints 500 rows over 25 pages almost always paints them from one JSON endpoint. Seeing
 * that endpoint turns 25 page reads into one request (sniff_api, fetch_json).
 */

export interface NetRecord {
  method: string;
  url: string;
  status: number;
  /** Content type as the server sent it, lowercased, without parameters. */
  type: string;
  /** Bytes on the wire; 0 when the browser did not report one. */
  size: number;
  /** First characters of a JSON body, when one was captured. */
  sample?: string;
}

/** Requests kept per tab; a busy page makes a few hundred and the oldest are the least interesting. */
const MAX_RECORDS = 300;
/** Bodies fetched per tab: each one is a CDP round trip, and the model can only read a handful. */
const MAX_BODIES = 40;
const SAMPLE_CHARS = 400;

/** A JSON-looking response: what the server called it, or an address that names it. */
export function looksJson(record: NetRecord): boolean {
  return /json/.test(record.type) || /\.json($|\?)/i.test(record.url);
}

/** Per-tab request log, written from CDP events and read by sniff_api. */
export class NetworkLog {
  private readonly records: NetRecord[] = [];
  private readonly pending = new Map<string, NetRecord>();
  private bodies = 0;

  started(requestId: string, method: string, url: string): void {
    if (!/^https?:/i.test(url)) return;
    this.pending.set(requestId, { method: (method || 'GET').toUpperCase(), url, status: 0, type: '', size: 0 });
    // A page that never finishes its requests must not grow the map without end.
    if (this.pending.size > MAX_RECORDS) this.pending.delete(this.pending.keys().next().value as string);
  }

  responded(requestId: string, status: number, mimeType: string): void {
    const record = this.pending.get(requestId);
    if (!record) return;
    record.status = status;
    record.type = (mimeType || '').split(';')[0].trim().toLowerCase();
  }

  /** The request is done: keep it, and say whether its body is worth fetching. */
  finished(requestId: string, size: number): { record: NetRecord; wantsBody: boolean } | null {
    const record = this.pending.get(requestId);
    if (!record) return null;
    this.pending.delete(requestId);
    record.size = Math.max(0, Math.round(size));
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    const wantsBody = looksJson(record) && record.status >= 200 && record.status < 300 && this.bodies < MAX_BODIES;
    if (wantsBody) this.bodies++;
    return { record, wantsBody };
  }

  failed(requestId: string): void {
    this.pending.delete(requestId);
  }

  /** Keeps the head of a body, but only when it really is JSON: an HTML error page served as JSON is not data. */
  sampled(record: NetRecord, body: string): void {
    const text = body.trim();
    if (text.startsWith('{') || text.startsWith('[')) record.sample = text.slice(0, SAMPLE_CHARS);
  }

  all(): NetRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
    this.pending.clear();
    this.bodies = 0;
  }
}

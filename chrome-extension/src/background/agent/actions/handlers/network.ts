import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { fetchJsonActionSchema, sniffApiActionSchema } from '../schemas';
import { hostOf, sameSite } from '../../validation/service';
import { isUrlAllowed } from '@src/background/browser/util';
import { wrapUntrustedContent } from '../../messages/utils';
import { looksJson, type NetRecord } from '@src/background/browser/network-log';

/** Addresses whose only job is measurement: they are JSON, same-site and carry no data the task can use. */
const TRACKING =
  /(^|[.\-/])(analytics|telemetry|metrics|beacon|collect|track(ing|er)?|pixel|rum|stats|log(ging|s)?|events?|gtm|gtag|doubleclick|googletagmanager|google-analytics|segment|sentry|hotjar|optimizely|amplitude|mixpanel|newrelic|nr-data|datadog|braze|clarity|quantserve|scorecardresearch|adservice|adsystem|criteo|taboola|outbrain)([.\-/]|$)/i;

/** The shape of an address, so page=1 and page=2 of one endpoint count as one endpoint. */
export function endpointShape(method: string, url: string): string {
  try {
    const parsed = new URL(url);
    const keys = [...new Set(parsed.searchParams.keys())].sort().join(',');
    return `${method} ${parsed.origin}${parsed.pathname.replace(/\/\d+(?=\/|$)/g, '/:n')}${keys ? `?${keys}` : ''}`;
  } catch {
    return `${method} ${url}`;
  }
}

export interface Endpoint extends NetRecord {
  shape: string;
  /** Requests seen with this shape; more than one means the site pages through it. */
  times: number;
}

/**
 * The records that look like the site's own data: JSON, a success, the same site as the page, not a tracker. Newest
 * first, one entry per endpoint shape, so a table fetched 25 times is one line and not 25.
 */
export function dataEndpoints(records: NetRecord[], pageUrl: string, filter = ''): Endpoint[] {
  const host = hostOf(pageUrl);
  const wanted = filter.trim().toLowerCase();
  const byShape = new Map<string, Endpoint>();
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.status < 200 || record.status >= 300 || !looksJson(record)) continue;
    let parsed: URL;
    try {
      parsed = new URL(record.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(parsed.protocol)) continue;
    if (host && !sameSite(parsed.host, host)) continue;
    if (TRACKING.test(parsed.host) || TRACKING.test(parsed.pathname)) continue;
    if (wanted && !record.url.toLowerCase().includes(wanted) && !(record.sample ?? '').toLowerCase().includes(wanted)) continue;
    const shape = endpointShape(record.method, record.url);
    const known = byShape.get(shape);
    if (known) {
      known.times++;
      if (!known.sample && record.sample) known.sample = record.sample;
      continue;
    }
    byShape.set(shape, { ...record, shape, times: 1 });
  }
  return [...byShape.values()];
}

/** `data.items` of a parsed reply; undefined when the path does not lead anywhere. */
export function atPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((node, key) => {
      if (node === null || typeof node !== 'object') return undefined;
      return (node as Record<string, unknown>)[key];
    }, value);
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const DEFAULT_CHARS = 8000;
const MIN_CHARS = 500;
const MAX_CHARS = 40_000;

/**
 * The site's own data endpoints, and a way to call one. A paginated list is one request here and 25 page reads
 * otherwise; both tools only read, and only on the site the agent is already on.
 */
export class NetworkHandler extends BaseHandler {
  async handleSniffApi(input: z.infer<typeof sniffApiActionSchema.schema>): Promise<ActionResult> {
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, 'Looking at the site\'s requests');
    const page = await this.context.browserContext.getCurrentPage();
    const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));
    const endpoints = dataEndpoints(page.networkRecords(), page.url(), input.filter ?? '').slice(0, limit);
    if (endpoints.length === 0) {
      const msg =
        'No JSON endpoint of this site has been seen yet. They are recorded while the page loads and while you interact with it, so act on the page once and look again; a page rendered on the server has none, and the read tools are the way in.';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'No data endpoints seen');
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }
    const lines = endpoints.map(endpoint => {
      const size = endpoint.size > 0 ? `, ${Math.max(1, Math.round(endpoint.size / 1024))} KB` : '';
      const times = endpoint.times > 1 ? `, called ${endpoint.times}x` : '';
      return `- ${endpoint.method} ${endpoint.url} (${endpoint.status}${size}${times})${endpoint.sample ? `\n  sample: ${endpoint.sample}` : ''}`;
    });
    const msg = `${endpoints.length} JSON endpoint(s) this site called. fetch_json reads one; its query usually takes page, offset, limit or a filter:\n${lines.join('\n')}`;
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Found ${endpoints.length} data endpoints`);
    return new ActionResult({ extractedContent: wrapUntrustedContent(msg), includeInMemory: true });
  }

  async handleFetchJson(input: z.infer<typeof fetchJsonActionSchema.schema>): Promise<ActionResult> {
    const page = await this.context.browserContext.getCurrentPage();
    const pageUrl = page.url();
    const refusal = this.refuse(input.url, pageUrl);
    if (refusal) {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, refusal);
      return new ActionResult({ error: refusal, includeInMemory: true });
    }
    const cap = Math.min(MAX_CHARS, Math.max(MIN_CHARS, input.max_chars ?? DEFAULT_CHARS));
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, `Requesting ${hostOf(input.url)}`);

    let reply: Awaited<ReturnType<typeof page.fetchInPage>>;
    try {
      reply = await page.fetchInPage(input.url, cap);
    } catch (error) {
      const msg = `The request failed: ${error instanceof Error ? error.message : String(error)}. The page may have navigated away, or the site may refuse a request made this way; read the page instead.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    if (reply.status < 200 || reply.status >= 300) {
      const msg = `${input.url} answered ${reply.status}. ${reply.status === 401 || reply.status === 403 ? 'It needs a session or a header the page sends itself; use the page.' : 'Check the address and its query.'}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    let body = reply.body;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      if (reply.truncated) {
        const msg = `The reply is longer than ${cap} characters, so it could not be parsed as JSON. Ask for fewer rows in the query (limit, per_page, size) or raise max_chars.`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
      const msg = `${input.url} did not answer with JSON (${reply.type || 'no content type'}). It is a page, not an endpoint: open or read it instead.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    let note = '';
    if (input.path) {
      const picked = atPath(parsed, input.path);
      if (picked === undefined) {
        note = `\n(nothing at "${input.path}"; the whole reply is shown)`;
      } else {
        parsed = picked;
      }
    }
    if (Array.isArray(parsed)) note += `\n(${parsed.length} items)`;
    body = JSON.stringify(parsed);
    const truncated = body.length > cap;
    if (truncated) body = `${body.slice(0, cap)}\n…cut at ${cap} characters; narrow the query or use path.`;

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Read ${body.length} characters of JSON`);
    return new ActionResult({
      extractedContent: wrapUntrustedContent(`${input.url} answered ${reply.status}:${note}\n${body}`),
      includeInMemory: true,
    });
  }

  /** Why this address may not be requested, or empty when it may: only the site the agent is on, only what the firewall allows. */
  private refuse(url: string, pageUrl: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return `"${url}" is not an absolute address. Give the full URL, including https://.`;
    }
    if (!/^https?:$/.test(parsed.protocol)) return `fetch_json only requests http and https addresses, not ${parsed.protocol}.`;
    const host = hostOf(pageUrl);
    if (host && !sameSite(parsed.host, host)) {
      return `fetch_json only requests the site you are on (${host}); ${parsed.host} is another site. Open it first if the task needs it.`;
    }
    const config = this.context.browserContext.getConfig();
    if (!isUrlAllowed(url, config.allowedUrls ?? [], config.deniedUrls ?? [])) {
      return `${parsed.host} is blocked by the browser's firewall settings.`;
    }
    return '';
  }
}

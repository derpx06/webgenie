/**
 * What this task already tried, written by the harness and not by the model: every address it landed on and how often,
 * every action the guards refused and why, and every page it backed out of. 442 wasted steps across the reviewed tasks
 * are loops and re-visits — one task opened the same three pages nine times — because the only record of them was the
 * step summary, which the context builder compresses first. This block is rebuilt from the ledger on every call, so no
 * compaction can drop it, and near-identical entries collapse into one line with a count.
 *
 * It also keeps the routes the task took (a search, a filter, a category, an address) with what each gave: the r3
 * planner re-issued dead routes in other words while its prompt already said not to, because nothing it saw said the
 * route had been tried.
 */
import { pathTemplate } from '../global/memory-store';

export type LedgerKind = 'visit' | 'refused' | 'dead_end';

export interface LedgerEntry {
  kind: LedgerKind;
  /** What the entry is about: an address for a visit or a dead end, the action's name for a refusal. */
  subject: string;
  /** The latest short note: a page title, the reason an action was refused, why a page was left. */
  note: string;
  times: number;
}

/**
 * How a task tried to reach what it wants: the site's search, a filter or sort on a listing, a category link that opened
 * a listing, an address typed in, or a web search engine. Two different kinds ending empty is what an answer of absence
 * needs; the same kind, place and query again is a route already tried.
 */
export type RouteKind = 'site_search' | 'facet' | 'category' | 'url' | 'web_search';

export interface RouteEntry {
  key: string;
  kind: RouteKind;
  /** Host and path template, e.g. `shop.test/search`. */
  place: string;
  /** The search text, lowercased with its spaces collapsed; empty when the route searched nothing. */
  query: string;
  /** The listing's other parameters (filters, sort), sorted; paging and tracking left out. */
  params: string;
  /** The address the route landed on, as the site sees it (no www., no trailing slash, lowercased). */
  address: string;
  /** The result count the page states: 0 for an empty listing, null when it states none. */
  count: number | null;
  /** The latest outcome as the models see it: a result count, no results, no control for a requirement, gave a finding. */
  note: string;
  times: number;
}

/** Search parameters: the same list SiteSkills reads a site's search address with. */
const SEARCH_PARAMS = ['q', 'query', 'search', 'search_query', 'searchterm', 'keyword', 'keywords', 'term', 'text', 'k', 's', 'wd'];
/** Parameters that page, track or identify a session: not part of what a route asks for. */
const NOISE_PARAM = /^(utm_|ref$|ref_|sid$|session|page$|p$|pg$|start$|offset$|qid$|sr$|crid$|sprefix$|_)/i;
const WEB_SEARCH_HOST = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|startpage)\.[a-z.]+$|^search\.brave\.com$/i;
/** A page saying its search or listing came back empty. */
const EMPTY_LISTING =
  /\b(no (results?|matches|matching (results?|items|products|listings))\b|0 (results?|matches|listings|products)\b|nothing (was )?found|did ?n[o']?t match any|returned no\b|no \w+(?: \w+)? (were|was) found)/i;
/** "1,234 results", "Showing 1-20 of 345 products": the count right before the listing's noun. */
const COUNT =
  /(\d[\d,.]*)\+?\s+(results?|items|products|matches|listings|jobs|hits|properties|homes|vehicles|cars|hotels|flights|stays|courses|articles|records|entries|recipes|events|deals|rentals|stores|locations)\b/i;

/** The result count a page states: 0 when it says it is empty, null when it states none. */
export function resultCount(text: string): number | null {
  if (EMPTY_LISTING.test(text)) return 0;
  const match = text.match(COUNT);
  if (!match) return null;
  const count = Number(match[1].replace(/[,.](?=\d{3}\b)/g, ''));
  return Number.isFinite(count) ? count : null;
}

interface ParsedAddress {
  host: string;
  place: string;
  query: string;
  params: string;
  address: string;
}

function parseAddress(url: string): ParsedAddress | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const host = parsed.host.toLowerCase().replace(/^www\./, '');
  let query = '';
  const params: string[] = [];
  for (const [name, value] of parsed.searchParams) {
    if (!value.trim()) continue;
    if (!query && SEARCH_PARAMS.includes(name.toLowerCase())) query = value.toLowerCase().replace(/\s+/g, ' ').trim();
    else if (!NOISE_PARAM.test(name)) params.push(`${name}=${value}`);
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return {
    host,
    place: `${host}${pathTemplate(path)}`,
    query,
    params: params.sort().join('&'),
    address: `${host}${path}${parsed.search}`.toLowerCase(),
  };
}

const ADDRESS_ACTIONS = new Set(['go_to_url', 'open_tab']);
const NOT_A_ROUTE = new Set(['go_back', 'go_forward', 'switch_tab', 'close_tab']);

/**
 * The route an executed action took, or null when it took none: a search submitted (on the site or on a web search
 * engine), a filter or sort that changed the listing's address or the result count it states, a click that opened a
 * listing (a page that states a result count), or an address typed in. Reading, scrolling and opening an item are not
 * routes, and neither is going back.
 */
export function routeOf(
  action: string,
  before: { url: string; text: string },
  after: { url: string; text: string },
): Omit<RouteEntry, 'key' | 'note' | 'times'> | null {
  const to = parseAddress(after.url);
  if (!to || NOT_A_ROUTE.has(action)) return null;
  const from = parseAddress(before.url);
  const count = resultCount(after.text);
  const route = (kind: RouteKind) => ({ kind, place: to.place, query: to.query, params: to.params, address: to.address, count });
  if (action === 'search_web' || (to.query && WEB_SEARCH_HOST.test(to.host))) return to.query ? route('web_search') : null;
  if (ADDRESS_ACTIONS.has(action)) return route(to.query ? 'site_search' : to.params ? 'facet' : 'url');
  if (!from || from.address === to.address) {
    // A filter applied in place (no new address) still changes the count the listing states.
    const countBefore = resultCount(before.text);
    return from && count !== null && countBefore !== null && count !== countBefore ? route('facet') : null;
  }
  if (to.query && (to.query !== from.query || to.host !== from.host)) return route('site_search');
  if (to.host === from.host && to.query === from.query && to.params !== from.params && (to.params || to.query)) return route('facet');
  return count !== null ? route('category') : null;
}

/** A note short enough that twenty of them still fit the block. */
function short(text: string, maxChars = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

export class TaskLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private readonly routeEntries = new Map<string, RouteEntry>();
  /** The step, pages seen and findings when the planner last planned, and the last step that made progress. */
  private planMark = { step: 0, pages: 0, findings: 0 };
  private progressStep = 0;

  private add(kind: LedgerKind, subject: string, note: string): void {
    if (!subject) return;
    const key = `${kind}|${subject}`;
    const known = this.entries.get(key);
    if (known) {
      known.times++;
      // The newest note wins: a page that gave results after a filter is no longer the page that gave none.
      if (note) known.note = short(note);
      return;
    }
    this.entries.set(key, { kind, subject: short(subject, 90), note: short(note), times: 1 });
  }

  /** An address the task landed on, with whatever the page says it is. */
  visited(address: string, note = ''): void {
    this.add('visit', address, note);
  }

  /** An action a guard refused, by tool name, with the start of the reason. */
  refused(action: string, reason: string): void {
    this.add('refused', action, reason);
  }

  /** A page the task backed out of: going there again costs the same steps it cost the first time. */
  deadEnd(address: string, why: string): void {
    this.add('dead_end', address, why);
  }

  /**
   * The route an executed action took (see `routeOf`), if it took one. The same route again counts up and takes the
   * newest outcome, so a search re-issued with the same query under other words is one line with a count.
   */
  recordRoute(action: string, before: { url: string; text: string }, after: { url: string; text: string }): void {
    const route = routeOf(action, before, after);
    if (!route) return;
    const key = [route.kind, route.place, route.query, route.params].join('|');
    const outcome = route.count === 0 ? 'no results' : route.count !== null ? `${route.count} results` : '';
    const known = this.routeEntries.get(key);
    if (known) {
      known.times++;
      known.count = route.count;
      known.address = route.address;
      if (outcome) known.note = outcome;
    } else {
      this.routeEntries.set(key, { ...route, key, note: outcome, times: 1 });
    }
  }

  /** Every route tried, in the order first tried. */
  routes(): RouteEntry[] {
    return [...this.routeEntries.values()];
  }

  /**
   * The route already tried that a goal names — by its search text or, for an address, by the address itself — longest
   * query first. A goal is the same goal as an earlier one when it names the same route, whatever words it uses.
   */
  routeNamedIn(goal: string): string | undefined {
    const text = goal.toLowerCase().replace(/\s+/g, ' ');
    return this.routes()
      .filter(route => (route.query.length >= 3 && text.includes(route.query)) || (route.kind === 'url' && text.includes(route.address)))
      .sort((a, b) => b.query.length - a.query.length)[0]?.key;
  }

  /** The kinds of route whose latest outcome was an empty listing. */
  emptyRouteKinds(): Set<RouteKind> {
    return new Set(this.routes().filter(route => route.count === 0).map(route => route.kind));
  }

  /** The planner planned at `step`; the progress block counts from here. */
  planned(step: number, findings: number): void {
    this.planMark = { step, pages: this.visitCount(), findings };
  }

  /** The task made progress at `step`: a new page state validated, a finding saved, a requirement applied. */
  progressed(step: number): void {
    this.progressStep = step;
  }

  private visitCount(): number {
    return this.all().filter(entry => entry.kind === 'visit').length;
  }

  /**
   * The planner's progress block, counted by the harness: is the task moving, or is it going round. A weak model
   * cannot answer that from its own reasoning (Kamoi, Sinha); it can read a count.
   */
  progressLine(step: number, findings: number, applied: number, requirements: number): string {
    const kinds = new Map<RouteKind, { tried: number; empty: number }>();
    for (const route of this.routes()) {
      const seen = kinds.get(route.kind) ?? { tried: 0, empty: 0 };
      seen.tried += route.times;
      if (route.count === 0) seen.empty++;
      kinds.set(route.kind, seen);
    }
    const tried = [...kinds].map(([kind, seen]) => `${kind} x${seen.tried}${seen.empty ? ` (${seen.empty} empty)` : ''}`).join(', ');
    return [
      `steps since last plan ${step - this.planMark.step}`,
      `new pages ${this.visitCount() - this.planMark.pages}`,
      `findings +${findings - this.planMark.findings}`,
      `requirements applied ${applied}/${requirements}`,
      `steps without progress ${step - this.progressStep}`,
      `route kinds tried: ${tried || 'none'}`,
    ].join('; ');
  }

  /** Every visit, refusal and dead end, newest first within its kind; for tests, traces and the site playbook. */
  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }

  /**
   * The block as the models see it, within `maxChars`. What prevents a loop comes first — routes tried, dead ends,
   * refusals, then the addresses seen more than once — and a page seen exactly once is dropped before anything else when
   * the budget is tight: it is the least likely to be revisited by mistake and the most numerous.
   */
  render(maxChars: number): string {
    const label = { visit: 'seen', refused: 'refused', dead_end: 'dead end' } as const;
    const count = (times: number) => (times > 1 ? ` x${times}` : '');
    const routeLine = (route: RouteEntry) =>
      `- route ${route.kind} ${short(route.place, 60)}${route.query ? ` "${short(route.query, 40)}"` : ''}` +
      `${route.params ? ` [${short(route.params, 50)}]` : ''}${count(route.times)}${route.note ? `: ${route.note}` : ''}`;
    const rank = (entry: LedgerEntry) =>
      entry.kind === 'dead_end' ? 0 : entry.kind === 'refused' ? 1 : entry.times > 1 ? 2 : 3;
    const ordered = [
      ...this.routes().map(routeLine),
      ...this.all()
        .sort((a, b) => rank(a) - rank(b) || b.times - a.times)
        .map(entry => `- ${label[entry.kind]} ${entry.subject}${count(entry.times)}${entry.note ? `: ${entry.note}` : ''}`),
    ];
    if (ordered.length === 0) return '';

    const lines: string[] = [];
    let used = 0;
    let dropped = 0;
    for (const line of ordered) {
      if (used + line.length + 1 > maxChars) {
        dropped++;
        continue;
      }
      lines.push(line);
      used += line.length + 1;
    }
    if (dropped > 0) lines.push(`- and ${dropped} more pages seen once`);
    return lines.join('\n');
  }
}

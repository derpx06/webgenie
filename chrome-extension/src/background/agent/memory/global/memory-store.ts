import { createLogger } from '../../../log';
import type { DOMElementNode } from '../../../browser/dom/views';
import type { RouteStep, SavedRoute } from './types';

const logger = createLogger('RouteMemory');

const ROUTES_KEY = 'wg_mem:routes';
/** Earlier memory stores kept task text and answers; they are removed on the next save or clear. */
const LEGACY_KEYS = ['wg_mem:episodes', 'wg_mem:domains'];
const MAX_ROUTES = 50;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_STEPS = 12;
const SEPARATORS = /[\s!-/:-@[-`{-~]+/;

/** Lowercased words of three or more characters. */
function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().split(SEPARATORS).filter(word => word.length >= 3));
}

/**
 * The path with every segment that could name an item or repeat the user's words replaced by `:n`: segments with
 * digits, long ids, and segments sharing a word with what the user wrote.
 */
export function pathTemplate(pathname: string, userWords: Set<string> = new Set()): string {
  return pathname
    .split('/')
    .map(segment => {
      let text = segment;
      try {
        text = decodeURIComponent(segment);
      } catch {
        // keep the raw segment
      }
      const lower = text.toLowerCase();
      const identifying = /\d/.test(lower) || lower.length > 24 || lower.split(SEPARATORS).some(word => userWords.has(word));
      return segment && identifying ? ':n' : segment;
    })
    .join('/');
}

/** Start pages match by origin and path template (query and fragment ignored). */
export function routeKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? `${parsed.origin}${pathTemplate(parsed.pathname)}` : null;
  } catch {
    return null;
  }
}

/** One step of a route: where it happened and what kind of element it used. Never what was typed or read. */
export function routeStep(action: string, url: string, node: DOMElementNode | undefined, userText: string): RouteStep | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const target = node ? [node.attributes.role || node.tagName, node.attributes.type].filter(Boolean).join(' ') : '';
  return { host: parsed.host, path: pathTemplate(parsed.pathname, wordsOf(userText)), action, ...(target ? { target } : {}) };
}

async function load(): Promise<SavedRoute[]> {
  const data = await chrome.storage.local.get(ROUTES_KEY);
  const routes: SavedRoute[] = Array.isArray(data[ROUTES_KEY]) ? data[ROUTES_KEY] : [];
  return routes.filter(route => Date.now() - route.savedAt < MAX_AGE_MS);
}

/** Routes of tasks the planner confirmed, keyed by the page each task started on. */
export const RouteMemory = {
  async save(startUrl: string, steps: RouteStep[]): Promise<void> {
    const key = routeKey(startUrl);
    if (!key || steps.length === 0) return;
    try {
      const routes = (await load()).filter(route => route.key !== key);
      routes.push({ key, steps: steps.slice(0, MAX_STEPS), savedAt: Date.now() });
      await chrome.storage.local.set({ [ROUTES_KEY]: routes.slice(-MAX_ROUTES) });
      await chrome.storage.local.remove(LEGACY_KEYS);
    } catch (error) {
      logger.error('Saving the route failed:', error);
    }
  },

  /** The route saved for this start page as a note for the models; empty when there is none. */
  async note(startUrl: string): Promise<string> {
    const key = routeKey(startUrl);
    if (!key) return '';
    try {
      const route = (await load()).find(saved => saved.key === key);
      if (!route) return '';
      const startHost = new URL(startUrl).host;
      const lines = route.steps.map(
        (step, i) => `${i + 1}. ${step.action}${step.target ? ` (${step.target})` : ''} on ${step.host === startHost ? '' : step.host}${step.path}`,
      );
      return `[A route that worked before from this start page; it may be outdated, and the current page wins]\n${lines.join('\n')}\n`;
    } catch (error) {
      logger.error('Reading the route failed:', error);
      return '';
    }
  },

  async clear(): Promise<void> {
    await chrome.storage.local.remove([ROUTES_KEY, ...LEGACY_KEYS]);
  },
};

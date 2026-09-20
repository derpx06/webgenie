/**
 * A playbook per domain, written by the harness after a task on that domain succeeds and read by the next one that
 * starts there: the search address that worked, the path through the site, and the traps it had to get past.
 *
 * It is never hand-authored and never holds anything the user or the page wrote: the search address keeps the
 * parameter name and drops its value, the path keeps the kind of element and a path template (`agent/memory/global/
 * memory-store.ts` rules), and a trap is one of a fixed set of generic labels. A skill carries the date it was last
 * confirmed and stops being shown the first time a task on that domain fails, so a site that moved its controls
 * cannot keep sending the agent to them.
 */
import { createLogger } from '../../../log';
import { registrableDomain } from '../../../browser/util';
import type { RouteStep } from './types';
import type { LedgerEntry } from '../in-chat/ledger';

const logger = createLogger('SiteSkills');

const SKILLS_KEY = 'wg_mem:site_skills';
const MAX_SKILLS = 30;
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_STEPS = 10;
const MAX_TRAPS = 4;

export interface SiteSkill {
  /** Registrable domain of the page tasks start on. */
  domain: string;
  /** The site's own search address with the query removed, e.g. `https://a.test/search?q={q}`. */
  searchUrl?: string;
  /** The path that worked, one line per step: what kind of element, on which page. */
  steps: string[];
  /** Generic labels only: a consent wall, a login gate, a bot check. */
  traps: string[];
  verifiedAt: number;
  /** 0 while the skill holds; 1 once a task on this domain has failed, after which it is no longer shown. */
  failures: number;
}

/** Query parameters that carry what was searched for; their values are never stored. */
const SEARCH_PARAMS = ['q', 'query', 'search', 'search_query', 'searchterm', 'keyword', 'keywords', 'term', 'text', 'k', 's', 'wd'];

/** The registrable domain, as `sameSite` reckons it; empty when the address is not a web page. */
export function domainOf(url: string): string {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? registrableDomain(parsed.host) : '';
  } catch {
    return '';
  }
}

/**
 * The site's search address with the query taken out, or empty when this is not one. Only the parameter's name is
 * kept, so what was searched for is never stored.
 */
export function searchPattern(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (!/^https?:$/.test(parsed.protocol)) return '';
  const name = [...parsed.searchParams.keys()].find(
    key => SEARCH_PARAMS.includes(key.toLowerCase()) && (parsed.searchParams.get(key) ?? '').trim().length > 0,
  );
  return name ? `${parsed.origin}${parsed.pathname}?${name}={q}` : '';
}

/** The path that worked, as lines: the kind of element and the page it was on, consecutive repeats collapsed. */
export function skillSteps(steps: RouteStep[], domain: string): string[] {
  const lines: string[] = [];
  for (const step of steps) {
    const where = step.host.replace(/^www\./, '') === domain ? step.path : `${step.host}${step.path}`;
    const line = `${step.action}${step.target ? ` (${step.target})` : ''} on ${where || '/'}`;
    if (line !== lines[lines.length - 1]) lines.push(line);
    if (lines.length >= MAX_STEPS) break;
  }
  return lines;
}

/** Generic names for what blocks a site; nothing a page or a user wrote is kept, only which of these was hit. */
const TRAPS: Array<[RegExp, string]> = [
  [/\b(captcha|recaptcha|hcaptcha|verify you are human|unusual traffic|press and hold|bot check|are you a robot|challenge)\b/i, 'a bot check'],
  [/\b(consent|cookies?|gdpr|privacy (choices|preferences)|accept all|we care about your privacy)\b/i, 'a consent or cookie wall'],
  [/\b(sign ?in|log ?in|register|create an account|account required|authenticate)\b/i, 'a login gate'],
  [/\b(paywall|subscribe to (read|continue)|subscriber[- ]only)\b/i, 'a paywall'],
  [/\b(covered by|dialog|modal|overlay|popup|pop-up|interstitial)\b/i, 'a dialog that covers the page'],
];

/** Which of the known traps this task's ledger shows it hit, in the order they are ranked above. */
export function trapsFrom(entries: LedgerEntry[]): string[] {
  const text = entries
    .filter(entry => entry.kind !== 'visit')
    .map(entry => `${entry.subject} ${entry.note}`)
    .join('\n');
  return TRAPS.filter(([pattern]) => pattern.test(text))
    .map(([, label]) => label)
    .slice(0, MAX_TRAPS);
}

async function load(): Promise<SiteSkill[]> {
  const data = await chrome.storage.local.get(SKILLS_KEY);
  const skills: SiteSkill[] = Array.isArray(data[SKILLS_KEY]) ? data[SKILLS_KEY] : [];
  return skills.filter(skill => Date.now() - skill.verifiedAt < MAX_AGE_MS);
}

async function store(skills: SiteSkill[]): Promise<void> {
  // The least recently confirmed goes first when the store is full.
  const kept = [...skills].sort((a, b) => a.verifiedAt - b.verifiedAt).slice(-MAX_SKILLS);
  await chrome.storage.local.set({ [SKILLS_KEY]: kept });
}

export interface SkillRun {
  /** Where this task's successful actions happened (`context.routeSteps`). */
  steps: RouteStep[];
  /** Addresses the task visited, for the site's own search address. */
  urls: Iterable<string>;
  /** This task's ledger, from which the traps are named. */
  ledger: LedgerEntry[];
}

export const SiteSkills = {
  /** Writes what worked on this domain, from the task's own trace. Called only after the planner confirms the task. */
  async record(startUrl: string, run: SkillRun): Promise<void> {
    const domain = domainOf(startUrl);
    if (!domain) return;
    const steps = skillSteps(run.steps, domain);
    const searchUrl = [...run.urls].map(searchPattern).find(pattern => pattern && domainOf(pattern) === domain);
    if (steps.length === 0 && !searchUrl) return;
    try {
      const skills = (await load()).filter(skill => skill.domain !== domain);
      skills.push({
        domain,
        ...(searchUrl ? { searchUrl } : {}),
        steps,
        traps: trapsFrom(run.ledger),
        verifiedAt: Date.now(),
        // A run that succeeded clears an earlier demotion: the site works again.
        failures: 0,
      });
      await store(skills);
    } catch (error) {
      logger.error('Saving the site skill failed:', error);
    }
  },

  /** A task on this domain failed: the skill is no longer shown until a later success confirms it again. */
  async demote(startUrl: string): Promise<void> {
    const domain = domainOf(startUrl);
    if (!domain) return;
    try {
      const skills = await load();
      const skill = skills.find(entry => entry.domain === domain);
      if (!skill || skill.failures > 0) return;
      skill.failures = 1;
      logger.info(`Site skill for ${domain} demoted after a failed task`);
      await store(skills);
    } catch (error) {
      logger.error('Demoting the site skill failed:', error);
    }
  },

  /** The playbook for this start page as a note for the models; empty when there is none or it has been demoted. */
  async note(startUrl: string): Promise<string> {
    const domain = domainOf(startUrl);
    if (!domain) return '';
    try {
      const skill = (await load()).find(entry => entry.domain === domain && entry.failures === 0);
      if (!skill) return '';
      const on = new Date(skill.verifiedAt).toISOString().slice(0, 10);
      const lines = [
        skill.searchUrl ? `- its search: ${skill.searchUrl} ({q} is what you search for)` : '',
        skill.traps.length ? `- in the way last time: ${skill.traps.join(', ')}` : '',
        skill.steps.length ? `- the path that worked: ${skill.steps.join('; ')}` : '',
      ].filter(Boolean);
      return `[What worked on ${domain} on ${on}; it may be out of date, and the current page wins]\n${lines.join('\n')}\n`;
    } catch (error) {
      logger.error('Reading the site skill failed:', error);
      return '';
    }
  },

  async clear(): Promise<void> {
    await chrome.storage.local.remove(SKILLS_KEY);
  },
};

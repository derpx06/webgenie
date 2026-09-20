/**
 * A playbook per domain, written by the harness after a task on that domain succeeds and read by the next one that
 * starts there: the search address that worked, the path through the site, and the traps it had to get past.
 *
 * It is never hand-authored and never holds anything the user or the page wrote: the search address keeps the
 * parameter name and drops its value, the path keeps the kind of element and a path template (`agent/memory/global/
 * memory-store.ts` rules), and a trap is one of a fixed set of generic labels. A skill carries the date it was last
 * confirmed, the number of runs whose answer was backed by evidence and the number of failures the agent itself
 * caused on the domain; it is shown only while two more runs have confirmed it than have failed on it, so one lucky
 * run cannot teach the agent a route and one bad task cannot throw a working one away.
 */
import { createLogger } from '../../../log';
import { registrableDomain } from '../../../browser/util';
import { untrustedInline } from '../../messages/utils';
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
  /** Runs that ended on this domain with an answer the evidence backed; the skill is shown from the second. */
  confirmations: number;
  /** Runs the agent itself failed on this domain while the skill was shown. */
  failures: number;
}

/** Confirmations beyond failures a skill needs before it is shown: one run that worked is not yet a route. */
const MIN_CONFIRMATIONS = 2;

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
  // Skills written before the counts existed start at zero, so they are shown again only once new runs confirm them.
  return skills
    .filter(skill => Date.now() - skill.verifiedAt < MAX_AGE_MS)
    .map(skill => ({ ...skill, confirmations: skill.confirmations ?? 0, failures: skill.failures ?? 0 }));
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
  /**
   * Writes what worked on this domain, from the task's own trace. Called only for a run whose done the planner
   * confirmed and the evidence backed, and each such run counts as one confirmation.
   */
  async record(startUrl: string, run: SkillRun): Promise<void> {
    const domain = domainOf(startUrl);
    if (!domain) return;
    const steps = skillSteps(run.steps, domain);
    const searchUrl = [...run.urls].map(searchPattern).find(pattern => pattern && domainOf(pattern) === domain);
    if (steps.length === 0 && !searchUrl) return;
    try {
      const skills = await load();
      const known = skills.find(skill => skill.domain === domain);
      const rest = skills.filter(skill => skill.domain !== domain);
      rest.push({
        domain,
        ...(searchUrl ? { searchUrl } : {}),
        steps,
        traps: trapsFrom(run.ledger),
        verifiedAt: Date.now(),
        confirmations: (known?.confirmations ?? 0) + 1,
        // A run that worked pays back one failure: the site works again.
        failures: Math.max(0, (known?.failures ?? 0) - 1),
      });
      await store(rest);
    } catch (error) {
      logger.error('Saving the site skill failed:', error);
    }
  },

  /**
   * A task the agent itself failed on this domain while the skill was shown: one failure against its confirmations,
   * so a site that moved the control a skill names stops being quoted, while one bad task does not erase a route that
   * has worked several times. Cause and use are the executor's call (`demoteSiteSkill`).
   */
  async demote(startUrl: string): Promise<void> {
    const domain = domainOf(startUrl);
    if (!domain) return;
    try {
      const skills = await load();
      const skill = skills.find(entry => entry.domain === domain);
      if (!skill) return;
      skill.failures++;
      logger.info(`Site skill for ${domain} demoted after a failed task (confirmations ${skill.confirmations}, failures ${skill.failures})`);
      await store(skills);
    } catch (error) {
      logger.error('Demoting the site skill failed:', error);
    }
  },

  /**
   * The playbook for this start page as a note for the models; empty when there is none or it has been demoted.
   * `routeSteps` are the steps saved for this exact start page: only the ones the playbook does not already give are
   * added, so the models read one note about this site instead of two that mostly repeat each other.
   */
  async note(startUrl: string, routeSteps: RouteStep[] = []): Promise<string> {
    const domain = domainOf(startUrl);
    if (!domain) return '';
    try {
      const skill = (await load()).find(entry => entry.domain === domain && entry.confirmations - entry.failures >= MIN_CONFIRMATIONS);
      if (!skill) return '';
      const on = new Date(skill.verifiedAt).toISOString().slice(0, 10);
      const alsoDid = skillSteps(routeSteps, domain).filter(line => !skill.steps.includes(line));
      const lines = [
        skill.searchUrl ? `- its search: ${skill.searchUrl} ({q} is what you search for)` : '',
        skill.traps.length ? `- in the way last time: ${skill.traps.join(', ')}` : '',
        skill.steps.length ? `- the path that worked: ${skill.steps.join('; ')}` : '',
        alsoDid.length ? `- and from this start page: ${alsoDid.join('; ')}` : '',
      ].filter(Boolean);
      // Built from what the pages showed, so the models get it as data, like page text.
      return `[What worked on ${domain} on ${on}; it may be out of date, and the current page wins]\n${untrustedInline(lines.join('\n'))}\n`;
    } catch (error) {
      logger.error('Reading the site skill failed:', error);
      return '';
    }
  },

  async clear(): Promise<void> {
    await chrome.storage.local.remove(SKILLS_KEY);
  },
};

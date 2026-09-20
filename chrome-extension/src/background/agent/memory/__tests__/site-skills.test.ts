import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMElementNode } from '../../../browser/dom/views';
import { routeStep } from '../global/memory-store';
import { SiteSkills, domainOf, searchPattern, skillSteps, trapsFrom } from '../global/site-skills';
import type { LedgerEntry } from '../in-chat/ledger';

const store = new Map<string, unknown>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
        set: async (items: Record<string, unknown>) => Object.entries(items).forEach(([key, value]) => store.set(key, structuredClone(value))),
        remove: async (keys: string | string[]) => [keys].flat().forEach(key => store.delete(key)),
      },
    },
  });
});

const input = new DOMElementNode({ tagName: 'input', xpath: '/input', attributes: { type: 'search' }, children: [], isVisible: true });
const link = new DOMElementNode({ tagName: 'a', xpath: '/a', attributes: { role: 'link' }, children: [], isVisible: true });
const user = 'Find a blue linen shirt at shop.test';

const steps = () =>
  [
    routeStep('input_text', 'https://www.shop.test/', input, user),
    routeStep('input_text', 'https://www.shop.test/', input, user),
    routeStep('click_element', 'https://www.shop.test/search/blue-linen?q=blue+linen', link, user),
    routeStep('click_element', 'https://www.shop.test/products/48213', link, user),
  ].filter(step => step !== null);

const ledger = (...entries: Array<Partial<LedgerEntry>>): LedgerEntry[] =>
  entries.map(entry => ({ kind: 'refused', subject: '', note: '', times: 1, ...entry }));

const run = (extra: Partial<Parameters<typeof SiteSkills.record>[1]> = {}) => ({
  steps: steps(),
  urls: ['https://www.shop.test/search?q=blue+linen&sort=price'],
  ledger: [],
  ...extra,
});

describe('what a skill keeps', () => {
  it('gives one note: the playbook plus only what the route of this start page adds', async () => {
    const steps = [
      routeStep('click_element', 'https://shop.test/', link, ''),
      routeStep('click_element', 'https://shop.test/help', link, ''),
    ].filter(step => step !== null);
    await SiteSkills.record('https://shop.test/', { steps: steps.slice(0, 1), urls: [], ledger: [] });

    const note = await SiteSkills.note('https://shop.test/', steps);
    expect(note).toContain('the path that worked: click_element (link) on /');
    expect(note).toContain('and from this start page: click_element (link) on /help');
    // The step the playbook already gives is not repeated.
    expect(note.match(/click_element \(link\) on \/;|click_element \(link\) on \/$/gm)?.length ?? 1).toBe(1);
    expect(await SiteSkills.note('https://shop.test/', steps.slice(0, 1))).not.toContain('and from this start page');
  });

  it('reduces a host to its registrable domain and refuses what is not a web page', () => {
    expect(domainOf('https://www.shop.test/x')).toBe('shop.test');
    expect(domainOf('https://a.b.shop.co.uk/')).toBe('shop.co.uk');
    expect(domainOf('chrome://extensions')).toBe('');
    expect(domainOf('not a url')).toBe('');
  });

  it('keeps the search parameter name and never what was searched for', () => {
    expect(searchPattern('https://shop.test/s?k=blue+linen&ref=nav')).toBe('https://shop.test/s?k={q}');
    expect(searchPattern('https://shop.test/search?query=jamie%40example.com')).toBe('https://shop.test/search?query={q}');
    // Nothing to learn from an address with no search, or one whose search box was empty.
    expect(searchPattern('https://shop.test/products/48213')).toBe('');
    expect(searchPattern('https://shop.test/s?q=')).toBe('');
  });

  it('keeps the kind of element and a path template, not the words typed or the ids visited', () => {
    expect(skillSteps(steps(), 'shop.test')).toEqual([
      'input_text (input search) on /',
      'click_element (link) on /search/:n',
      'click_element (link) on /products/:n',
    ]);
  });

  it('names a trap generically, from the refusals the harness itself wrote', () => {
    expect(trapsFrom(ledger({ subject: 'click_element', note: 'The element is covered by a "We Care About Your Privacy" dialog' }))).toEqual([
      'a consent or cookie wall',
      'a dialog that covers the page',
    ]);
    expect(trapsFrom(ledger({ subject: 'done', note: 'the page asks you to verify you are human' }))).toEqual(['a bot check']);
    expect(trapsFrom(ledger({ subject: 'click_element', note: 'you must sign in to continue' }))).toEqual(['a login gate']);
    // A page merely visited is not a trap, and an ordinary refusal names none.
    expect(trapsFrom(ledger({ kind: 'visit', subject: 'shop.test/cookies', note: 'Cookie policy' }))).toEqual([]);
    expect(trapsFrom(ledger({ subject: 'scroll', note: 'the page did not scroll' }))).toEqual([]);
  });
});

describe('the store', () => {
  it('writes after a success and shows it to the next task on that domain', async () => {
    await SiteSkills.record('https://www.shop.test/', run({ ledger: ledger({ subject: 'click_element', note: 'covered by a cookie banner' }) }));
    const note = await SiteSkills.note('https://shop.test/some/other/page');
    expect(note).toContain('What worked on shop.test');
    expect(note).toContain('its search: https://www.shop.test/search?q={q}');
    expect(note).toContain('in the way last time: a consent or cookie wall');
    expect(note).toContain('the path that worked: input_text (input search) on /');
    // It never carries what the user or the page wrote.
    expect(note).not.toContain('blue');
    expect(note).not.toContain('48213');
  });

  it('shows nothing for another domain, or before anything has worked there', async () => {
    await SiteSkills.record('https://www.shop.test/', run());
    expect(await SiteSkills.note('https://other.test/')).toBe('');
    expect(await SiteSkills.note('chrome://extensions')).toBe('');
  });

  it('stops showing a skill the first time a task on that domain fails', async () => {
    await SiteSkills.record('https://www.shop.test/', run());
    await SiteSkills.demote('https://www.shop.test/catalogue');
    expect(await SiteSkills.note('https://www.shop.test/')).toBe('');
    // A later success confirms the site again and the skill comes back.
    await SiteSkills.record('https://www.shop.test/', run());
    expect(await SiteSkills.note('https://www.shop.test/')).toContain('What worked on shop.test');
  });

  it('keeps one skill per domain, the newest, and caps the store', async () => {
    await SiteSkills.record('https://www.shop.test/', run({ urls: [] }));
    await SiteSkills.record('https://shop.test/', run());
    expect((store.get('wg_mem:site_skills') as unknown[]).filter(skill => (skill as { domain: string }).domain === 'shop.test')).toHaveLength(1);
    for (let i = 0; i < 35; i++) await SiteSkills.record(`https://site${i}.test/`, run());
    expect(store.get('wg_mem:site_skills')).toHaveLength(30);
  });

  it('forgets a skill older than its keeping time', async () => {
    await SiteSkills.record('https://www.shop.test/', run());
    const skills = store.get('wg_mem:site_skills') as Array<{ verifiedAt: number }>;
    skills[0].verifiedAt = Date.now() - 61 * 24 * 60 * 60 * 1000;
    expect(await SiteSkills.note('https://shop.test/')).toBe('');
  });

  it('writes nothing when the run learned nothing', async () => {
    await SiteSkills.record('https://www.shop.test/', { steps: [], urls: [], ledger: [] });
    expect(await SiteSkills.note('https://shop.test/')).toBe('');
    await SiteSkills.clear();
    expect(store.has('wg_mem:site_skills')).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMElementNode } from '../../../browser/dom/views';
import { RouteMemory, pathTemplate, routeStep } from '../global/memory-store';

const store = new Map<string, unknown>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string | null) => (key === null ? Object.fromEntries(store) : store.has(key) ? { [key]: store.get(key) } : {}),
        set: async (items: Record<string, unknown>) => Object.entries(items).forEach(([key, value]) => store.set(key, structuredClone(value))),
        remove: async (keys: string | string[]) => [keys].flat().forEach(key => store.delete(key)),
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const input = new DOMElementNode({ tagName: 'input', xpath: '/input', attributes: { type: 'search' }, children: [], isVisible: true });
const link = new DOMElementNode({ tagName: 'a', xpath: '/a', attributes: {}, children: [], isVisible: true });

describe('RouteMemory', () => {
  const user = 'Find a blue linen shirt in the shop; my email is jamie@example.com';
  const steps = () => [
    routeStep('input_text', 'https://shop.test/', input, user),
    routeStep('send_keys', 'https://shop.test/', undefined, user),
    routeStep('click_element', 'https://shop.test/search/blue-linen?q=blue', link, user),
    routeStep('click_element', 'https://shop.test/products/48213', link, user),
  ].filter(step => step !== null);

  it('masks ids and the user\'s words in paths', () => {
    expect(pathTemplate('/catalogue/a-light-in-the-attic_1000/index.html')).toBe('/catalogue/:n/index.html');
    expect(pathTemplate('/search/blue-linen', new Set(['blue']))).toBe('/search/:n');
    expect(pathTemplate('/c/0123456789abcdef0123456789')).toBe('/c/:n');
  });

  it('shows the route only on the start page it was saved for', async () => {
    await RouteMemory.save('https://shop.test/?ref=home', steps());
    const note = await RouteMemory.note('https://shop.test/');
    expect(note).toContain('it may be outdated, and the current page wins');
    expect(note).toContain('1. input_text (input search) on /');
    expect(note).toContain('3. click_element (a) on /search/:n');
    expect(await RouteMemory.note('https://shop.test/help')).toBe('');
    expect(await RouteMemory.note('https://other.test/')).toBe('');
  });

  it('stores nothing the user wrote and removes the old task-text stores', async () => {
    store.set('wg_mem:episodes', [{ intent: user }]);
    store.set('wg_mem:domains', [{ domain: 'shop.test' }]);
    await RouteMemory.save('https://shop.test/', steps());
    const saved = JSON.stringify(Object.fromEntries(store)).toLowerCase();
    for (const word of ['blue', 'linen', 'shirt', 'jamie', 'example', '48213', 'q=']) expect(saved).not.toContain(word);
    expect(store.has('wg_mem:episodes')).toBe(false);
    expect(store.has('wg_mem:domains')).toBe(false);
  });

  it('forgets routes after 30 days, keeps at most 50, and clears on request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await RouteMemory.save('https://old.test/', steps());
    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
    expect(await RouteMemory.note('https://old.test/')).toBe('');

    for (let i = 0; i < 55; i++) await RouteMemory.save(`https://site${String.fromCharCode(97 + (i % 26))}${i >= 26 ? 'x' : ''}${i >= 52 ? 'y' : ''}.test/`, steps());
    expect((store.get('wg_mem:routes') as unknown[]).length).toBe(50);

    await RouteMemory.clear();
    expect(store.has('wg_mem:routes')).toBe(false);
  });
});

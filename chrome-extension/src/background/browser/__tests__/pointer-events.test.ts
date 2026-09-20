/**
 * What the browser is actually told when the agent points at something.
 *
 * A live run showed clicks that changed nothing on the page and then worked when they were sent again — half of the
 * retried ones. The events carried no `buttons` bitmask, so a press claimed no button was down, and any widget that
 * reads `MouseEvent.buttons` (menus, sliders, drag handles, anything pointer-driven) had no reason to react. These
 * tests pin the shape of every gesture against what a real mouse sends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js', () => ({
  connect: vi.fn(),
  ExtensionTransport: { connectTab: vi.fn() },
}));

import Page from '../page';
import { DOMElementNode } from '../dom/views';
import type { IBrowserAdapter } from '../../adapters/IBrowserAdapter';

type Sent = { method: string; params: Record<string, unknown> };

const node = (tagName = 'button') => new DOMElementNode({ tagName, xpath: null, attributes: {}, children: [], isVisible: true });

describe('the mouse events a gesture sends', () => {
  let sent: Sent[];
  let page: Page;

  beforeEach(() => {
    sent = [];
    const adapter = {
      addTabCreatedListener: vi.fn(),
      removeTabCreatedListener: vi.fn(),
      sendTabMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as IBrowserAdapter;
    page = new Page(7, 'https://example.com/', 'Example', {}, adapter);
    const target = {
      scrollIntoView: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (fn: unknown) => (String(fn).includes('scrollX') ? [0, 0] : null)),
      boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 200, width: 80, height: 30 }),
      clickablePoint: vi.fn().mockResolvedValue({ x: 140, y: 215 }),
    };
    const handle = { evaluateHandle: vi.fn().mockResolvedValue({ asElement: () => target }) };
    const client = { send: vi.fn(async (method: string, params: Record<string, unknown>) => void sent.push({ method, params })) };
    Object.assign(page as unknown as Record<string, unknown>, {
      _puppeteerPage: { evaluate: vi.fn().mockResolvedValue(undefined) },
      _pageClient: () => client,
      _requireHandle: vi.fn().mockResolvedValue(handle),
    });
  });

  const mouse = () => sent.filter(event => event.method === 'Input.dispatchMouseEvent').map(event => event.params);

  it('moves with no button held, presses with the left bit set, releases with none', async () => {
    await page.clickNode(node());
    expect(mouse()).toEqual([
      { type: 'mouseMoved', x: 140, y: 215, button: 'none', buttons: 0, modifiers: 0, pointerType: 'mouse' },
      { type: 'mousePressed', x: 140, y: 215, button: 'left', buttons: 1, modifiers: 0, clickCount: 1, pointerType: 'mouse' },
      { type: 'mouseReleased', x: 140, y: 215, button: 'left', buttons: 0, modifiers: 0, clickCount: 1, pointerType: 'mouse' },
    ]);
  });

  it('holds the right-button bit for a right click', async () => {
    await page.rightClickNode(node());
    const press = mouse().find(event => event.type === 'mousePressed');
    expect(press).toMatchObject({ button: 'right', buttons: 2 });
    expect(mouse().find(event => event.type === 'mouseReleased')).toMatchObject({ button: 'right', buttons: 0 });
  });

  it('hovers with a move alone: nothing is pressed, so nothing is activated', async () => {
    await page.hoverNode(node());
    expect(mouse().map(event => event.type)).toEqual(['mouseMoved']);
    expect(mouse()[0]).toMatchObject({ buttons: 0, button: 'none' });
  });

  it('counts the clicks of a double click, and holds the button through both', async () => {
    await page.clickNode(node(), 2);
    const presses = mouse().filter(event => event.type === 'mousePressed');
    expect(presses.map(event => event.clickCount)).toEqual([1, 2]);
    expect(presses.every(event => event.buttons === 1)).toBe(true);
  });

  it('points where the element is, not where the page read found it', async () => {
    await page.clickNode(node());
    expect(mouse().every(event => event.x === 140 && event.y === 215)).toBe(true);
  });

  it('sends the gesture in the order a hand makes it: move, press, release', async () => {
    await page.clickNode(node());
    expect(mouse().map(event => event.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
  });

  it('never sends a modifier the agent did not ask for', async () => {
    await page.clickNode(node());
    expect(mouse().every(event => event.modifiers === 0)).toBe(true);
  });
});

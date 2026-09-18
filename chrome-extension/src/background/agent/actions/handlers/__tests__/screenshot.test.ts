import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { call, createHarness, done, plan, settle, stubChrome, textOf, until } from '../../../__tests__/fakes';
import { clampClip, highlightRects } from '../../../../browser/page';
import { DOMElementNode } from '../../../../browser/dom/views';

beforeEach(() => {
  vi.useFakeTimers();
  stubChrome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs one view_screenshot call and returns what the next screenshot was asked to show and what the model was told. */
async function shoot(args: Record<string, unknown>) {
  const h = createHarness({
    pages: [{ url: 'https://app.test/', title: 'App', elements: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }] }],
    planner: Array(6).fill(plan()),
    navigator: [call('view_screenshot', args), done('Looked')],
    extraArgs: { agentOptions: { useVision: true } },
  });
  const execution = h.executor.execute();
  await until(() => h.llm.remaining('navigator') === 0);
  await h.executor.cancel();
  await settle(execution);
  return {
    options: h.browser.screenshotOptions,
    said: h.llm.requestsFor('navigator').map(request => textOf(request.messages)).join('\n'),
  };
}

describe('view_screenshot', () => {
  it('still takes the whole visible page, labelled, when it is called with nothing', async () => {
    const { options, said } = await shoot({});
    expect(options).toBeNull();
    expect(said).toContain('A screenshot of the visible part of the page comes with your next browser state');
    expect(said).toContain('with the element indexes drawn on it');
  });

  it('frames one element with room around it, so vision is spent on the part that matters', async () => {
    const { options, said } = await shoot({ index: 1 });
    // Element 1 is 200x30 at (20, 50); the margin is half its longest side, at least 40.
    expect(options?.clip).toEqual({ x: -80, y: -50, width: 400, height: 230 });
    expect(said).toContain('element [1] and its surroundings');
  });

  it('takes a region of the visible page', async () => {
    const { options } = await shoot({ region: [10, 20, 300, 200] });
    expect(options?.clip).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('refuses a region that is not four numbers with a size', async () => {
    expect((await shoot({ region: [10, 20, 0, 200] })).said).toContain('region must be [x, y, width, height]');
    expect((await shoot({ region: [10, 20] })).said).toContain('region must be [x, y, width, height]');
  });

  it('can leave the index boxes off, for an image where they would cover what is being looked at', async () => {
    const { options, said } = await shoot({ annotate: false });
    expect(options).toEqual({ clip: undefined, scrollY: 0, annotate: false });
    expect(said).toContain('with no index boxes');
  });

  it('says which element it cannot frame instead of sending the whole page', async () => {
    expect((await shoot({ index: 99 })).said).toContain('99');
  });
});

describe('what a clipped screenshot labels', () => {
  const at = (index: number, x: number, y: number, width = 100, height = 20) => {
    const node = new DOMElementNode({ tagName: 'button', xpath: `/b[${index}]`, attributes: {}, children: [], isVisible: true });
    node.pageCoordinates = {
      topLeft: { x, y },
      topRight: { x: x + width, y },
      bottomLeft: { x, y: y + height },
      bottomRight: { x: x + width, y: y + height },
      center: { x: x + width / 2, y: y + height / 2 },
      width,
      height,
    };
    return [index, node] as const;
  };

  it('labels everything measured when the screenshot is the whole page', () => {
    const map = new Map([at(0, 0, 0), at(1, 0, 900)]);
    expect(highlightRects(map).map(rect => rect.index)).toEqual([0, 1]);
  });

  it('labels only the elements the clip shows, matching the clip to the page through the scroll', () => {
    const map = new Map([at(0, 0, 0), at(1, 0, 500), at(2, 0, 560), at(3, 400, 520)]);
    // A 0..100 window of the viewport while the page is scrolled 500 down covers page rows 500..600.
    const rects = highlightRects(map, { clip: { x: 0, y: 0, width: 300, height: 100 }, scrollY: 500 });
    expect(rects.map(rect => rect.index)).toEqual([1, 2]);
  });

  it('skips an element with no measured box', () => {
    const node = new DOMElementNode({ tagName: 'button', xpath: '/b', attributes: {}, children: [], isVisible: true });
    expect(highlightRects(new Map([[0, node]]))).toEqual([]);
  });
});

describe('a region is clamped to the viewport', () => {
  const view = { width: 1000, height: 800 };

  it('keeps a region that already fits', () => {
    expect(clampClip({ x: 10, y: 20, width: 300, height: 200 }, view)).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('pulls a region that starts or reaches outside back in, because Chrome captures nothing from one that does not', () => {
    expect(clampClip({ x: -50, y: -50, width: 200, height: 200 }, view)).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    expect(clampClip({ x: 900, y: 700, width: 400, height: 400 }, view)).toEqual({ x: 900, y: 700, width: 100, height: 100 });
    expect(clampClip({ x: 5000, y: 5000, width: 100, height: 100 }, view)).toEqual({ x: 999, y: 799, width: 1, height: 1 });
  });

  it('is the whole viewport without a region', () => {
    expect(clampClip(undefined, view)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });
});

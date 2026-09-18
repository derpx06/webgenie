import { describe, expect, it } from 'vitest';
import {
  caretTrack,
  chipPlacement,
  clampPoint,
  DEFAULT_STAGE,
  haloBox,
  motion,
  ringOffset,
  STAGE_COLORS,
  stageColors,
  stageForAction,
  targetPoint,
  travelMotion,
  truncateGoal,
  typingCursorPoint,
  typingSweep,
} from '../core';
import type { ActionKind, Rect } from '../core';

const VIEWPORT = { width: 1200, height: 800 };
const rect = (over: Partial<Rect> = {}): Rect => ({ x: 100, y: 200, w: 160, h: 40, r: 8, ...over });

describe('stage colours', () => {
  it('gives every action kind a stage that has a colour', () => {
    const kinds: ActionKind[] = ['click', 'type', 'scroll', 'read', 'wait', 'ask', 'done', 'error'];
    for (const kind of kinds) expect(STAGE_COLORS[stageForAction(kind)]).toBeDefined();
  });

  it('falls back to the default stage for an unknown one', () => {
    expect(stageColors(undefined)).toBe(STAGE_COLORS[DEFAULT_STAGE]);
    expect(stageColors('nonsense' as never)).toBe(STAGE_COLORS[DEFAULT_STAGE]);
  });

  it('paints a click and a keystroke differently, and an error in its own colour', () => {
    expect(stageForAction('click')).toBe('clicking');
    expect(stageForAction('type')).toBe('typing');
    expect(stageForAction('error')).toBe('error');
    expect(stageForAction('ask')).toBe(stageForAction('wait'));
  });
});

describe('truncateGoal', () => {
  it('leaves a short goal alone and collapses whitespace', () => {
    expect(truncateGoal('  Open  the\ncart ')).toBe('Open the cart');
  });

  it('cuts at a word boundary and marks the cut', () => {
    const out = truncateGoal('Find the cheapest overnight flight from Berlin to Lisbon', 30);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out).not.toMatch(/ …$/);
  });

  it('hard-cuts a single word longer than the chip', () => {
    expect(truncateGoal('a'.repeat(80), 10)).toBe(`${'a'.repeat(10)}…`);
  });

  it('is empty for no goal', () => {
    expect(truncateGoal(undefined)).toBe('');
  });
});

describe('cursor geometry', () => {
  it('aims at the centre of the element', () => {
    expect(targetPoint(rect(), VIEWPORT)).toEqual({ x: 180, y: 220 });
  });

  it('aims at the middle of the page when no element is involved', () => {
    expect(targetPoint(undefined, VIEWPORT)).toEqual({ x: 600, y: 400 });
  });

  it('keeps an off-screen target inside the viewport', () => {
    expect(clampPoint({ x: -400, y: 5000 }, VIEWPORT)).toEqual({ x: 16, y: 784 });
    expect(clampPoint({ x: 180, y: 220 }, VIEWPORT)).toEqual({ x: 180, y: 220 });
  });

  it('never leaves the viewport even when it is smaller than the margins', () => {
    const point = clampPoint({ x: 50, y: 50 }, { width: 10, height: 10 });
    expect(point).toEqual({ x: 16, y: 16 });
  });
});

describe('chipPlacement', () => {
  const size = { width: 200, height: 26 };

  it('trails the cursor to the lower right when there is room', () => {
    const place = chipPlacement({ x: 100, y: 100 }, size, VIEWPORT);
    expect(place).toMatchObject({ x: 118, y: 118, flipX: false });
  });

  it('flips to the other side near the right and bottom edges', () => {
    const place = chipPlacement({ x: 1180, y: 790 }, size, VIEWPORT);
    expect(place.flipX).toBe(true);
    expect(place.x + size.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(place.y + size.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('never places the chip off the left edge', () => {
    expect(chipPlacement({ x: 4, y: 790 }, size, VIEWPORT).x).toBeGreaterThanOrEqual(8);
  });

  const overlaps = (place: { x: number; y: number }, box: Rect) =>
    place.x < box.x + box.w && place.x + size.width > box.x && place.y < box.y + box.h && place.y + size.height > box.y;

  it('clears the element the agent is about to touch', () => {
    const field = rect({ x: 200, y: 260, w: 600, h: 52 });
    // The cursor is inside the field, so trailing it would put the chip straight on top of the field.
    const place = chipPlacement({ x: 400, y: 286 }, size, VIEWPORT, 18, field);
    expect(overlaps(place, field)).toBe(false);
    expect(place.y).toBeGreaterThanOrEqual(field.y + field.h);
  });

  it('goes above the element when there is no room under it', () => {
    const footer = rect({ x: 200, y: 700, w: 600, h: 90 });
    const place = chipPlacement({ x: 400, y: 745 }, size, VIEWPORT, 18, footer);
    expect(overlaps(place, footer)).toBe(false);
    expect(place.flipY).toBe(true);
  });

  it('hugs a viewport edge rather than covering an element that fills the page', () => {
    const huge = rect({ x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height });
    const place = chipPlacement({ x: 600, y: 400 }, size, VIEWPORT, 18, huge);
    expect(place.x).toBeGreaterThanOrEqual(8);
    expect(place.x + size.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(place.y + size.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('still just trails the cursor when there is no element to clear', () => {
    expect(chipPlacement({ x: 100, y: 100 }, size, VIEWPORT)).toMatchObject({ x: 118, y: 118, flipY: false });
  });
});

describe('haloBox', () => {
  it('grows the element box and keeps the curve concentric', () => {
    const box = haloBox(rect(), VIEWPORT);
    expect(box).toMatchObject({ x: 96, y: 196, width: 168, height: 48, radius: 12 });
  });

  it('gives a square element a gentle default curve', () => {
    expect(haloBox(rect({ r: 0 }), VIEWPORT).radius).toBe(6);
  });

  it('never draws a curve larger than half the box', () => {
    const box = haloBox(rect({ w: 12, h: 12, r: 999 }), VIEWPORT);
    expect(box.radius).toBe(box.height / 2);
  });

  it('clips to the viewport so the glow cannot reach past the page', () => {
    const box = haloBox(rect({ x: 1150, y: 780, w: 400, h: 200 }), VIEWPORT);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width + 4);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height + 4);
  });

  it('reports no box for an element that is entirely off-screen', () => {
    const box = haloBox(rect({ x: -900, y: 200, w: 100, h: 40 }), VIEWPORT);
    expect(box.width).toBe(0);
  });
});

describe('caretTrack', () => {
  it('sits inside the field and travels its inner width', () => {
    const track = caretTrack(rect(), VIEWPORT);
    expect(track).toMatchObject({ x: 110, y: 220, travel: 140 });
    expect(track.height).toBeLessThanOrEqual(rect().h);
  });

  it('never travels a negative distance in a tiny field', () => {
    expect(caretTrack(rect({ w: 6, h: 6 }), VIEWPORT).travel).toBeGreaterThanOrEqual(0);
  });
});

describe('ringOffset', () => {
  const circumference = 100;

  it('is empty with no limit and no step', () => {
    expect(ringOffset(undefined, undefined, circumference)).toBe(circumference);
    expect(ringOffset(3, 0, circumference)).toBe(circumference);
  });

  it('fills in proportion to the steps used', () => {
    expect(ringOffset(0, 10, circumference)).toBe(100);
    expect(ringOffset(5, 10, circumference)).toBe(50);
    expect(ringOffset(10, 10, circumference)).toBe(0);
  });

  it('cannot overfill past the limit', () => {
    expect(ringOffset(40, 10, circumference)).toBe(0);
  });
});

describe('motion', () => {
  it('keeps full durations normally and clips them when less motion was asked for', () => {
    expect(motion(false, 620)).toBe(620);
    expect(motion(true, 620)).toBe(140);
    expect(motion(true, 80)).toBe(80);
  });
});

describe('travelMotion', () => {
  it('leans into the direction it is travelling and unwinds the sign on the way back', () => {
    const right = travelMotion({ x: 0, y: 0 }, { x: 400, y: 0 });
    const left = travelMotion({ x: 400, y: 0 }, { x: 0, y: 0 });
    expect(right.tilt).toBeGreaterThan(0);
    expect(left.tilt).toBe(-right.tilt);
    expect(right.distance).toBe(400);
  });

  it('never leans further than the cap, however far it travels', () => {
    expect(travelMotion({ x: 0, y: 0 }, { x: 5000, y: 0 }).tilt).toBe(11);
    expect(travelMotion({ x: 0, y: 0 }, { x: 5000, y: 0 }, 6).tilt).toBe(6);
  });

  it('barely leans on a short hop, and not at all on a straight drop', () => {
    expect(travelMotion({ x: 0, y: 0 }, { x: 20, y: 0 }).tilt).toBeLessThan(1.5);
    expect(travelMotion({ x: 0, y: 0 }, { x: 0, y: 300 }).tilt).toBe(0);
  });

  it('points the smear back the way it came', () => {
    // Travelling right means the trail lies to the left: 180 degrees.
    expect(Math.abs(travelMotion({ x: 0, y: 0 }, { x: 100, y: 0 }).trail)).toBe(180);
    expect(travelMotion({ x: 100, y: 0 }, { x: 0, y: 0 }).trail).toBe(0);
    // CSS rotates clockwise, so travelling down leaves the trail pointing up: -90 degrees.
    expect(travelMotion({ x: 0, y: 0 }, { x: 0, y: 100 }).trail).toBe(-90);
    expect(travelMotion({ x: 0, y: 100 }, { x: 0, y: 0 }).trail).toBe(90);
  });

  it('has nothing to say about a cursor that did not move', () => {
    expect(travelMotion({ x: 7, y: 7 }, { x: 7, y: 7 })).toEqual({ distance: 0, tilt: 0, trail: 0 });
  });
});

describe('typingSweep', () => {
  it('starts at the left edge, ends at the far end, and only ever moves forward', () => {
    const sweep = typingSweep(200);
    expect(sweep[0]).toEqual({ offset: 0, x: 0 });
    expect(sweep[sweep.length - 1]).toEqual({ offset: 1, x: 200 });
    for (let i = 1; i < sweep.length; i += 1) {
      expect(sweep[i].offset).toBeGreaterThanOrEqual(sweep[i - 1].offset);
      expect(sweep[i].x).toBeGreaterThanOrEqual(sweep[i - 1].x);
    }
  });

  it('types in bursts with a pause between them, rather than sliding at a constant speed', () => {
    const sweep = typingSweep(200, 4);
    // Each burst contributes a move and a hold at the same x: that repeated x is the thinking pause.
    const holds = sweep.filter((frame, i) => i > 0 && frame.x === sweep[i - 1].x);
    expect(holds).toHaveLength(4);
    // Halfway through the animation the caret is nowhere near exactly halfway across the field.
    const midway = sweep.find(frame => frame.offset === 0.5);
    expect(midway?.x).toBe(100);
  });

  it('degrades to a straight line for an empty or nonsensical field', () => {
    expect(typingSweep(0)).toEqual([
      { offset: 0, x: 0 },
      { offset: 1, x: 0 },
    ]);
    expect(typingSweep(-40)).toEqual([
      { offset: 0, x: 0 },
      { offset: 1, x: 0 },
    ]);
    expect(typingSweep(100, 0)).toEqual([
      { offset: 0, x: 0 },
      { offset: 1, x: 100 },
    ]);
  });

  it('stays inside the animation for any number of bursts', () => {
    for (const bursts of [1, 2, 7, 20]) {
      const sweep = typingSweep(300, bursts);
      expect(sweep.every(frame => frame.offset >= 0 && frame.offset <= 1)).toBe(true);
      expect(sweep[sweep.length - 1].x).toBe(300);
    }
  });
});

describe('typingCursorPoint', () => {
  const track = caretTrack(rect(), VIEWPORT);

  it('puts the tip just past the caret so the arrow does not sit on the text', () => {
    const point = typingCursorPoint(track);
    expect(point.x).toBeGreaterThan(track.x);
    expect(point.y).toBeGreaterThan(track.y);
    expect(point.y).toBeLessThan(track.y + track.height / 2);
  });

  it('walks right with the text and holds the same line', () => {
    const start = typingCursorPoint(track, 0);
    const end = typingCursorPoint(track, track.travel);
    expect(end.x - start.x).toBe(track.travel);
    expect(end.y).toBe(start.y);
  });

  it('never walks backwards past the start of the field', () => {
    expect(typingCursorPoint(track, -50)).toEqual(typingCursorPoint(track, 0));
  });
});

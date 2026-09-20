/**
 * The pure parts of the on-page agent presence overlay: colours, geometry and the small decisions
 * that place the cursor, its chip and the halo. No DOM here, so every rule is unit-testable.
 */

export type WorkflowStage =
  | 'researching'
  | 'typing'
  | 'clicking'
  | 'waiting'
  | 'planning'
  | 'comparing'
  | 'completed'
  | 'error'
  | 'idle';

export type ActionKind = 'click' | 'type' | 'scroll' | 'read' | 'wait' | 'ask' | 'done' | 'error';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** One colour per stage, shared by the cursor, the halo, the caret, the capsule and the ambient border. */
export const STAGE_COLORS: Record<WorkflowStage, { primary: string; secondary: string; speed: string }> = {
  researching: { primary: '56, 178, 255', secondary: '120, 220, 255', speed: '4.5s' },
  typing: { primary: '96, 200, 255', secondary: '150, 230, 255', speed: '2.6s' },
  clicking: { primary: '110, 214, 255', secondary: '170, 238, 255', speed: '2s' },
  waiting: { primary: '255, 186, 66', secondary: '255, 214, 130', speed: '5.5s' },
  planning: { primary: '162, 118, 255', secondary: '198, 168, 255', speed: '4.5s' },
  comparing: { primary: '58, 210, 186', secondary: '130, 236, 218', speed: '3.4s' },
  completed: { primary: '74, 214, 126', secondary: '146, 238, 176', speed: '7s' },
  error: { primary: '255, 94, 94', secondary: '255, 150, 150', speed: '1.6s' },
  idle: { primary: '140, 156, 176', secondary: '180, 194, 210', speed: '8s' },
};

export const DEFAULT_STAGE: WorkflowStage = 'researching';

/** The stage an action paints itself in, so a click and the border never disagree about the colour. */
export function stageForAction(kind: ActionKind): WorkflowStage {
  switch (kind) {
    case 'click':
      return 'clicking';
    case 'type':
      return 'typing';
    case 'scroll':
      return 'researching';
    case 'read':
      return 'comparing';
    case 'wait':
    case 'ask':
      return 'waiting';
    case 'done':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return DEFAULT_STAGE;
  }
}

export function stageColors(stage: WorkflowStage | undefined) {
  return STAGE_COLORS[stage ?? DEFAULT_STAGE] ?? STAGE_COLORS[DEFAULT_STAGE];
}

/** A goal line cut to a chip's worth of words, with an ellipsis only when something was actually cut. */
export function truncateGoal(text: string | undefined, max = 42): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Cutting mid-word reads as a typo; fall back to the hard cut only when the first word is longer than the chip.
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The point the cursor travels to: the element's centre, or the page centre when no element is involved. */
export function targetPoint(rect: Rect | undefined, viewport: Viewport): Point {
  if (!rect) return { x: viewport.width / 2, y: viewport.height / 2 };
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Where the cursor belongs for an action on this element: typing starts at the head of the field, where the first
 * character goes; everything else presses the middle. Used both when the action starts and when the gesture reports
 * the element's real position, so a correction lands exactly where the first aim was meant to.
 */
export function aimPoint(kind: ActionKind, rect: Rect | undefined, viewport: Viewport): Point {
  return aimPlan(kind, rect, viewport).point;
}

/**
 * Where the cursor goes for this action, and the caret's walk when it is a typing one. Typing is choreographed from
 * the field's box, so a correction that moved only the cursor left the caret writing in the field's old place and the
 * walk dragged the cursor back to it.
 */
export function aimPlan(
  kind: ActionKind,
  rect: Rect | undefined,
  viewport: Viewport,
): { point: Point; track: ReturnType<typeof caretTrack> | null } {
  const track = kind === 'type' && rect ? caretTrack(rect, viewport) : null;
  return { point: clampPoint(track ? typingCursorPoint(track) : targetPoint(rect, viewport), viewport), track };
}

/** Keeps the cursor inside the viewport: an element scrolled just out of frame still shows where the agent is. */
export function clampPoint(point: Point, viewport: Viewport, margin = 16): Point {
  return {
    x: Math.min(Math.max(point.x, margin), Math.max(margin, viewport.width - margin)),
    y: Math.min(Math.max(point.y, margin), Math.max(margin, viewport.height - margin)),
  };
}

/**
 * Where the goal chip sits.
 *
 * The chip labels what the agent is about to do, so the one place it must never be is on top of the
 * thing it is labelling — or on the pointer that is reaching for it. Sides are tried in order of how
 * naturally they read (trailing the cursor first, then under the element, then the mirrored sides);
 * the first one that fits the viewport and clears the target wins. When the target is big enough that
 * no side is free, the chip goes against the nearest viewport edge on whichever side of the target has
 * more room — a chip half off the page is still readable, a chip over the target is not.
 */
export function chipPlacement(
  point: Point,
  size: { width: number; height: number },
  viewport: Viewport,
  gap = 18,
  avoid?: Rect,
) {
  const edge = 8;
  const maxX = Math.max(edge, viewport.width - size.width - edge);
  const maxY = Math.max(edge, viewport.height - size.height - edge);
  const blocked = avoid
    ? { left: avoid.x - gap, top: avoid.y - gap, right: avoid.x + avoid.w + gap, bottom: avoid.y + avoid.h + gap }
    : null;
  const hits = (x: number, y: number) =>
    !!blocked &&
    x < blocked.right &&
    x + size.width > blocked.left &&
    y < blocked.bottom &&
    y + size.height > blocked.top;

  const right = point.x + gap;
  const left = point.x - gap - size.width;
  const under = (avoid ? avoid.y + avoid.h : point.y) + gap;
  const over = (avoid ? avoid.y : point.y) - gap - size.height;
  const candidates = [
    { x: right, y: point.y + gap },
    { x: right, y: under },
    { x: left, y: point.y + gap },
    { x: left, y: under },
    { x: right, y: over },
    { x: left, y: over },
  ];
  for (const spot of candidates) {
    if (spot.x < edge || spot.x > maxX || spot.y < edge || spot.y > maxY) continue;
    if (hits(spot.x, spot.y)) continue;
    return { x: spot.x, y: spot.y, flipX: spot.x < point.x, flipY: spot.y < point.y };
  }

  // Nothing clears it: take the gap above or below the target, whichever is deeper, and hug that edge.
  const roomBelow = avoid ? viewport.height - (avoid.y + avoid.h) : viewport.height;
  const roomAbove = avoid ? avoid.y : 0;
  const y = Math.min(Math.max(roomBelow >= roomAbove ? maxY : edge, edge), maxY);
  const x = Math.min(Math.max(point.x + gap > maxX ? left : right, edge), maxX);
  return { x, y, flipX: x < point.x, flipY: y < point.y };
}

/**
 * The halo's box: the element's own rect and corner radius, grown by a few pixels so the glow reads as
 * light around the element rather than a border on it, and clipped to the viewport.
 */
export function haloBox(rect: Rect, viewport: Viewport, grow = 4) {
  const left = Math.max(-grow, rect.x - grow);
  const top = Math.max(-grow, rect.y - grow);
  const right = Math.min(viewport.width + grow, rect.x + rect.w + grow);
  const bottom = Math.min(viewport.height + grow, rect.y + rect.h + grow);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    x: left,
    y: top,
    width,
    height,
    // The grown box needs a slightly larger curve to stay concentric with the element's own corner.
    radius: Math.min(rect.r > 0 ? rect.r + grow : 6, Math.min(width, height) / 2),
  };
}

/** Where the typing caret starts and how far it travels, from the field's box. */
export function caretTrack(rect: Rect, viewport: Viewport) {
  const box = haloBox(rect, viewport, 0);
  const inset = Math.min(10, box.width / 4);
  return {
    x: box.x + inset,
    y: box.y + box.height / 2,
    height: Math.max(12, Math.min(box.height - 8, 22)),
    travel: Math.max(0, box.width - inset * 2),
  };
}

/** `stroke-dashoffset` for a progress ring of the given circumference; an unknown limit shows an empty ring. */
export function ringOffset(step: number | undefined, limit: number | undefined, circumference: number): number {
  if (!limit || limit <= 0 || step === undefined || step < 0) return circumference;
  const fraction = Math.min(1, step / limit);
  return circumference * (1 - fraction);
}

/**
 * Durations, halved-to-nothing when the viewer asked for less motion: everything still happens, it just
 * fades in place instead of travelling.
 */
export function motion(reduced: boolean, ms: number): number {
  return reduced ? Math.min(ms, 140) : ms;
}

/** The travel easing: quick away, a touch past the target, then settle. */
export const TRAVEL_EASING = 'cubic-bezier(0.34, 1.24, 0.42, 1)';
/** Everything that is not travel — fades, dips, glows. */
export const SOFT_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * The physics of one glide, from the two points alone.
 *
 * `tilt` leans the pointer into the direction it is travelling — a hand swinging sideways tips the
 * pen — and is capped so a long sweep never looks like a cartwheel. `trail` is the compass bearing
 * of where the cursor came *from*, which is where the motion smear has to point. `distance` scales
 * how much of either effect is worth drawing.
 */
export function travelMotion(from: Point, to: Point, maxTilt = 11): { distance: number; tilt: number; trail: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  // Lean comes from sideways motion only: a straight drop should not tip the pointer over.
  const lean = distance > 0 ? (dx / distance) * Math.min(1, distance / 260) : 0;
  return {
    distance,
    tilt: Math.round(lean * maxTilt * 10) / 10,
    // `|| 0` folds a negative zero (a purely horizontal glide) back to plain 0.
    trail: distance > 0 ? (Math.atan2(-dy, -dx) * 180) / Math.PI || 0 : 0,
  };
}

/**
 * How far the caret — and the cursor with it — has moved at each moment of a typed word.
 *
 * Real typing is bursts and thinking pauses, not a constant slide, so each burst covers its share of
 * the field and then holds while the next one is "thought of". The offsets are fractions of the
 * typing animation, so the caret and the cursor can be driven from the same list and stay in step.
 */
export function typingSweep(travel: number, bursts = 4): Array<{ offset: number; x: number }> {
  const width = Math.max(0, travel);
  if (!(width > 0) || bursts < 1) {
    return [
      { offset: 0, x: 0 },
      { offset: 1, x: width },
    ];
  }
  const slot = 1 / bursts;
  const round = (n: number) => Math.min(1, Math.round(n * 1e4) / 1e4);
  const frames = [{ offset: 0, x: 0 }];
  for (let i = 1; i <= bursts; i += 1) {
    const x = (width * i) / bursts;
    // The burst lands a quarter of a slot early, then the same x is held again: that gap is the pause.
    frames.push({ offset: round(slot * (i - 0.25)), x });
    frames.push({ offset: round(slot * i), x });
  }
  frames[frames.length - 1] = { offset: 1, x: width };
  return frames;
}

/**
 * Where the pointer's tip sits while it writes: just past the caret and a hair above the text
 * baseline, so the arrow's body hangs below the line it is writing instead of covering it.
 */
export function typingCursorPoint(track: { x: number; y: number; height: number }, travelled = 0): Point {
  return { x: track.x + Math.max(0, travelled) + 2, y: track.y + track.height / 2 - 2 };
}

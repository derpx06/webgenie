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

/** Keeps the cursor inside the viewport: an element scrolled just out of frame still shows where the agent is. */
export function clampPoint(point: Point, viewport: Viewport, margin = 16): Point {
  return {
    x: Math.min(Math.max(point.x, margin), Math.max(margin, viewport.width - margin)),
    y: Math.min(Math.max(point.y, margin), Math.max(margin, viewport.height - margin)),
  };
}

/**
 * Where the goal chip sits relative to the cursor. It trails the cursor to the lower right, flips to the
 * other side near an edge, and never hangs off the viewport.
 */
export function chipPlacement(point: Point, size: { width: number; height: number }, viewport: Viewport, gap = 18) {
  const flipX = point.x + gap + size.width > viewport.width - 8;
  const flipY = point.y + gap + size.height > viewport.height - 8;
  const x = flipX ? point.x - gap - size.width : point.x + gap;
  const y = flipY ? point.y - gap - size.height : point.y + gap;
  return {
    x: Math.min(Math.max(x, 8), Math.max(8, viewport.width - size.width - 8)),
    y: Math.min(Math.max(y, 8), Math.max(8, viewport.height - size.height - 8)),
    flipX,
  };
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

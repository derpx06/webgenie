/**
 * The on-page agent presence overlay.
 *
 * Everything the agent draws on a page lives in one shadow root under one fixed, click-through host:
 * a cursor that glides to the element the agent is about to touch, a press ripple, a halo in the
 * element's own shape, a typing caret, a goal chip, the status capsule and the ambient border.
 *
 * They are one piece of design, not seven: the tokens below — one type scale, one radius scale, one
 * glass, one shadow, three durations and two easings — are the only values any of them may use, so
 * the overlay reads as a single object sitting above whatever page it happens to be on.
 *
 * It is decoration only. The host takes no pointer events, moves no page element and is hidden from
 * the accessibility tree, so it can never change what the agent clicks or what it reads.
 */
import {
  aimPoint,
  caretTrack,
  chipPlacement,
  clampPoint,
  haloBox,
  motion,
  ringOffset,
  SOFT_EASING,
  stageColors,
  stageForAction,
  TRAVEL_EASING,
  travelMotion,
  truncateGoal,
  typingCursorPoint,
  typingSweep,
} from './core';
import type { ActionKind, Point, Rect, WorkflowStage } from './core';

export const HOST_ID = 'webgenie-agent-overlay';
/** The attribute the harness sets while it captures the page; the overlay vanishes with no transition. */
export const CAPTURE_ATTRIBUTE = 'data-webgenie-capture';

/** Below the very top of the stack, so a page's own modal or toast still sits above the decoration. */
const HOST_Z_INDEX = 2147483000;
const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** How long the chip lingers after the cursor stops. */
const CHIP_REST_MS = 2400;
/** How long the capsule stays open after the last sign of life before it collapses to a dot. */
const CAPSULE_IDLE_MS = 120_000;
/** One glide to a target. Long enough to read as a hand moving, short enough not to hold up the run. */
const TRAVEL_MS = 460;
/** How long a typed field takes to fill: the caret and the cursor share this clock. */
const TYPE_MS = 1500;
/** The motion smear is drawn at this length and stretched to the distance actually travelled. */
const SMEAR_LENGTH = 90;

/** The three durations everything in the overlay is allowed to take. */
const FAST = 200;
const MEDIUM = 320;
const SLOW = 560;

const CSS = `
:host-context([${CAPTURE_ATTRIBUTE}="1"]) { display: none !important; }

:host {
  /* One type scale, one radius scale, one glass, one shadow — the whole overlay draws from these. */
  --wg-font: 500 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --wg-font-sm: 500 11.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --wg-radius: 12px;
  --wg-ink: #eef1f6;
  --wg-glass: rgba(17, 19, 25, 0.88);
  --wg-blur: blur(22px) saturate(180%);
  /* A hairline, a top light and a lift — the same three on every surface. */
  --wg-surface:
    inset 0 0 0 1px rgba(255, 255, 255, 0.11),
    inset 0 1px 0 rgba(255, 255, 255, 0.11),
    0 10px 30px rgba(0, 0, 0, 0.30),
    0 2px 6px rgba(0, 0, 0, 0.16);
}

* { box-sizing: border-box; }

/* ── Ambient border ─────────────────────────────────────────────────────── */
/* Light pooled along the edges, as inset shadow rather than a gradient: a gradient large enough to
   reach the corners draws a visible arc across a wide viewport, and blurring it costs a full-screen
   filter on every frame of the breath. The negative spreads keep the falloff tight to the edge — a
   wide, un-spread blur leaves a faint rounded rectangle drawn across the middle of a pale page. */
.border {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  opacity: 0;
  transition: opacity ${SLOW}ms ${SOFT_EASING};
  box-shadow:
    inset 0 0 0 1px rgba(var(--wg-b), 0.22),
    inset 0 0 16px -4px rgba(var(--wg-b), 0.55),
    inset 0 0 54px -16px rgba(var(--wg-a), 0.85);
}
.border.on {
  opacity: 1;
  animation: breathe var(--wg-speed, 4s) ease-in-out infinite;
}
@keyframes breathe { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }

/* ── Target halo: the element's own shape, lit from behind ──────────────── */
.halo {
  position: absolute;
  opacity: 0;
  background: radial-gradient(ellipse at center, rgba(var(--wg-b), 0.18), rgba(var(--wg-a), 0.04) 72%);
  box-shadow:
    0 0 0 1px rgba(var(--wg-b), 0.55),
    0 0 12px 2px rgba(var(--wg-a), 0.55),
    0 0 34px 8px rgba(var(--wg-a), 0.32),
    inset 0 0 12px rgba(var(--wg-b), 0.34);
}

/* ── Press ripple ───────────────────────────────────────────────────────── */
.ripple {
  position: absolute;
  width: 150px;
  height: 150px;
  margin: -75px 0 0 -75px;
  border-radius: 50%;
  opacity: 0;
  border: 2px solid rgba(var(--wg-b), 0.9);
  background: radial-gradient(circle, rgba(var(--wg-b), 0.30), rgba(var(--wg-a), 0) 68%);
  box-shadow: 0 0 22px rgba(var(--wg-a), 0.55), inset 0 0 18px rgba(var(--wg-a), 0.35);
}

/* ── Typing caret ───────────────────────────────────────────────────────── */
.caret {
  position: absolute;
  width: 2px;
  border-radius: 1px;
  opacity: 0;
  background: rgb(var(--wg-b));
  box-shadow: 0 0 5px rgba(var(--wg-a), 0.95), 0 0 13px rgba(var(--wg-a), 0.5);
}
.caret.on { animation: blink 1.1s steps(1, end) infinite; }
@keyframes blink { 0%, 58% { opacity: 1; } 59%, 100% { opacity: 0.3; } }

/* ── Cursor ─────────────────────────────────────────────────────────────── */
/* Nested layers, each owning exactly one transform, so nothing has to compose a matrix by hand:
   .cursor travels, .float breathes, .tilt leans into the direction of travel, .body presses, and the
   smear behind them all points back down the path. Only transform and opacity ever change.
   Layer (0, 0) is the pointer's tip, so every one of them pivots about the tip. */
.cursor {
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0;
  transition: opacity ${MEDIUM}ms ${SOFT_EASING};
  will-change: transform;
}
.cursor.on { opacity: 1; }
.float, .tilt, .body { display: block; transform-origin: 1px 1px; }
.cursor.idle .float { animation: breath 4.8s ease-in-out infinite; }
/* The hand is never perfectly still: a barely-there rise and swell, not a bob. */
@keyframes breath {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(0, -1.6px, 0) scale(1.035); }
}

/* The contact shadow: the pointer floats a little above the page, and lands when it presses. */
.shadow {
  position: absolute;
  left: -6px;
  top: 12px;
  width: 28px;
  height: 13px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(6, 10, 18, 0.30), rgba(6, 10, 18, 0) 70%);
  transform: translate3d(3px, 5px, 0);
  transition: transform ${FAST}ms ${SOFT_EASING}, opacity ${FAST}ms ${SOFT_EASING};
}
.cursor.press .shadow { transform: translate3d(1px, 1px, 0) scale(0.62); opacity: 0.85; }

/* Small and dense, sitting under the body rather than washing over it: a contact glow, not a blur. */
.glow {
  position: absolute;
  left: -11px;
  top: -8px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--wg-a), 0.50), rgba(var(--wg-a), 0.13) 40%, rgba(var(--wg-a), 0) 66%);
  transition: opacity ${MEDIUM}ms ${SOFT_EASING};
}
.cursor.press .glow { opacity: 0.45; }

/* Motion smear: drawn pointing right from the tip, then rotated back along the path it came from. */
.smear {
  position: absolute;
  left: 0;
  top: -6px;
  width: ${SMEAR_LENGTH}px;
  height: 12px;
  border-radius: 6px;
  opacity: 0;
  transform-origin: 0 50%;
  background: linear-gradient(to right, rgba(var(--wg-b), 0.5), rgba(var(--wg-a), 0.12) 45%, rgba(var(--wg-a), 0) 88%);
  filter: blur(4px);
}

/* The pointer's tip lands on (0, 0) of its layer, which is the point the agent is acting on. */
.arrow {
  display: block;
  margin: -1px 0 0 -1px;
  filter: drop-shadow(0 0 4px rgba(var(--wg-a), 0.55)) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.22));
}

/* ── Goal chip ──────────────────────────────────────────────────────────── */
.chip {
  position: absolute;
  max-width: 268px;
  padding: 7px 12px;
  border-radius: var(--wg-radius);
  font: var(--wg-font);
  letter-spacing: -0.05px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--wg-ink);
  background: var(--wg-glass);
  backdrop-filter: var(--wg-blur);
  -webkit-backdrop-filter: var(--wg-blur);
  box-shadow: var(--wg-surface), 0 0 24px rgba(var(--wg-a), 0.16);
  opacity: 0;
  transform: translate3d(0, 0, 0);
  transition: opacity ${MEDIUM}ms ${SOFT_EASING}, transform ${SLOW}ms ${TRAVEL_EASING};
}
.chip.on { opacity: 1; }

/* ── Status capsule ─────────────────────────────────────────────────────── */
.capsule {
  position: absolute;
  bottom: 24px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  max-width: min(440px, 64vw);
  padding: 0 18px 0 9px;
  border-radius: 20px;
  color: var(--wg-ink);
  font: var(--wg-font);
  letter-spacing: -0.05px;
  white-space: nowrap;
  overflow: hidden;
  background: var(--wg-glass);
  backdrop-filter: var(--wg-blur);
  -webkit-backdrop-filter: var(--wg-blur);
  box-shadow: var(--wg-surface), 0 0 30px rgba(var(--wg-a), 0.15);
  opacity: 0;
  transform: translate3d(-50%, 130%, 0);
  transition:
    opacity ${MEDIUM}ms ${SOFT_EASING},
    transform ${SLOW}ms ${TRAVEL_EASING},
    max-width ${SLOW}ms ${SOFT_EASING},
    padding ${SLOW}ms ${SOFT_EASING},
    gap ${SLOW}ms ${SOFT_EASING};
}
.capsule.on { opacity: 1; transform: translate3d(-50%, 0, 0); }
/* Collapsed, it is exactly the ring in a circle the same height as the open capsule. */
.capsule.tiny { max-width: 40px; padding: 0 9px; gap: 0; }
.capsule .text {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  opacity: 1;
  transition: opacity ${FAST}ms ${SOFT_EASING};
}
.capsule.tiny .text { opacity: 0; }
.capsule .label { overflow: hidden; text-overflow: ellipsis; }
/* The step count is support, not headline: smaller, quieter, and gone when there is no limit. */
.capsule .count {
  flex: none;
  font: var(--wg-font-sm);
  font-variant-numeric: tabular-nums;
  color: rgba(238, 241, 246, 0.5);
}
.capsule .count:empty { display: none; }
.ring { display: block; flex: none; width: 22px; height: 22px; transform: rotate(-90deg); }
.ring .track { fill: none; stroke: rgba(255, 255, 255, 0.14); stroke-width: 2; }
.ring .fill {
  fill: none;
  stroke: rgb(var(--wg-b));
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: ${RING_CIRCUMFERENCE.toFixed(2)};
  filter: drop-shadow(0 0 4px rgba(var(--wg-a), 0.85));
  transition: stroke-dashoffset ${SLOW}ms ${SOFT_EASING};
}
.ring .pip {
  fill: rgb(var(--wg-b));
  filter: drop-shadow(0 0 4px rgba(var(--wg-a), 0.85));
  animation: pip 2.4s ease-in-out infinite;
}
@keyframes pip { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

/* ── Less motion: everything still happens, nothing travels ─────────────── */
@media (prefers-reduced-motion: reduce) {
  .chip, .capsule { transition-property: opacity; }
  .border.on, .cursor.idle .float, .caret.on, .ring .pip { animation: none; }
  .shadow, .glow { transition: none; }
  .smear { display: none; }
}
`;

/**
 * The pointer.
 *
 * The silhouette is a pointer whose every corner — the tip, the bottom heel, the tail — is a quadratic
 * fillet rather than a hard join, which is what separates a designed object from a screenshot of a
 * system arrow. It is drawn as an explicit rounded path rather than by stroking a sharp one with round
 * joins: a stroke wide enough to round the corners also fills in the notch beside the tail and turns
 * the shape into a blob.
 *
 * Three passes: a dark rim so it survives a white page, a body that runs from white at the tip to a
 * cool grey at the tail so it has volume, and a light bevel down its upper-left edge that fades out
 * before the tail, so it stays crisp on a dark page. The tip sits at (1, 1), which `.arrow`'s negative
 * margin pulls onto the point the agent is acting on.
 */
const ARROW_PATH =
  'M1.63 1.57 Q1.0 1.0 1.0 1.85 L1.0 15.1 Q1.0 16.6 2.13 15.61 L4.41 13.59 Q5.2 12.9 5.6 13.87 ' +
  'L7.6 18.63 Q8.0 19.6 8.97 19.19 L9.63 18.91 Q10.6 18.5 10.2 17.53 L8.3 12.87 Q7.9 11.9 8.95 11.9 ' +
  'L11.9 11.9 Q13.2 11.9 12.23 11.03 Z';
const ARROW = `
<svg class="arrow" width="17" height="23" viewBox="0 0 16 22" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="wgSkin" x1="0.1" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.45" stop-color="#f8fafd"/>
      <stop offset="1" stop-color="#d6dfeb"/>
    </linearGradient>
    <linearGradient id="wgBevel" x1="0" y1="0" x2="0.55" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="${ARROW_PATH}" fill="rgba(9,13,21,0.5)" stroke="rgba(9,13,21,0.5)" stroke-width="2" stroke-linejoin="round"/>
  <path d="${ARROW_PATH}" fill="url(#wgSkin)"/>
  <path d="${ARROW_PATH}" fill="none" stroke="url(#wgBevel)" stroke-width="1.1" stroke-linejoin="round"/>
</svg>`;

interface StatusUpdate {
  active: boolean;
  stage?: WorkflowStage;
  status?: string;
  step?: number;
  stepLimit?: number;
  showBorder?: boolean;
  showCapsule?: boolean;
}

interface ActionUpdate {
  kind: ActionKind;
  rect?: Rect;
  goal?: string;
}

/** What `play` substitutes when the viewer asked for less motion: the beat still happens, in place. */
const FADE_IN_PLACE: Keyframe[] = [{ opacity: 0 }, { opacity: 0.85 }, { opacity: 0 }];

export class Presence {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly border: HTMLElement;
  private readonly halo: HTMLElement;
  private readonly ripple: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly cursor: HTMLElement;
  private readonly tilt: HTMLElement;
  private readonly body: HTMLElement;
  private readonly smear: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly capsule: HTMLElement;
  private readonly label: HTMLElement;
  private readonly count: HTMLElement;
  private readonly ringFill: SVGCircleElement;
  private readonly reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');

  private chipTimer: ReturnType<typeof setTimeout> | null = null;
  private capsuleTimer: ReturnType<typeof setTimeout> | null = null;
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private typeTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Animation[] = [];
  /** Null until the first paint, so the very first stage always writes its colours. */
  private stage: WorkflowStage | null = null;
  /** Where the cursor is resting. Null before its first appearance, so it arrives instead of flying in. */
  private point: Point | null = null;
  /** The kind of the action in flight, so a corrected position lands the way that action would have. */
  private kind: ActionKind | null = null;

  constructor(parent: Element) {
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    // Decoration for the person watching: never part of the page the agent reads, and never a pointer target.
    this.host.setAttribute('aria-hidden', 'true');
    this.host.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${HOST_Z_INDEX};border:0;margin:0;padding:0;background:none;`;

    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `
      <style>${CSS}</style>
      <div class="border"></div>
      <div class="halo"></div>
      <div class="caret"></div>
      <div class="ripple"></div>
      <div class="cursor">
        <span class="smear"></span>
        <span class="float">
          <span class="shadow"></span>
          <span class="glow"></span>
          <span class="tilt"><span class="body">${ARROW}</span></span>
        </span>
      </div>
      <div class="chip"></div>
      <div class="capsule">
        <svg class="ring" viewBox="0 0 22 22" aria-hidden="true">
          <circle class="track" cx="11" cy="11" r="${RING_RADIUS}"></circle>
          <circle class="fill" cx="11" cy="11" r="${RING_RADIUS}" stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>
          <circle class="pip" cx="11" cy="11" r="2.6"></circle>
        </svg>
        <span class="text"><span class="label"></span><span class="count"></span></span>
      </div>`;

    const pick = <T extends Element>(selector: string) => this.root.querySelector(selector) as T;
    this.border = pick('.border');
    this.halo = pick('.halo');
    this.ripple = pick('.ripple');
    this.caret = pick('.caret');
    this.cursor = pick('.cursor');
    this.tilt = pick('.tilt');
    this.body = pick('.body');
    this.smear = pick('.smear');
    this.chip = pick('.chip');
    this.capsule = pick('.capsule');
    this.label = pick('.label');
    this.count = pick('.count');
    this.ringFill = pick<SVGCircleElement>('.ring .fill');

    this.paint('researching');
    parent.append(this.host);
  }

  private get reduced(): boolean {
    return this.reduceQuery.matches;
  }

  private get viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  /** One colour for the cursor, the halo, the caret, the capsule and the border. */
  private paint(stage: WorkflowStage): void {
    if (stage === this.stage) return;
    this.stage = stage;
    const colors = stageColors(stage);
    this.host.style.setProperty('--wg-a', colors.primary);
    this.host.style.setProperty('--wg-b', colors.secondary);
    this.host.style.setProperty('--wg-speed', colors.speed);
  }

  /**
   * Plays a decoration, tracked so a task that ends mid-animation leaves nothing running.
   *
   * `reducedFrames` is what runs instead when the viewer asked for less motion: a fade in place for
   * anything that would otherwise travel, or `null` for the movement-only flourishes that should
   * simply not happen at all.
   */
  private play(
    element: Element,
    frames: Keyframe[],
    ms: number,
    easing = SOFT_EASING,
    reducedFrames: Keyframe[] | null = FADE_IN_PLACE,
  ): void {
    if (this.reduced && reducedFrames === null) return;
    const animation = element.animate(this.reduced ? reducedFrames! : frames, {
      duration: motion(this.reduced, ms),
      easing,
      fill: 'none',
    });
    this.running.push(animation);
    animation.finished
      .catch(() => undefined)
      .finally(() => {
        this.running = this.running.filter(other => other !== animation);
      });
  }

  private cancelRunning(): void {
    for (const animation of this.running.splice(0)) animation.cancel();
  }

  // -------------------------------------------------------------------------
  // Status: border, capsule, progress ring
  // -------------------------------------------------------------------------

  setStatus(update: StatusUpdate): void {
    if (update.stage) this.paint(update.active ? update.stage : 'idle');
    this.border.classList.toggle('on', update.active && (update.showBorder ?? true));

    const showCapsule = update.active && (update.showCapsule ?? true);
    this.capsule.classList.toggle('on', showCapsule);
    this.label.textContent = truncateGoal(update.status || this.stageWord(update.stage), 64);
    // The ring is a shape; the count is the number behind it. Neither is shown without a real limit.
    const counted = update.stepLimit && update.stepLimit > 0 && update.step !== undefined && update.step >= 0;
    this.count.textContent = counted ? `${update.step}/${update.stepLimit}` : '';
    this.ringFill.setAttribute(
      'stroke-dashoffset',
      String(ringOffset(update.step, update.stepLimit, RING_CIRCUMFERENCE)),
    );

    if (!update.active) {
      this.cursor.classList.remove('on', 'idle', 'press');
      this.chip.classList.remove('on');
      this.caret.classList.remove('on');
      this.caret.style.opacity = '0';
      // The next task's cursor fades in where it is needed instead of streaking in from the last target.
      this.point = null;
      this.cancelRunning();
    }
    this.wake(showCapsule);
  }

  /**
   * The capsule always says what the agent is doing while a task runs: a bare dot with no word told the person nothing
   * (a live run sat on a circle for a whole planning pause). It shrinks to a dot only after a long silence.
   */
  private wake(showCapsule: boolean): void {
    if (this.capsuleTimer) clearTimeout(this.capsuleTimer);
    this.capsuleTimer = null;
    if (!showCapsule) return;
    this.capsule.classList.remove('tiny');
    this.capsuleTimer = setTimeout(() => this.capsule.classList.add('tiny'), CAPSULE_IDLE_MS);
  }

  /** The word the capsule falls back to, so it is never a label-less dot. */
  private stageWord(stage: WorkflowStage | undefined): string {
    const words: Partial<Record<WorkflowStage, string>> = {
      researching: 'Reading the page',
      typing: 'Typing',
      clicking: 'Clicking',
      waiting: 'Waiting for the page',
      planning: 'Planning',
      comparing: 'Comparing',
      completed: 'Done',
      error: 'Something went wrong',
      idle: 'Idle',
    };
    return words[stage ?? 'researching'] ?? 'Working';
  }

  // -------------------------------------------------------------------------
  // Action: cursor, halo, ripple, caret, chip
  // -------------------------------------------------------------------------

  act({ kind, rect, goal }: ActionUpdate): void {
    const viewport = this.viewport;
    this.kind = kind;
    this.paint(stageForAction(kind));
    this.wake(this.capsule.classList.contains('on'));
    if (this.typeTimer) clearTimeout(this.typeTimer);
    this.typeTimer = null;
    // The caret belongs to the field being typed: any other action takes it off the page, or it blinks on in a field
    // the agent has already left (a click after typing left one behind).
    if (kind !== 'type') {
      this.caret.classList.remove('on');
      this.caret.style.opacity = '0';
    }

    this.cursor.classList.add('on');
    this.cursor.classList.remove('idle');

    // Typing starts at the head of the field, not its middle: the pointer has to be where the first
    // character goes before it can walk along with the rest of them.
    const track = kind === 'type' && rect ? caretTrack(rect, viewport) : null;
    const point = aimPoint(kind, rect, viewport);
    this.glide(point, TRAVEL_MS);
    this.showChip(goal, point, rect);

    if (rect) this.showHalo(rect, track ? TRAVEL_MS + TYPE_MS : 520);
    if (kind === 'click') this.press(point);
    if (track) this.type(track);

    // Back to a slow breath once the action has had its moment, so a thinking agent still looks alive.
    const rest = track ? TRAVEL_MS + TYPE_MS + 220 : 900;
    if (this.restTimer) clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => this.cursor.classList.add('idle'), rest);
  }

  /**
   * The element's real position, sent when the gesture reaches it. The action scrolls the element into view after
   * the page read the cursor was aimed from, so without this the cursor presses where the element used to be.
   * A short correction, not a new flight: the action is already under way.
   */
  aimAt(rect: Rect): void {
    if (!this.kind || !this.cursor.classList.contains('on')) return;
    this.glide(aimPoint(this.kind, rect, this.viewport), FAST);
    this.showHalo(rect, 520);
  }

  /**
   * Moves the cursor with the weight of a hand: the inline transform is always where it *rests*, and
   * the animation on top of it is the flight. Nothing uses `fill: forwards`, so the two can never
   * disagree about where the pointer ended up.
   *
   * `frames` is for a walk the caller has choreographed (typing). It carries its own pacing, and the
   * flourishes of a free glide — the lean and the smear — would only smudge a slow, deliberate crawl.
   */
  private glide(next: Point, ms: number, frames?: Keyframe[]): void {
    const from = this.point;
    this.point = next;
    this.cursor.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
    if (!from || this.reduced) return;

    const { distance, tilt, trail } = travelMotion(from, next);
    if (distance < 1.5) return;

    if (frames) {
      this.play(this.cursor, frames, ms, 'linear', null);
      return;
    }

    this.play(
      this.cursor,
      [
        { transform: `translate3d(${from.x}px, ${from.y}px, 0)` },
        { transform: `translate3d(${next.x}px, ${next.y}px, 0)` },
      ],
      ms,
      TRAVEL_EASING,
      null,
    );

    // The lean: into the direction of travel on the way out, unwound by the time it settles.
    this.play(
      this.tilt,
      [
        { transform: 'rotate(0deg) scale(1)' },
        { transform: `rotate(${tilt}deg) scale(1.06)`, offset: 0.3 },
        { transform: `rotate(${tilt * 0.3}deg) scale(1.02)`, offset: 0.7 },
        { transform: 'rotate(0deg) scale(1)' },
      ],
      ms,
      TRAVEL_EASING,
      null,
    );

    // The smear: drawn pointing right, rotated back along the path, stretched to the distance covered.
    const stretch = Math.min(1.9, Math.max(0.25, distance / SMEAR_LENGTH)).toFixed(2);
    const faded = (Number(stretch) * 0.7).toFixed(2);
    this.play(
      this.smear,
      [
        { opacity: 0, transform: `rotate(${trail}deg) scaleX(0.2)` },
        { opacity: 0.8, transform: `rotate(${trail}deg) scaleX(${stretch})`, offset: 0.3 },
        { opacity: 0.32, transform: `rotate(${trail}deg) scaleX(${faded})`, offset: 0.62 },
        { opacity: 0, transform: `rotate(${trail}deg) scaleX(0.15)` },
      ],
      ms * 0.85,
      'cubic-bezier(0.2, 0.8, 0.3, 1)',
      null,
    );
  }

  private showChip(goal: string | undefined, point: Point, rect: Rect | undefined): void {
    const text = truncateGoal(goal);
    if (this.chipTimer) clearTimeout(this.chipTimer);
    this.chipTimer = null;
    if (!text) {
      this.chip.classList.remove('on');
      return;
    }
    this.chip.textContent = text;
    this.placeChip(point, rect);
    this.chip.classList.add('on');
    this.chipTimer = setTimeout(() => this.chip.classList.remove('on'), CHIP_REST_MS);
  }

  private placeChip(point: Point, rect: Rect | undefined): void {
    // The chip is measured after it has its text; its own box is the only thing read, so nothing in the page reflows.
    const size = { width: this.chip.offsetWidth, height: this.chip.offsetHeight };
    const place = chipPlacement(point, size, this.viewport, 18, rect);
    this.chip.style.transform = `translate3d(${place.x}px, ${place.y}px, 0)`;
  }

  private showHalo(rect: Rect, ms: number): void {
    const box = haloBox(rect, this.viewport);
    if (box.width <= 0 || box.height <= 0) return;
    this.halo.style.left = `${box.x}px`;
    this.halo.style.top = `${box.y}px`;
    this.halo.style.width = `${box.width}px`;
    this.halo.style.height = `${box.height}px`;
    this.halo.style.borderRadius = `${box.radius}px`;
    this.play(
      this.halo,
      [
        { opacity: 0, transform: 'scale(0.985)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.26 },
        { opacity: 0.85, transform: 'scale(1)', offset: 0.72 },
        { opacity: 0, transform: 'scale(1.015)' },
      ],
      ms,
    );
  }

  private press(point: Point): void {
    // The dip waits out the travel so the cursor presses where it lands, not on the way.
    const delay = this.reduced ? 0 : TRAVEL_MS - 70;
    setTimeout(() => {
      if (!this.host.isConnected) return;
      this.cursor.classList.add('press');
      setTimeout(() => this.cursor.classList.remove('press'), FAST);
      // A press is a fast fall and a slower recovery that comes back a shade proud of where it started.
      this.play(
        this.body,
        [
          { transform: 'scale(1)', easing: 'cubic-bezier(0.4, 0, 1, 1)' },
          { transform: 'scale(0.8)', offset: 0.22, easing: 'cubic-bezier(0, 0, 0.2, 1)' },
          { transform: 'scale(1.05)', offset: 0.62 },
          { transform: 'scale(1)' },
        ],
        380,
        'linear',
        null,
      );
      // Positioned with left/top, not a transform: the ripple's own keyframes own its transform.
      this.ripple.style.left = `${point.x}px`;
      this.ripple.style.top = `${point.y}px`;
      this.play(
        this.ripple,
        [
          { opacity: 0.9, transform: 'scale(0.04)' },
          { opacity: 0.65, transform: 'scale(0.4)', offset: 0.3 },
          { opacity: 0, transform: 'scale(1)' },
        ],
        700,
        'cubic-bezier(0.16, 0.9, 0.3, 1)',
      );
    }, delay);
  }

  /**
   * Typing: the caret walks the field and the cursor walks with it, both driven from the same list of
   * burst-and-pause positions, on the same clock, so they can never drift apart. The caret's fade is a
   * second animation on the same element rather than extra keyframes, because squeezing the fades into
   * the walk would slide the caret ahead of the hand that is supposed to be writing it.
   *
   * It decorates typing the page already received over CDP — it never carries the typed text and never
   * touches the field.
   */
  private type(track: ReturnType<typeof caretTrack>): void {
    const sweep = typingSweep(track.travel);
    const viewport = this.viewport;
    const walk = (at: (x: number) => string): Keyframe[] =>
      sweep.map(frame => ({ transform: at(frame.x), offset: frame.offset, easing: 'ease-in-out' }));

    this.caret.style.left = `${track.x}px`;
    this.caret.style.top = `${track.y - track.height / 2}px`;
    this.caret.style.height = `${track.height}px`;

    const write = () => {
      if (!this.host.isConnected) return;
      this.caret.classList.add('on');
      this.play(
        this.caret,
        walk(x => `translate3d(${x}px, 0, 0)`),
        TYPE_MS,
        'linear',
        null,
      );
      this.play(
        this.caret,
        [{ opacity: 0 }, { opacity: 1, offset: 0.05 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }],
        TYPE_MS,
        'linear',
      );

      // The same walk for the pointer, so the hand looks like it is writing the text.
      this.glide(
        clampPoint(typingCursorPoint(track, track.travel), viewport),
        TYPE_MS,
        walk(x => {
          const at = clampPoint(typingCursorPoint(track, x), viewport);
          return `translate3d(${at.x}px, ${at.y}px, 0)`;
        }),
      );
      this.typeTimer = setTimeout(() => this.caret.classList.remove('on'), motion(this.reduced, TYPE_MS));
    };

    // The pointer has to arrive before it can write.
    if (this.reduced) write();
    else this.typeTimer = setTimeout(write, TRAVEL_MS);
  }

  destroy(): void {
    for (const timer of [this.chipTimer, this.capsuleTimer, this.restTimer, this.typeTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.chipTimer = this.capsuleTimer = this.restTimer = this.typeTimer = null;
    this.cancelRunning();
    this.host.remove();
  }
}

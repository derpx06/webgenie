/**
 * The on-page agent presence overlay.
 *
 * Everything the agent draws on a page lives in one shadow root under one fixed, click-through host:
 * a cursor that glides to the element the agent is about to touch, a press ripple, a halo in the
 * element's own shape, a typing caret, a goal chip, the status capsule and the ambient border.
 *
 * It is decoration only. The host takes no pointer events, moves no page element and is hidden from
 * the accessibility tree, so it can never change what the agent clicks or what it reads.
 */
import {
  caretTrack,
  chipPlacement,
  clampPoint,
  haloBox,
  motion,
  ringOffset,
  SOFT_EASING,
  stageColors,
  stageForAction,
  targetPoint,
  TRAVEL_EASING,
  truncateGoal,
} from './core';
import type { ActionKind, Rect, WorkflowStage } from './core';

export const HOST_ID = 'webgenie-agent-overlay';
/** The attribute the harness sets while it captures the page; the overlay vanishes with no transition. */
export const CAPTURE_ATTRIBUTE = 'data-webgenie-capture';

/** Below the very top of the stack, so a page's own modal or toast still sits above the decoration. */
const HOST_Z_INDEX = 2147483000;
const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** How long the chip lingers after the cursor stops. */
const CHIP_REST_MS = 2200;
/** How long the capsule stays open after the last sign of life before it collapses to a dot. */
const CAPSULE_IDLE_MS = 120_000;

const CSS = `
:host-context([${CAPTURE_ATTRIBUTE}="1"]) { display: none !important; }

* { box-sizing: border-box; }

.layer {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform, opacity;
}

/* ── Ambient border ─────────────────────────────────────────────────────── */
/* Light pooled along the edges, as inset shadow rather than a gradient: a gradient large enough to
   reach the corners draws a visible arc across a wide viewport, and blurring it costs a full-screen
   filter on every frame of the breath. */
.border {
  position: absolute;
  inset: 0;
  border-radius: 18px;
  opacity: 0;
  transition: opacity 700ms ${SOFT_EASING};
  box-shadow:
    inset 0 0 2px rgba(var(--wg-b), 0.35),
    inset 0 0 34px rgba(var(--wg-a), 0.32),
    inset 0 0 120px rgba(var(--wg-a), 0.14);
}
.border.on {
  opacity: 1;
  animation: breathe var(--wg-speed, 4s) ease-in-out infinite;
}
@keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }

/* ── Target halo: the element's own shape, lit from behind ──────────────── */
.halo {
  position: absolute;
  opacity: 0;
  background: radial-gradient(ellipse at center, rgba(var(--wg-b), 0.20), rgba(var(--wg-a), 0.05) 72%);
  box-shadow:
    0 0 6px 1px rgba(var(--wg-a), 0.70),
    0 0 18px 5px rgba(var(--wg-a), 0.50),
    0 0 44px 14px rgba(var(--wg-a), 0.28),
    inset 0 0 14px rgba(var(--wg-b), 0.42);
}

/* ── Press ripple ───────────────────────────────────────────────────────── */
.ripple {
  position: absolute;
  width: 150px;
  height: 150px;
  margin: -75px 0 0 -75px;
  border-radius: 50%;
  opacity: 0;
  border: 3px solid rgba(var(--wg-a), 0.95);
  background: radial-gradient(circle, rgba(var(--wg-b), 0.34), rgba(var(--wg-a), 0) 68%);
  box-shadow: 0 0 26px rgba(var(--wg-a), 0.6), inset 0 0 22px rgba(var(--wg-a), 0.4);
}

/* ── Typing caret ───────────────────────────────────────────────────────── */
.caret {
  position: absolute;
  width: 2px;
  border-radius: 1px;
  opacity: 0;
  background: rgb(var(--wg-b));
  box-shadow: 0 0 6px rgba(var(--wg-a), 0.95), 0 0 14px rgba(var(--wg-a), 0.55);
}
.caret.on { animation: blink 1s steps(1, end) infinite; }
@keyframes blink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.25; } }

/* ── Cursor ─────────────────────────────────────────────────────────────── */
.cursor {
  position: absolute;
  opacity: 0;
  transition: transform 420ms ${TRAVEL_EASING}, opacity 300ms ${SOFT_EASING};
}
.cursor.on { opacity: 1; }
.float { display: block; transform-origin: 2px 2px; }
.cursor.idle .float { animation: float 5.5s ease-in-out infinite; }
.body {
  display: block;
  transform-origin: 2px 2px;
  transition: transform 170ms ${SOFT_EASING};
}
.cursor.press .body { transform: scale(0.74); }
.glow {
  position: absolute;
  left: -21px;
  top: -21px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--wg-a), 0.50), rgba(var(--wg-a), 0) 62%);
  transition: opacity 240ms ${SOFT_EASING};
}
.cursor.press .glow { opacity: 0.55; }
.arrow {
  display: block;
  filter:
    drop-shadow(0 0 5px rgba(var(--wg-a), 0.85))
    drop-shadow(0 1px 3px rgba(0, 0, 0, 0.45));
}
@keyframes float {
  0%, 100% { transform: translate3d(0, 0, 0); }
  33% { transform: translate3d(2.5px, -3px, 0); }
  66% { transform: translate3d(-2px, 2.5px, 0); }
}

/* ── Goal chip ──────────────────────────────────────────────────────────── */
.chip {
  position: absolute;
  max-width: 260px;
  padding: 5px 11px;
  border-radius: 9px;
  font: 500 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  letter-spacing: 0.1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #f2f5f8;
  background: rgba(16, 18, 22, 0.88);
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  box-shadow:
    0 0 0 1px rgba(var(--wg-a), 0.35),
    0 6px 20px rgba(0, 0, 0, 0.32),
    0 0 20px rgba(var(--wg-a), 0.18);
  opacity: 0;
  transform: translate3d(0, 0, 0) scale(0.96);
  transition: opacity 260ms ${SOFT_EASING}, transform 420ms ${TRAVEL_EASING};
}
.chip.on { opacity: 1; }

/* ── Status capsule ─────────────────────────────────────────────────────── */
.capsule {
  position: absolute;
  bottom: 22px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 9px;
  height: 34px;
  max-width: min(420px, 62vw);
  padding: 0 15px 0 9px;
  border-radius: 17px;
  color: #e9edf2;
  font: 500 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  letter-spacing: -0.05px;
  white-space: nowrap;
  overflow: hidden;
  background: rgba(16, 18, 22, 0.88);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.10) inset,
    0 1px 1px rgba(255, 255, 255, 0.12) inset,
    0 8px 26px rgba(0, 0, 0, 0.36),
    0 0 28px rgba(var(--wg-a), 0.16);
  opacity: 0;
  transform: translate3d(-50%, 130%, 0);
  transition:
    opacity 420ms ${SOFT_EASING},
    transform 560ms ${TRAVEL_EASING},
    max-width 480ms ${SOFT_EASING},
    padding 480ms ${SOFT_EASING},
    gap 480ms ${SOFT_EASING};
}
.capsule.on { opacity: 1; transform: translate3d(-50%, 0, 0); }
.capsule.tiny { max-width: 34px; padding: 0 9px; gap: 0; }
.capsule .label {
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 1;
  transition: opacity 260ms ${SOFT_EASING};
}
.capsule.tiny .label { opacity: 0; }
.ring { display: block; flex: none; width: 20px; height: 20px; transform: rotate(-90deg); }
.ring .track { fill: none; stroke: rgba(255, 255, 255, 0.16); stroke-width: 2; }
.ring .fill {
  fill: none;
  stroke: rgb(var(--wg-b));
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: ${RING_CIRCUMFERENCE.toFixed(2)};
  filter: drop-shadow(0 0 4px rgba(var(--wg-a), 0.9));
  transition: stroke-dashoffset 620ms ${SOFT_EASING};
}
.ring .pip {
  fill: rgb(var(--wg-b));
  filter: drop-shadow(0 0 4px rgba(var(--wg-a), 0.9));
  animation: pip 2.4s ease-in-out infinite;
}
@keyframes pip { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }

/* ── Less motion: everything still happens, nothing travels ─────────────── */
@media (prefers-reduced-motion: reduce) {
  .cursor, .chip, .capsule { transition-property: opacity; }
  .border.on, .cursor.idle .float, .caret.on, .ring .pip { animation: none; }
  .body { transition: none; }
}
`;

const ARROW = `
<svg class="arrow" width="20" height="25" viewBox="0 0 16 20" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 1 L1 15.6 L4.7 12.2 L7.1 17.9 L10 16.7 L7.6 11.2 L12.6 11.2 Z"
        fill="#ffffff" stroke="rgba(10,14,20,0.6)" stroke-width="1" stroke-linejoin="round" />
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

export class Presence {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly border: HTMLElement;
  private readonly halo: HTMLElement;
  private readonly ripple: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly cursor: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly capsule: HTMLElement;
  private readonly label: HTMLElement;
  private readonly ringFill: SVGCircleElement;
  private readonly reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');

  private chipTimer: ReturnType<typeof setTimeout> | null = null;
  private capsuleTimer: ReturnType<typeof setTimeout> | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Animation[] = [];
  /** Null until the first paint, so the very first stage always writes its colours. */
  private stage: WorkflowStage | null = null;

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
      <div class="cursor"><span class="float"><span class="body"><span class="glow"></span>${ARROW}</span></span></div>
      <div class="chip"></div>
      <div class="capsule">
        <svg class="ring" viewBox="0 0 20 20" aria-hidden="true">
          <circle class="track" cx="10" cy="10" r="${RING_RADIUS}"></circle>
          <circle class="fill" cx="10" cy="10" r="${RING_RADIUS}" stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>
          <circle class="pip" cx="10" cy="10" r="2.6"></circle>
        </svg>
        <span class="label"></span>
      </div>`;

    const pick = <T extends Element>(selector: string) => this.root.querySelector(selector) as T;
    this.border = pick('.border');
    this.halo = pick('.halo');
    this.ripple = pick('.ripple');
    this.caret = pick('.caret');
    this.cursor = pick('.cursor');
    this.chip = pick('.chip');
    this.capsule = pick('.capsule');
    this.label = pick('.label');
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

  /** Plays a decoration, tracked so a task that ends mid-animation leaves nothing running. */
  private play(element: Element, frames: Keyframe[], ms: number, easing = SOFT_EASING): void {
    const animation = element.animate(this.reduced ? [{ opacity: 0 }, { opacity: 0.85 }, { opacity: 0 }] : frames, {
      duration: motion(this.reduced, ms),
      easing,
      fill: 'none',
    });
    this.running.push(animation);
    animation.finished.catch(() => undefined).finally(() => {
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
    this.ringFill.setAttribute('stroke-dashoffset', String(ringOffset(update.step, update.stepLimit, RING_CIRCUMFERENCE)));

    if (!update.active) {
      this.cursor.classList.remove('on', 'idle', 'press');
      this.chip.classList.remove('on');
      this.caret.classList.remove('on');
      this.caret.style.opacity = '0';
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
    const point = clampPoint(targetPoint(rect, viewport), viewport);
    this.paint(stageForAction(kind));
    this.wake(this.capsule.classList.contains('on'));

    this.cursor.classList.add('on');
    this.cursor.classList.remove('idle');
    this.cursor.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
    this.showChip(goal, point);

    if (rect) this.showHalo(rect, kind === 'type' ? 1400 : 520);
    if (kind === 'click') this.press(point);
    if (kind === 'type' && rect) this.type(rect);

    // Back to a slow float once the action has had its moment, so a thinking agent still looks alive.
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => this.cursor.classList.add('idle'), 900);
  }

  private showChip(goal: string | undefined, point: { x: number; y: number }): void {
    const text = truncateGoal(goal);
    if (this.chipTimer) clearTimeout(this.chipTimer);
    this.chipTimer = null;
    if (!text) {
      this.chip.classList.remove('on');
      return;
    }
    this.chip.textContent = text;
    // The chip is measured after it has its text; its own box is the only thing read, so nothing in the page reflows.
    const size = { width: this.chip.offsetWidth, height: this.chip.offsetHeight };
    const place = chipPlacement(point, size, this.viewport);
    this.chip.style.transform = `translate3d(${place.x}px, ${place.y}px, 0)`;
    this.chip.classList.add('on');
    this.chipTimer = setTimeout(() => this.chip.classList.remove('on'), CHIP_REST_MS);
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

  private press(point: { x: number; y: number }): void {
    // The dip waits out the travel so the cursor presses where it lands, not on the way.
    const delay = this.reduced ? 0 : 300;
    setTimeout(() => {
      if (!this.host.isConnected) return;
      this.cursor.classList.add('press');
      setTimeout(() => this.cursor.classList.remove('press'), 210);
      // Positioned with left/top, not a transform: the ripple's own keyframes own its transform.
      this.ripple.style.left = `${point.x}px`;
      this.ripple.style.top = `${point.y}px`;
      this.play(
        this.ripple,
        [
          { opacity: 0.95, transform: 'scale(0.04)' },
          { opacity: 0.7, transform: 'scale(0.4)', offset: 0.3 },
          { opacity: 0, transform: 'scale(1)' },
        ],
        700,
        'cubic-bezier(0.16, 0.9, 0.3, 1)',
      );
    }, delay);
  }

  /**
   * The caret decorates typing the page already received over CDP: it never carries the typed text and
   * never touches the field, it only travels the way text would.
   */
  private type(rect: Rect): void {
    const track = caretTrack(rect, this.viewport);
    this.caret.style.left = `${track.x}px`;
    this.caret.style.top = `${track.y - track.height / 2}px`;
    this.caret.style.height = `${track.height}px`;
    this.caret.classList.add('on');
    this.play(
      this.caret,
      [
        { opacity: 0, transform: 'translate3d(0, 0, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)', offset: 0.08 },
        { opacity: 1, transform: `translate3d(${track.travel}px, 0, 0)`, offset: 0.86 },
        { opacity: 0, transform: `translate3d(${track.travel}px, 0, 0)` },
      ],
      1400,
      'cubic-bezier(0.5, 0, 0.5, 1)',
    );
    setTimeout(() => this.caret.classList.remove('on'), motion(this.reduced, 1400));
  }

  destroy(): void {
    for (const timer of [this.chipTimer, this.capsuleTimer, this.pressTimer]) if (timer) clearTimeout(timer);
    this.chipTimer = this.capsuleTimer = this.pressTimer = null;
    this.cancelRunning();
    this.host.remove();
  }
}

/**
 * Content script: the agent's on-page presence.
 *
 * Only the top document draws anything — an action inside an iframe still shows at the right viewport
 * point, because the background sends coordinates in the top-level viewport's pixels.
 *
 * The numbered highlight boxes are a separate developer option drawn by the background; nothing here
 * touches them.
 */
import { Presence } from './overlay/presence';
import type { ActionKind, Rect, WorkflowStage } from './overlay/core';

let presence: Presence | null = null;

function overlay(): Presence | null {
  if (presence) return presence;
  const parent = document.documentElement || document.body;
  if (!parent) return null;
  presence = new Presence(parent);
  return presence;
}

function teardown(): void {
  presence?.destroy();
  presence = null;
}

const KINDS = new Set<ActionKind>(['click', 'type', 'scroll', 'read', 'wait', 'ask', 'done', 'error']);

/** Only a complete, finite box is drawn; a partial one from an older background build is ignored. */
function readRect(value: unknown): Rect | undefined {
  const rect = value as Partial<Rect> | undefined;
  if (!rect) return undefined;
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every(n => typeof n === 'number' && Number.isFinite(n))) return undefined;
  if (w! <= 0 || h! <= 0) return undefined;
  return { x: x!, y: y!, w: w!, h: h!, r: typeof rect.r === 'number' && rect.r > 0 ? rect.r : 0 };
}

chrome.runtime.onMessage.addListener(message => {
  if (window !== window.top) return;

  if (message?.type === 'AGENT_STATUS') {
    const active = Boolean(message.active);
    if (!active && !presence) return;
    if (!active) {
      // Let the border and capsule fade out, then take the host and its listeners off the page.
      presence?.setStatus({ active: false });
      setTimeout(teardown, 900);
      return;
    }
    overlay()?.setStatus({
      active: true,
      stage: message.workflowStage as WorkflowStage | undefined,
      status: typeof message.status === 'string' ? message.status : undefined,
      step: typeof message.step === 'number' ? message.step : undefined,
      stepLimit: typeof message.stepLimit === 'number' ? message.stepLimit : undefined,
      showBorder: message.showBorder,
      showCapsule: message.showCapsule,
    });
    return;
  }

  if (message?.type === 'AGENT_ACTION' && KINDS.has(message.kind)) {
    overlay()?.act({
      kind: message.kind as ActionKind,
      rect: readRect(message.rect),
      goal: typeof message.goal === 'string' ? message.goal : undefined,
    });
  }
});

// A page being left takes its overlay with it, so no timer or animation outlives the document.
window.addEventListener('pagehide', teardown);

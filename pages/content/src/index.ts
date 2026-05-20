const BORDER_ID = 'webgenie-agent-border';
const BORDER_STYLE_ID = 'webgenie-agent-border-style';

// ---------------------------------------------------------------------------
// WorkflowStage → glow color mapping
// Matches the WorkflowStage enum in packages/storage/lib/tab-orchestration/types.ts
// ---------------------------------------------------------------------------
type WorkflowStage = 'researching' | 'typing' | 'clicking' | 'waiting' | 'planning' | 'comparing' | 'completed' | 'error' | 'idle';

const STAGE_COLORS: Record<WorkflowStage, { primary: string; secondary: string; speed: string }> = {
  researching: { primary: '0, 178, 255',   secondary: '0, 242, 255',   speed: '4s' },
  typing:      { primary: '100, 200, 255',  secondary: '0, 220, 255',   speed: '2s' },
  clicking:    { primary: '120, 210, 255',  secondary: '0, 230, 255',   speed: '1.5s' },
  waiting:     { primary: '255, 190, 50',   secondary: '255, 210, 100',  speed: '6s' },
  planning:    { primary: '160, 80, 255',   secondary: '180, 110, 255',  speed: '4s' },
  comparing:   { primary: '50, 200, 180',   secondary: '0, 230, 200',    speed: '3s' },
  completed:   { primary: '60, 210, 100',   secondary: '80, 240, 120',   speed: '8s' },
  error:       { primary: '255, 70, 70',    secondary: '255, 100, 100',  speed: '1s' },
  idle:        { primary: '100, 120, 140',  secondary: '120, 140, 160',  speed: '8s' },
};

const DEFAULT_STAGE: WorkflowStage = 'researching';

const BORDER_CSS = `
#${BORDER_ID} {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483646;
    opacity: 0;
    transition: opacity 0.8s ease-in-out;
}

#${BORDER_ID}.active {
    opacity: 1;
}

/* Layer 1: Heavy blurred edge fog */
#${BORDER_ID}::before {
    content: "";
    position: absolute;
    inset: -30px; /* Bleed out so edges fade perfectly and blur doesn't crop */
    
    /* Clear center, Teal/Cyan fog at the edges */
    background: radial-gradient(
        circle at center,
        rgba(0, 0, 0, 0) 50%,
        rgba(var(--wg-glow-primary, 0, 242, 255), 0.03) 75%,
        rgba(var(--wg-glow-primary, 0, 242, 255), 0.15) 100%
    );
    
    /* Huge blur to destroy any sharp lines */
    filter: blur(40px);
    
    /* Slow, living breathing animation */
    animation: webgenie-ambient-breathe var(--wg-glow-speed, 4s) ease-in-out infinite;
}

/* Layer 2: Subtle inset ring for depth */
#${BORDER_ID}::after {
    content: "";
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 80px rgba(var(--wg-glow-secondary, 0, 242, 255), 0.08);
    border-radius: 24px; /* Premium curved corners for the inner edge feeling */
    animation: webgenie-ambient-breathe-subtle var(--wg-glow-speed, 4s) ease-in-out infinite;
    transition: box-shadow 1.2s ease-in-out;
}

@keyframes webgenie-ambient-breathe {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
}

@keyframes webgenie-ambient-breathe-subtle {
    0%, 100% { box-shadow: inset 0 0 60px rgba(var(--wg-glow-secondary, 0, 242, 255), 0.04); }
    50%  { box-shadow: inset 0 0 100px rgba(var(--wg-glow-secondary, 0, 242, 255), 0.12); }
}
`;


function injectBorder() {
  if (document.getElementById(BORDER_ID)) return;

  const target = document.body || document.documentElement;
  if (!target) return;

  // Inject Style
  if (!document.getElementById(BORDER_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = BORDER_STYLE_ID;
    style.textContent = BORDER_CSS;
    document.head.appendChild(style);
  }

  // Inject Div
  const border = document.createElement('div');
  border.id = BORDER_ID;
  target.appendChild(border);
}

let borderVisibilityTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Activate or deactivate the ambient glow border.
 * @param active - Whether the border should be visible
 * @param stage - Optional WorkflowStage that controls glow color
 */
function setBorderActive(active: boolean, stage?: WorkflowStage) {
  const border = document.getElementById(BORDER_ID);
  
  if (borderVisibilityTimeout) {
    clearTimeout(borderVisibilityTimeout);
    borderVisibilityTimeout = null;
  }

  if (active) {
    injectBorder();
    // Apply stage-aware CSS custom properties for color
    const stageKey = stage ?? DEFAULT_STAGE;
    const colors = STAGE_COLORS[stageKey] ?? STAGE_COLORS[DEFAULT_STAGE];
    const el = document.getElementById(BORDER_ID);
    if (el) {
      el.style.setProperty('--wg-glow-primary', colors.primary);
      el.style.setProperty('--wg-glow-secondary', colors.secondary);
      el.style.setProperty('--wg-glow-speed', colors.speed);
      el.setAttribute('data-wg-state', stageKey);
    }
    // Use a small timeout to ensure transition works
    borderVisibilityTimeout = setTimeout(() => {
      const elNow = document.getElementById(BORDER_ID);
      if (elNow) {
        elNow.classList.add('active');
      }
    }, 10);
  } else if (border) {
    border.classList.remove('active');
    border.removeAttribute('data-wg-state');
    // Hide after transition
    setTimeout(() => {
      if (!border.classList.contains('active')) {
        border.remove();
      }
    }, 900);
  }
}

const CAPSULE_ID = 'webgenie-agent-status-capsule';
const CAPSULE_STYLE_ID = 'webgenie-status-capsule-style';

const EXTRA_CSS = `
  #webgenie-agent-status-capsule {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(150px); /* Start hidden below */
    z-index: 2147483647; /* MAX Z-INDEX */
    pointer-events: auto; /* Enable hover */
    cursor: default;
    
    /* Sleek Dark Glass - Minimal but Premium */
    background: rgba(18, 18, 20, 0.9);
    backdrop-filter: blur(24px) saturate(200%);
    -webkit-backdrop-filter: blur(24px) saturate(200%);
    
    min-width: 120px;
    height: 36px;
    padding: 0 16px 0 12px;
    border-radius: 18px; /* Perfect pill for 36px height */
    
    /* Ultra-clean inner rim and solid drop shadow */
    box-shadow: 
      0 6px 20px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.1) inset,
      0 1px 1px rgba(255, 255, 255, 0.15) inset;
      
    /* Flexbox for layout */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px; /* Tighter gap */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: white;
    
    /* Spring physics animation */
    opacity: 0;
    transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    white-space: nowrap;
    overflow: hidden;
  }

  #webgenie-agent-status-capsule.visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
  
  /* Dynamic Island HOVER EXPANSION */
  #webgenie-agent-status-capsule.visible:hover {
    height: 44px;
    min-width: 180px;
    border-radius: 22px;
    background: rgba(26, 26, 30, 0.95);
    box-shadow: 
      0 10px 30px rgba(0, 0, 0, 0.5),
      0 0 40px rgba(0, 229, 255, 0.1),
      0 0 0 1px rgba(255, 255, 255, 0.2) inset,
      0 1px 2px rgba(255, 255, 255, 0.25) inset;
  }

  /* Audio/Wave visualization embedded in the capsule */
  .webgenie-agent-wave {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 14px;
    opacity: 0;
    width: 0;
    transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  #webgenie-agent-status-capsule:hover .webgenie-agent-wave {
    opacity: 1;
    width: 20px; /* Reveal space */
    margin-left: 6px;
  }

  .webgenie-agent-wave-bar {
    width: 2px;
    background: #00e5ff;
    border-radius: 2px;
    animation: webgenie-wave-anim 0.8s ease-in-out infinite alternate;
  }

  .webgenie-agent-wave-bar:nth-child(1) { height: 40%; animation-delay: -0.4s; }
  .webgenie-agent-wave-bar:nth-child(2) { height: 100%; animation-delay: -0.2s; }
  .webgenie-agent-wave-bar:nth-child(3) { height: 60%; animation-delay: 0s; }

  @keyframes webgenie-wave-anim {
    0% { transform: scaleY(0.3); }
    100% { transform: scaleY(1); }
  }

  /* The glowing dot */
  .webgenie-agent-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #00e5ff;
    box-shadow: 0 0 6px #00e5ff, 0 0 10px #00e5ff;
    animation: webgenie-pulse 2s infinite;
    flex-shrink: 0;
    transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  
  #webgenie-agent-status-capsule:hover .webgenie-agent-dot {
    animation-duration: 0.6s;
    transform: scale(1.3);
    box-shadow: 0 0 10px #00e5ff, 0 0 20px #00e5ff;
  }

  /* Sleek modern text */
  .webgenie-agent-text {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: -0.1px;
    color: #e5e5e7; /* Apple off-white */
    text-overflow: ellipsis;
    overflow: hidden;
    margin-top: 1px;
    transition: all 0.4s ease;
  }
  
  #webgenie-agent-status-capsule:hover .webgenie-agent-text {
    font-size: 14px;
    color: #ffffff;
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
  }

  /* Pulse animation for the dot */
  @keyframes webgenie-pulse {
    0% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 rgba(0, 229, 255, 0.7);
    }
    70% {
      transform: scale(1);
      box-shadow: 0 0 0 6px rgba(0, 229, 255, 0);
    }
    100% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 rgba(0, 229, 255, 0);
    }
  }

  /* PREMIUM ANIMATED CURSOR */
  #webgenie-cursor {
    position: fixed;
    top: 0;
    left: 0;
    width: 24px;
    height: 24px;
    background: radial-gradient(circle, rgba(255,255,255,1) 30%, rgba(0, 229, 255, 1) 100%);
    border: 2px solid rgba(255, 255, 255, 0.9);
    border-radius: 50%;
    pointer-events: none;
    z-index: 2147483647; /* Max z-index */
    transform: translate(-50%, -50%);
    transition: left 0.4s cubic-bezier(0.25, 1, 0.5, 1), 
                top 0.4s cubic-bezier(0.25, 1, 0.5, 1),
                transform 0.15s cubic-bezier(0.25, 1, 0.5, 1),
                opacity 0.3s ease;
    box-shadow: 0 0 15px rgba(0, 229, 255, 0.8), 0 0 30px rgba(0, 229, 255, 0.4);
    opacity: 0; /* Hidden by default */
  }

  #webgenie-cursor.active {
    opacity: 1;
  }

  #webgenie-cursor.clicking {
    transform: translate(-50%, -50%) scale(0.6);
    box-shadow: 0 0 8px rgba(255, 100, 255, 0.8), 0 0 15px rgba(255, 100, 255, 0.4);
    background: radial-gradient(circle, rgba(255,255,255,1) 50%, rgba(255, 100, 255, 1) 100%);
    border-color: #fff;
  }

  #webgenie-cursor::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    background: transparent;
    border: 2px solid rgba(0, 229, 255, 0.6);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    animation: webgenie-radar-pulse 2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
  }

  #webgenie-cursor.clicking::after {
    animation-duration: 0.5s;
    border-color: rgba(255, 100, 255, 0.8);
  }

  @keyframes webgenie-radar-pulse {
    0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
  }
`;

let isDraggingCapsule = false;

function makeCapsuleDraggable(capsule: HTMLElement) {
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  capsule.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;

    isDraggingCapsule = true;
    capsule.style.cursor = 'grabbing';

    const rect = capsule.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;

    capsule.style.bottom = 'auto';
    capsule.style.transform = 'none';
    capsule.style.left = `${initialLeft}px`;
    capsule.style.top = `${initialTop}px`;
    capsule.style.transition = 'opacity 0.6s';

    capsule.setPointerCapture(e.pointerId);
  });

  capsule.addEventListener('pointermove', (e) => {
    if (!isDraggingCapsule) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const rect = capsule.getBoundingClientRect();
    let newX = initialLeft + dx;
    let newY = initialTop + dy;

    newX = Math.max(10, Math.min(newX, window.innerWidth - rect.width - 10));
    newY = Math.max(10, Math.min(newY, window.innerHeight - rect.height - 10));

    capsule.style.left = `${newX}px`;
    capsule.style.top = `${newY}px`;
  });

  capsule.addEventListener('pointerup', (e) => {
    if (!isDraggingCapsule) return;

    isDraggingCapsule = false;
    capsule.style.cursor = 'default';
    capsule.releasePointerCapture(e.pointerId);
    capsule.style.transition = 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
  });
}

let visibilityTimeout: ReturnType<typeof setTimeout> | null = null;

function updateStatusCapsule(text: string, active: boolean) {
  const target = document.body || document.documentElement;
  if (!target) return;

  let capsule = document.getElementById(CAPSULE_ID);

  if (!capsule) {
    if (!active) return; // Don't create if not active
    capsule = document.createElement('div');
    capsule.id = CAPSULE_ID;

    const dot = document.createElement('div');
    dot.className = 'webgenie-agent-dot';

    const label = document.createElement('div');
    label.className = 'webgenie-agent-text';
    label.id = 'webgenie-agent-status-text';

    // Add wave DOM elements
    const wave = document.createElement('div');
    wave.className = 'webgenie-agent-wave';
    wave.innerHTML = `<div class="webgenie-agent-wave-bar"></div><div class="webgenie-agent-wave-bar"></div><div class="webgenie-agent-wave-bar"></div>`;

    capsule.appendChild(dot);
    capsule.appendChild(label);
    capsule.appendChild(wave);

    target.appendChild(capsule);

    // Attach drag tracking
    makeCapsuleDraggable(capsule);
  }

  const label = document.getElementById('webgenie-agent-status-text');
  if (label) {
    label.innerText = text;
  }

  if (visibilityTimeout) {
    clearTimeout(visibilityTimeout);
    visibilityTimeout = null;
  }

  if (active) {
    // Small delay to allow element to be added to DOM before triggering transition
    visibilityTimeout = setTimeout(() => {
      capsule?.classList.add('visible');
    }, 10);
  } else {
    capsule.classList.remove('visible');
    // We keep the capsule in the DOM so it can re-animate smoothly next time,
    // but its opacity is 0 and it translates down.

    // ALSO disable the cursor when task finishes
    const cursor = document.getElementById('webgenie-cursor');
    if (cursor) cursor.classList.remove('active');

    // Stop the idle drift physics if present
    if (typeof stopIdleDrift === 'function') {
      stopIdleDrift();
    }
  }
}

// ----------------------------------------------------------------------------
// Cursor Controller
// ----------------------------------------------------------------------------

let isIdle = true;
let cursorEl: HTMLElement | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let idleInterval: any = null;

function initCursor() {
  const target = document.body || document.documentElement;
  if (!target) return;

  if (!document.getElementById(CAPSULE_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = CAPSULE_STYLE_ID;
    style.textContent = EXTRA_CSS;
    document.head.appendChild(style);
  }

  if (document.getElementById('webgenie-cursor')) {
    cursorEl = document.getElementById('webgenie-cursor');
    return;
  }

  cursorEl = document.createElement('div');
  cursorEl.id = 'webgenie-cursor';
  target.appendChild(cursorEl);
}

function startIdleDrift() {
  if (idleInterval) clearInterval(idleInterval);
  idleInterval = setInterval(() => {
    if (!isIdle || !cursorEl) return;
    const driftX = (Math.random() - 0.5) * 8;
    const driftY = (Math.random() - 0.5) * 8;
    cursorEl.style.transition = 'opacity 0.3s ease, transform 2.5s ease-in-out, left 0.4s cubic-bezier(0.25, 1, 0.5, 1), top 0.4s cubic-bezier(0.25, 1, 0.5, 1)';
    cursorEl.style.transform = `translate(calc(-50% + ${driftX}px), calc(-50% + ${driftY}px)) scale(1)`;
  }, 2500);
}

function stopIdleDrift() {
  isIdle = false;
  if (idleInterval) clearInterval(idleInterval);
  if (cursorEl) {
    cursorEl.style.transform = `translate(-50%, -50%) scale(1)`;
  }
}

async function animateCursor(x: number, y: number, isClick: boolean) {
  if (!cursorEl) initCursor();
  if (!cursorEl) return;

  stopIdleDrift();
  cursorEl.classList.add('active');

  // Human-like Phase 1: Rapid arced movement to an "overshoot" 
  const overshootX = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 15 + 5);
  const overshootY = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 15 + 5);

  cursorEl.style.transition = 'opacity 0.3s ease, transform 0.15s cubic-bezier(0.25, 1, 0.5, 1), left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
  cursorEl.style.left = `${x + overshootX}px`;
  cursorEl.style.top = `${y + overshootY}px`;

  // Wait to approach element
  await new Promise(r => setTimeout(r, 320));

  // Human-like Phase 2: Decelerate and micro-adjust to exact target
  cursorEl.style.transition = 'opacity 0.3s ease, transform 0.15s cubic-bezier(0.25, 1, 0.5, 1), left 0.25s ease-out, top 0.25s ease-out';
  cursorEl.style.left = `${x}px`;
  cursorEl.style.top = `${y}px`;

  // Human-like Phase 3: Action hover pause (confirming target)
  await new Promise(r => setTimeout(r, 180));

  // Phase 4: Action Execution
  if (isClick) {
    cursorEl.classList.add('clicking');
    await new Promise(r => setTimeout(r, 300));
    cursorEl.classList.remove('clicking');
  }

  // Return to idle baseline
  cursorX = x;
  cursorY = y;

  isIdle = true;
  startIdleDrift();
}

// ---------------------------------------------------------------------------
// Cleanup on page unload — prevent memory leaks from stale state
// ---------------------------------------------------------------------------

window.addEventListener('beforeunload', () => {
  if (borderVisibilityTimeout) {
    clearTimeout(borderVisibilityTimeout);
    borderVisibilityTimeout = null;
  }
  if (visibilityTimeout) {
    clearTimeout(visibilityTimeout);
    visibilityTimeout = null;
  }
  if (idleInterval) {
    clearInterval(idleInterval);
    idleInterval = null;
  }
});

// ---------------------------------------------------------------------------
// Message listener (main entry point from background)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (window !== window.top) return;

  if (message.type === 'AGENT_STATUS') {
    const isActive = Boolean(message.active);
    const showBorder = message.showBorder ?? true;
    const showCapsule = message.showCapsule ?? true;
    // New: workflow stage for state-aware glow color (backward-compatible — optional)
    const stage = (message.workflowStage as WorkflowStage | undefined) ?? DEFAULT_STAGE;
    // New: task name for enhanced capsule display
    const statusText = message.status || 'WebGenie is active...';

    setBorderActive(isActive && showBorder, isActive ? stage : undefined);
    updateStatusCapsule(statusText, isActive && showCapsule);

    if (isActive) {
      initCursor();
    }
  } else if (message.type === 'AGENT_ACTION') {
    // This is fired when the background is about to click or type
    if (message.x != null && message.y != null) {
      animateCursor(message.x, message.y, message.action === 'click');
    }
  }
});

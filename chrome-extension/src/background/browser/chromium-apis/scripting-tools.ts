/**
 * ScriptingTools — chrome.scripting API integration toolkit
 *
 * Provides the agent with powerful JS/CSS injection capabilities:
 *   - Execute JS in the MAIN world (access React/Vue/Angular component state)
 *   - Execute JS in ISOLATED world (safe extension context)
 *   - Inject/remove CSS (highlight elements, reveal hidden content)
 *   - Extract page data, validate form state, read framework internals
 *
 * Permissions required: "scripting" ✅, host_permissions: <all_urls> ✅
 *
 * STATUS: Standalone tool — not yet wired into the agent pipeline.
 */

import { createLogger } from '@src/background/log';

const logger = createLogger('ScriptingTools');

// ── MAIN World Execution ──────────────────────────────────────────────────────

/**
 * Execute a function in the page's MAIN JavaScript world.
 * Gives access to page-private variables, React fiber, Vue instances, etc.
 *
 * SECURITY: Code runs in the page's context. Do NOT pass secrets here.
 * The page's own scripts can observe and interfere with MAIN world code.
 */
export async function executeInMainWorld<T = unknown>(
  tabId: number,
  func: (...args: unknown[]) => T,
  args: unknown[] = [],
): Promise<T | null> {
  logger.debug(`[ScriptingTools] executeInMainWorld on tab ${tabId}`);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func,
      args,
    });
    const result = results[0];
    if (result.error) {
      logger.error('[ScriptingTools] MAIN world error:', result.error);
      return null;
    }
    return result.result as T;
  } catch (err) {
    logger.error('[ScriptingTools] executeInMainWorld failed:', err);
    return null;
  }
}

/**
 * Execute a function in the ISOLATED extension world (safe default).
 * Cannot access page JS variables but can use chrome.* APIs.
 */
export async function executeInIsolatedWorld<T = unknown>(
  tabId: number,
  func: (...args: unknown[]) => T,
  args: unknown[] = [],
  frameIds?: number[],
): Promise<T | null> {
  try {
    const target = frameIds ? { tabId, frameIds } : { tabId };
    const results = await chrome.scripting.executeScript({
      target,
      world: 'ISOLATED',
      func,
      args,
    });
    const result = results[0];
    if (result?.error) {
      logger.error('[ScriptingTools] Isolated world error:', result.error);
      return null;
    }
    return result?.result as T ?? null;
  } catch (err) {
    logger.error('[ScriptingTools] executeInIsolatedWorld failed:', err);
    return null;
  }
}

/**
 * Execute a function in all frames (main + iframes) of a tab.
 */
export async function executeInAllFrames<T = unknown>(
  tabId: number,
  func: (...args: unknown[]) => T,
  args: unknown[] = [],
): Promise<T[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'ISOLATED',
      func,
      args,
    });
    return results.filter(r => !r.error).map(r => r.result as T);
  } catch (err) {
    logger.error('[ScriptingTools] executeInAllFrames failed:', err);
    return [];
  }
}

// ── Framework State Access ────────────────────────────────────────────────────

/**
 * Read React component state/props for a DOM element matched by a CSS selector.
 * Traverses the React Fiber tree attached to the DOM node.
 */
export async function getReactComponentState(
  tabId: number,
  selector: string,
): Promise<{ state: unknown; props: unknown } | null> {
  return executeInMainWorld(tabId, (sel: string) => {
    const el = document.querySelector(sel) as Element & Record<string, unknown>;
    if (!el) return null;
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    if (!fiberKey) return null;
    const fiber = el[fiberKey] as { memoizedState?: unknown; memoizedProps?: unknown } | null;
    return fiber ? { state: fiber.memoizedState, props: fiber.memoizedProps } : null;
  }, [selector]);
}

/** Check if a form passes HTML5 native validation. */
export async function isFormValid(tabId: number, formSelector: string): Promise<boolean> {
  const result = await executeInMainWorld(tabId, (sel: string) => {
    const form = document.querySelector(sel) as HTMLFormElement | null;
    return form ? form.checkValidity() : null;
  }, [formSelector]);
  return result === true;
}

/** Extract all visible text content from the page. */
export async function extractPageText(tabId: number): Promise<string> {
  const text = await executeInMainWorld(tabId, () => document.body?.innerText ?? '');
  return text ?? '';
}

/** Extract all links from the page. */
export async function extractPageLinks(tabId: number): Promise<Array<{ text: string; href: string }>> {
  const links = await executeInMainWorld(tabId, () =>
    Array.from(document.querySelectorAll('a[href]')).map(a => ({
      text: (a as HTMLAnchorElement).innerText.trim(),
      href: (a as HTMLAnchorElement).href,
    })),
  );
  return (links as Array<{ text: string; href: string }>) ?? [];
}

/** Read a localStorage item from the page context. */
export async function getLocalStorageItem(tabId: number, key: string): Promise<string | null> {
  return executeInMainWorld(tabId, (k: string) => localStorage.getItem(k), [key]);
}

/** Read the value of an input field by CSS selector. */
export async function getInputValue(tabId: number, selector: string): Promise<string | null> {
  return executeInMainWorld(tabId, (sel: string) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    return el ? el.value : null;
  }, [selector]);
}

// ── CSS Injection ─────────────────────────────────────────────────────────────

const injectedCSSRegistry = new Map<string, { tabId: number; css: string }>();

/**
 * Inject CSS into a tab. Returns an injectionId for later removal.
 * Agent use-cases: highlight elements, reveal hidden content, disable animations.
 */
export async function injectCSS(tabId: number, css: string): Promise<string> {
  logger.debug(`[ScriptingTools] Injecting CSS into tab ${tabId}`);
  await chrome.scripting.insertCSS({ target: { tabId }, css });
  const id = `css_${tabId}_${Date.now()}`;
  injectedCSSRegistry.set(id, { tabId, css });
  return id;
}

/** Remove previously injected CSS by injectionId. */
export async function removeCSS(injectionId: string): Promise<void> {
  const entry = injectedCSSRegistry.get(injectionId);
  if (!entry) return;
  try {
    await chrome.scripting.removeCSS({ target: { tabId: entry.tabId }, css: entry.css });
    injectedCSSRegistry.delete(injectionId);
  } catch (err) {
    logger.error('[ScriptingTools] removeCSS failed:', err);
  }
}

/**
 * Highlight a DOM element visually by injecting a colored outline.
 * Returns a cleanup function to remove the highlight.
 */
export async function highlightElement(
  tabId: number,
  selector: string,
  color = '#818cf8',
): Promise<() => Promise<void>> {
  const css = `${selector} { outline: 3px solid ${color} !important; outline-offset: 2px !important; }`;
  const id = await injectCSS(tabId, css);
  return () => removeCSS(id);
}

/**
 * Disable all CSS transitions and animations on a page.
 * Useful before screenshots to avoid capturing mid-animation states.
 */
export async function disableAnimations(tabId: number): Promise<() => Promise<void>> {
  const css = `*, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }`;
  const id = await injectCSS(tabId, css);
  return () => removeCSS(id);
}

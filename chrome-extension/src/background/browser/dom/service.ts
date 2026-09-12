import { createLogger } from '@src/background/log';
import type { IBrowserAdapter } from '../../adapters/IBrowserAdapter';
import { ChromeBrowserAdapter } from '../../adapters/ChromeBrowserAdapter';

const logger = createLogger('DOMService');
const defaultAdapter = new ChromeBrowserAdapter();

export async function removeHighlights(
  tabId: number,
  browserAdapter: IBrowserAdapter = defaultAdapter
): Promise<void> {
  try {
    await browserAdapter.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        // Remove the highlight container and all its contents
        const container = document.getElementById('playwright-highlight-container');
        if (container) {
          container.remove();
        }

        // Remove highlight attributes from elements
        const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
        for (const el of Array.from(highlightedElements)) {
          el.removeAttribute('browser-user-highlight-id');
        }
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      msg.includes('showing error page') ||
      msg.includes('Cannot find context') ||
      msg.includes('Frame was detached')
    ) {
      logger.debug('Failed to remove highlights (frame transition):', msg);
    } else {
      logger.error('Failed to remove highlights:', error);
    }
  }
}

export interface HighlightRect {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Draw visual outline highlight box and labeled overlay based on absolute page coordinates.
 * Operates with zero layout recalculation overhead since coordinates are absolute.
 */
export async function drawHighlightOverlaysViaCoordinates(
  tabId: number,
  rects: HighlightRect[],
  browserAdapter: IBrowserAdapter = defaultAdapter
): Promise<void> {
  try {
    await browserAdapter.executeScript({
      target: { tabId, allFrames: false },
      func: (rectsToDraw) => {
        // Remove existing container if any
        const oldContainer = document.getElementById('playwright-highlight-container');
        if (oldContainer) oldContainer.remove();

        const container = document.createElement('div');
        container.id = 'playwright-highlight-container';
        Object.assign(container.style, {
          position: 'absolute',
          left: '0px',
          top: '0px',
          width: '100%',
          height: '100%',
          zIndex: '2147483647',
          pointerEvents: 'none',
          backgroundColor: 'transparent'
        });

        const colors = [
          '#FF0000', '#00FF00', '#0000FF', '#FFA500', '#800080',
          '#008080', '#FF00FF', '#00FFFF', '#808000', '#008000'
        ];

        const fragment = document.createDocumentFragment();

        for (const rect of rectsToDraw) {
          const color = colors[rect.index % colors.length];

          // Create outline overlay
          const overlay = document.createElement('div');
          Object.assign(overlay.style, {
            position: 'absolute',
            border: `2px solid ${color}`,
            backgroundColor: `${color}1A`, // 10% opacity
            pointerEvents: 'none',
            boxSizing: 'border-box',
            left: `${rect.x - rect.w / 2}px`,
            top: `${rect.y - rect.h / 2}px`,
            width: `${rect.w}px`,
            height: `${rect.h}px`,
          });
          fragment.appendChild(overlay);

          // Create index label overlay
          const label = document.createElement('div');
          label.className = 'playwright-highlight-label';
          label.textContent = String(rect.index);
          Object.assign(label.style, {
            position: 'absolute',
            background: color,
            color: 'white',
            padding: '1px 4px',
            borderRadius: '4px',
            fontSize: `${Math.min(12, Math.max(8, rect.h / 2))}px`,
            left: `${rect.x + rect.w / 2 - 20}px`,
            top: `${rect.y - rect.h / 2}px`,
            zIndex: '2147483647',
            pointerEvents: 'none',
          });
          fragment.appendChild(label);
        }

        container.appendChild(fragment);
        document.body.appendChild(container);
      },
      args: [rects],
    });
  } catch (error) {
    logger.error('Failed to draw highlight overlays:', error);
  }
}

export async function clearHighlightOverlays(
  tabId: number,
  browserAdapter: IBrowserAdapter = defaultAdapter
): Promise<void> {
  try {
    await browserAdapter.executeScript({
      target: { tabId, allFrames: false },
      func: () => {
        const oldContainer = document.getElementById('playwright-highlight-container');
        if (oldContainer) oldContainer.remove();
      },
    });
  } catch (error) {
    logger.error('Failed to clear highlight overlays:', error);
  }
}

export async function getScrollInfo(
  tabId: number,
  browserAdapter: IBrowserAdapter = defaultAdapter
): Promise<[number, number, number]> {
  const results = await browserAdapter.executeScript({
    target: { tabId: tabId },
    func: () => {
      const scrollY = window.scrollY;
      const visualViewportHeight = window.visualViewport?.height || window.innerHeight;
      // documentElement, not body: body can be shorter than the page (positioned or floated content).
      const scrollHeight = document.documentElement.scrollHeight;
      return {
        scrollY: scrollY,
        visualViewportHeight: visualViewportHeight,
        scrollHeight: scrollHeight,
      };
    },
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to get scroll information');
  }
  return [result.scrollY, result.visualViewportHeight, result.scrollHeight];
}

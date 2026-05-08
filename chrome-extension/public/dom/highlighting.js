/**
 * DOM Tree Builder - Highlighting Module
 * Creates and manages highlight overlays and labels.
 */

(function initializeDomTreeBuilderHighlighting(global) {
  const ns = (global.__DOM_TREE_BUILDER__ = global.__DOM_TREE_BUILDER__ || {});

  ns.createHighlightingHelpers = function createHighlightingHelpers({ constants, cache, helpers }) {
    function getHighlightContainer(showHighlightElements) {
      let container = document.getElementById(constants.CONFIG.HIGHLIGHT_CONTAINER_ID);
      if (!container) {
        container = document.createElement('div');
        container.id = constants.CONFIG.HIGHLIGHT_CONTAINER_ID;
        Object.assign(container.style, {
          position: 'fixed',
          pointerEvents: 'none',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          zIndex: '2147483647',
          backgroundColor: 'transparent',
        });
        document.body.appendChild(container);
      }
      container.style.display = showHighlightElements ? 'block' : 'none';
      return container;
    }

    function getHighlightColor(index) {
      const baseColor = constants.HIGHLIGHT_COLORS[index % constants.HIGHLIGHT_COLORS.length];
      return {
        baseColor,
        backgroundColor: `${baseColor}1A`,
      };
    }

    function createOverlays(rects, baseColor, iframeOffset) {
      const overlays = [];
      const backgroundColor = `${baseColor}1A`;

      for (const rect of rects) {
        if (!helpers.hasRenderableDimensions(rect)) continue;

        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
          position: 'fixed',
          border: `2px solid ${baseColor}`,
          backgroundColor,
          pointerEvents: 'none',
          boxSizing: 'border-box',
          top: `${rect.top + iframeOffset.y}px`,
          left: `${rect.left + iframeOffset.x}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        overlays.push({ element: overlay, initialRect: rect });
      }

      return overlays;
    }

    function createLabel(index, baseColor, firstRect) {
      const label = document.createElement('div');
      label.className = 'playwright-highlight-label';
      label.textContent = String(index);
      Object.assign(label.style, {
        position: 'fixed',
        background: baseColor,
        color: 'white',
        padding: '1px 4px',
        borderRadius: '4px',
        fontSize: `${Math.min(12, Math.max(8, firstRect.height / 2))}px`,
      });

      const width = 20;
      const height = 16;
      return { element: label, width, height };
    }

    function calculateLabelPosition(firstRect, labelWidth, labelHeight, iframeOffset) {
      const firstRectTop = firstRect.top + iframeOffset.y;
      const firstRectLeft = firstRect.left + iframeOffset.x;

      let top = firstRectTop + 2;
      let left = firstRectLeft + firstRect.width - labelWidth - 2;

      if (firstRect.width < labelWidth + 4 || firstRect.height < labelHeight + 4) {
        top = firstRectTop - labelHeight - 2;
        left = firstRectLeft + firstRect.width - labelWidth;
        if (left < iframeOffset.x) left = firstRectLeft;
      }

      top = Math.max(0, Math.min(top, window.innerHeight - labelHeight));
      left = Math.max(0, Math.min(left, window.innerWidth - labelWidth));

      return { top, left };
    }

    function createPositionUpdater(element, overlays, label, labelWidth, labelHeight, parentIframe) {
      let lastCall = 0;

      return () => {
        const now = performance.now();
        if (now - lastCall < constants.CONFIG.HIGHLIGHT_THROTTLE_MS) return;
        lastCall = now;

        const newRects = element.getClientRects();
        let iframeOffset = { x: 0, y: 0 };
        if (parentIframe) {
          const iframeRect = cache.getCachedBoundingRect(parentIframe);
          iframeOffset = { x: iframeRect.left, y: iframeRect.top };
        }

        overlays.forEach((overlayData, i) => {
          if (i < newRects.length) {
            const newRect = newRects[i];
            Object.assign(overlayData.element.style, {
              top: `${newRect.top + iframeOffset.y}px`,
              left: `${newRect.left + iframeOffset.x}px`,
              width: `${newRect.width}px`,
              height: `${newRect.height}px`,
              display: helpers.hasRenderableDimensions(newRect) ? 'block' : 'none',
            });
          } else {
            overlayData.element.style.display = 'none';
          }
        });

        if (!label || newRects.length === 0) {
          if (label) label.style.display = 'none';
          return;
        }

        const firstNewRect = newRects[0];
        const pos = calculateLabelPosition(firstNewRect, labelWidth, labelHeight, iframeOffset);
        Object.assign(label.style, {
          top: `${pos.top}px`,
          left: `${pos.left}px`,
          display: 'block',
        });
      };
    }

    function highlightElement(element, index, parentIframe = null, showHighlightElements = true) {
      if (!element) return index;
      if (!showHighlightElements) {
        getHighlightContainer(false);
        return index + 1;
      }

      const rects = cache.getCachedClientRects(element);
      if (!rects || rects.length === 0) return index;

      try {
        const container = getHighlightContainer(showHighlightElements);
        const { baseColor } = getHighlightColor(index);

        let iframeOffset = { x: 0, y: 0 };
        if (parentIframe) {
          const iframeRect = cache.getCachedBoundingRect(parentIframe);
          iframeOffset = { x: iframeRect.left, y: iframeRect.top };
        }

        const fragment = document.createDocumentFragment();
        const overlays = createOverlays(rects, baseColor, iframeOffset);
        overlays.forEach(overlay => fragment.appendChild(overlay.element));

        const { element: label, width: labelWidth, height: labelHeight } = createLabel(index, baseColor, rects[0]);
        const pos = calculateLabelPosition(rects[0], labelWidth, labelHeight, iframeOffset);
        Object.assign(label.style, {
          top: `${pos.top}px`,
          left: `${pos.left}px`,
        });
        fragment.appendChild(label);
        container.appendChild(fragment);

        const throttledUpdate = createPositionUpdater(element, overlays, label, labelWidth, labelHeight, parentIframe);
        window.addEventListener('scroll', throttledUpdate, true);
        window.addEventListener('resize', throttledUpdate);

        const cleanupFn = () => {
          window.removeEventListener('scroll', throttledUpdate, true);
          window.removeEventListener('resize', throttledUpdate);
          overlays.forEach(overlay => overlay.element.remove());
          label.remove();
        };

        (window._highlightCleanupFunctions = window._highlightCleanupFunctions || []).push(cleanupFn);
        return index + 1;
      } catch (e) {
        console.warn('Failed to highlight element:', e);
        return index;
      }
    }

    return {
      getHighlightContainer,
      getHighlightColor,
      createOverlays,
      createLabel,
      calculateLabelPosition,
      createPositionUpdater,
      highlightElement,
    };
  };
})(window);

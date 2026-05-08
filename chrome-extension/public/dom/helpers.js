/**
 * DOM Tree Builder - Helper Utilities Module
 * Contains shared geometry, visibility, XPath, and DOM helpers.
 */

(function initializeDomTreeBuilderHelpers(global) {
  const ns = (global.__DOM_TREE_BUILDER__ = global.__DOM_TREE_BUILDER__ || {});

  ns.createDomHelpers = function createDomHelpers({ viewportExpansion, cache, constants, features }) {
    function hasRenderableDimensions(rect) {
      return rect && rect.width > 0 && rect.height > 0;
    }

    function isRectInExpandedViewport(rect) {
      if (viewportExpansion === -1) return true;
      return !(
        rect.bottom < -viewportExpansion ||
        rect.top > window.innerHeight + viewportExpansion ||
        rect.right < -viewportExpansion ||
        rect.left > window.innerWidth + viewportExpansion
      );
    }

    function getRectCenter(rect) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    function getRectCheckPoints(rect, margin = 5) {
      return [
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        { x: rect.left + margin, y: rect.top + margin },
        { x: rect.right - margin, y: rect.bottom - margin },
        { x: rect.right - margin, y: rect.top + margin },
        { x: rect.left + margin, y: rect.bottom - margin },
      ];
    }

    function isTrackingIframe(rect) {
      return (
        (rect.width <= constants.CONFIG.MIN_RECT_SIZE && rect.height <= constants.CONFIG.MIN_RECT_SIZE) ||
        rect.left < -constants.CONFIG.OFFSCREEN_THRESHOLD ||
        rect.top < -constants.CONFIG.OFFSCREEN_THRESHOLD
      );
    }

    function isStyleVisible(style) {
      return (
        style &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    }

    function checkElementVisibility(element) {
      if (features.hasCheckVisibility) {
        try {
          return element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          });
        } catch (e) {
          // Fallback below.
        }
      }
      return isStyleVisible(cache.getCachedComputedStyle(element));
    }

    function hasEventHandlers(element, handlerNames) {
      return handlerNames.some(
        handler => element.hasAttribute(handler) || typeof element[handler] === 'function',
      );
    }

    function getElementEventListeners(element) {
      try {
        // Support standard DevTools getEventListeners
        if (typeof window.getEventListeners === 'function') {
          const listeners = window.getEventListeners(element);
          return Object.entries(listeners).flatMap(([type, list]) => list.map(() => ({ type })));
        }
        
        // Support common injection pattern: getEventListenersForNode
        const getEventListenersForNode = 
          element?.ownerDocument?.defaultView?.getEventListenersForNode || window.getEventListenersForNode;
        
        if (typeof getEventListenersForNode === 'function') {
          const listeners = getEventListenersForNode(element);
          return Array.isArray(listeners) ? listeners : [];
        }
      } catch (e) {
        // ignore and fallback
      }
      return [];
    }

    function hasInteractionListeners(element, eventTypes) {
      const listeners = getElementEventListeners(element);
      return eventTypes.some(type => listeners.some(listener => listener.type === type));
    }

    function isTagInDenyList(tagName) {
      return constants.ELEMENT_DENY_LIST.has(tagName);
    }

    function isElementAccepted(element) {
      if (!element || !element.tagName) return false;
      const tagName = element.tagName.toLowerCase();
      if (constants.ALWAYS_ACCEPT_TAGS.has(tagName)) return true;
      return !isTagInDenyList(tagName);
    }

    function isElementVisible(element) {
      const style = cache.getCachedComputedStyle(element);
      return element.offsetWidth > 0 && element.offsetHeight > 0 && isStyleVisible(style);
    }

    function isInteractiveCandidate(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
      const tagName = element.tagName.toLowerCase();
      if (constants.INTERACTIVE_TAGS.has(tagName)) return true;

      const style = cache.getCachedComputedStyle(element);
      if (style?.cursor === 'pointer') return true;

      return (
        element.hasAttribute('onclick') ||
        element.hasAttribute('role') ||
        element.hasAttribute('tabindex') ||
        element.hasAttribute('jsaction') ||
        element.hasAttribute('jscontroller') ||
        element.hasAttribute('jsname') ||
        element.hasAttribute('jslog') ||
        element.hasAttribute('data-action') ||
        element.hasAttribute('data-value') ||
        element.hasAttribute('data-index') ||
        element.hasAttribute('data-toggle') ||
        element.hasAttribute('aria-expanded') ||
        element.hasAttribute('aria-controls') ||
        element.hasAttribute('aria-haspopup') ||
        element.getAttribute('contenteditable') === 'true' ||
        (element.classList && (
          element.classList.contains('button') || 
          element.classList.contains('dropdown-toggle')
        ))
      );
    }

    function getElementPosition(currentElement) {
      if (!currentElement.parentElement) return 0;
      const tagName = currentElement.nodeName.toLowerCase();
      const siblings = Array.from(currentElement.parentElement.children).filter(
        sibling => sibling.nodeName.toLowerCase() === tagName,
      );
      return siblings.length === 1 ? 0 : siblings.indexOf(currentElement) + 1;
    }

    function getXPathTree(element, stopAtBoundary = true) {
      if (ns.__xpathCache?.has(element)) return ns.__xpathCache.get(element);

      const segments = [];
      let currentElement = element;

      while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
        if (
          stopAtBoundary &&
          (currentElement.parentNode instanceof ShadowRoot || currentElement.parentNode instanceof HTMLIFrameElement)
        ) {
          break;
        }

        const position = getElementPosition(currentElement);
        const tagName = currentElement.nodeName.toLowerCase();
        const xpathIndex = position > 0 ? `[${position}]` : '';
        segments.unshift(`${tagName}${xpathIndex}`);

        currentElement = currentElement.parentNode;
      }

      const result = segments.join('/');
      ns.__xpathCache.set(element, result);
      return result;
    }

    function isTextNodeVisible(textNode) {
      try {
        if (viewportExpansion === -1) {
          const parentElement = textNode.parentElement;
          return parentElement ? checkElementVisibility(parentElement) : false;
        }

        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rects = range.getClientRects();
        if (!rects || rects.length === 0) return false;

        let hasVisibleRect = false;
        let hasViewportRect = false;
        for (const rect of rects) {
          if (hasRenderableDimensions(rect)) {
            hasVisibleRect = true;
            if (isRectInExpandedViewport(rect)) {
              hasViewportRect = true;
              break;
            }
          }
        }

        if (!hasVisibleRect || !hasViewportRect) return false;
        const parentElement = textNode.parentElement;
        return parentElement ? checkElementVisibility(parentElement) : false;
      } catch (e) {
        return false;
      }
    }

    function isQuicklyOutsideViewport(node) {
      if (viewportExpansion === -1 || node.shadowRoot) return false;

      const rect = cache.getCachedBoundingRect(node);
      const style = cache.getCachedComputedStyle(node);
      const isFixedOrSticky = style && (style.position === 'fixed' || style.position === 'sticky');

      if (isFixedOrSticky || node.offsetWidth > 0 || node.offsetHeight > 0) {
        return false;
      }

      return (
        rect &&
        (rect.bottom < -viewportExpansion ||
          rect.top > window.innerHeight + viewportExpansion ||
          rect.right < -viewportExpansion ||
          rect.left > window.innerWidth + viewportExpansion)
      );
    }

      function isInExpandedViewport(element) {
        if (viewportExpansion === -1) return true;

        const rects = cache.getCachedClientRects(element);
        if (!rects || rects.length === 0) {
          const boundingRect = cache.getCachedBoundingRect(element);
          return (
            !!boundingRect &&
            hasRenderableDimensions(boundingRect) &&
            isRectInExpandedViewport(boundingRect)
          );
        }

        for (const rect of rects) {
          if (hasRenderableDimensions(rect) && isRectInExpandedViewport(rect)) {
            return true;
          }
        }

        return false;
      }

    return {
      hasRenderableDimensions,
      isRectInExpandedViewport,
      getRectCenter,
      getRectCheckPoints,
      isTrackingIframe,
      isStyleVisible,
      checkElementVisibility,
      hasEventHandlers,
      getElementEventListeners,
      hasInteractionListeners,
      isTagInDenyList,
      isElementAccepted,
      isElementVisible,
      isInteractiveCandidate,
      getElementPosition,
      getXPathTree,
      isTextNodeVisible,
      isQuicklyOutsideViewport,
      isInExpandedViewport,
    };
  };
})(window);

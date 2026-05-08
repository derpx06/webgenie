/**
 * DOM Tree Builder - Interactivity Module
 * Contains interactive-element detection and highlight-decision helpers.
 */

(function initializeDomTreeBuilderInteractivity(global) {
  const ns = (global.__DOM_TREE_BUILDER__ = global.__DOM_TREE_BUILDER__ || {});

  ns.createInteractivityHelpers = function createInteractivityHelpers({ constants, cache, helpers }) {
    function hasInteractiveCursor(element) {
      if (element.tagName.toLowerCase() === 'html') return false;
      const style = cache.getCachedComputedStyle(element);
      return Boolean(style?.cursor && constants.INTERACTIVE_CURSORS.has(style.cursor));
    }

    function isDisabled(element) {
      const style = cache.getCachedComputedStyle(element);
      if (style?.cursor && constants.NON_INTERACTIVE_CURSORS.has(style.cursor)) return true;

      for (const attr of constants.DISABLE_ATTRIBUTES) {
        if (element.hasAttribute(attr) || element.getAttribute(attr) === 'true') return true;
      }

      return Boolean(element.disabled || element.readOnly || element.inert);
    }

    function isEnabledFormElement(element) {
      const tagName = element.tagName.toLowerCase();
      if (!constants.INTERACTIVE_TAGS.has(tagName)) return false;
      return !isDisabled(element);
    }

    function hasInteractiveRole(element) {
      const role = element.getAttribute('role');
      return Boolean(role && constants.INTERACTIVE_ROLES.has(role));
    }

    function isEditableContent(element) {
      return element.isContentEditable || element.getAttribute('contenteditable') === 'true';
    }

    function hasClickListeners(element) {
      try {
        return helpers.hasInteractionListeners(element, ['click', 'mousedown', 'mouseup']);
      } catch (e) {
        return false;
      }
    }

    function isInteractiveElement(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
      if (hasInteractiveCursor(element)) return true;
      if (isEnabledFormElement(element)) return true;
      if (isEditableContent(element)) return true;
      if (hasInteractiveRole(element)) return true;
      
      if (element.hasAttribute('onclick') || 
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
          typeof element.onclick === 'function' ||
          (element.classList && (
            element.classList.contains('button') || 
            element.classList.contains('dropdown-toggle')
          ))) return true;

      if (hasClickListeners(element)) return true;
      
      return false;
    }

    function isHeuristicallyInteractive(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
      
      // Check for common attributes that often indicate interactivity
      const hasInteractiveAttributes =
        element.hasAttribute('role') ||
        element.hasAttribute('tabindex') ||
        element.hasAttribute('onclick') ||
        typeof element.onclick === 'function';

      // Check for semantic class names suggesting interactivity
      const className = typeof element.className === 'string' ? element.className : (element.className?.baseVal || '');
      const hasInteractiveClass = /\b(btn|clickable|menu|item|entry|link)\b/i.test(className);

      // Determine whether the element is inside a known interactive container
      const isInKnownContainer = Boolean(element.closest('button,a,[role="button"],.menu,.dropdown,.list,.toolbar'));

      // Ensure the element has at least one visible child (to avoid marking empty wrappers)
      const hasVisibleChildren = [...element.children].some(child => helpers.isElementVisible(child));

      // Avoid highlighting elements whose parent is <body> (top-level wrappers)
      const isParentBody = element.parentElement && element.parentElement.tagName.toLowerCase() === 'body';

      return (
        (isInteractiveElement(element) || hasInteractiveAttributes || hasInteractiveClass) &&
        hasVisibleChildren &&
        isInKnownContainer &&
        !isParentBody
      );
    }

    function isDistinctInteraction(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

      const tagName = element.tagName.toLowerCase();
      if (tagName === 'iframe') return true;
      if (constants.INTERACTIVE_TAGS.has(tagName)) return true;
      if (hasInteractiveRole(element)) return true;
      if (isEditableContent(element)) return true;
      
      if (element.hasAttribute('data-testid') || element.hasAttribute('data-cy') || element.hasAttribute('data-test')) {
        return true;
      }
      
      if (element.hasAttribute('onclick') || 
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
        typeof element.onclick === 'function' ||
        (element.classList && (
          element.classList.contains('button') || 
          element.classList.contains('dropdown-toggle')
        ))) return true;

      try {
        if (helpers.hasInteractionListeners(element, ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'submit', 'change', 'input', 'focus', 'blur'])) {
          return true;
        }
        if (helpers.hasEventHandlers(element, ['onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'onsubmit', 'onchange', 'oninput', 'onfocus', 'onblur'])) {
          return true;
        }
      } catch (e) {
        // ignore
      }

      // Check heuristics as a fallback
      return isHeuristicallyInteractive(element);
    }

    function shouldHighlightElement(nodeData, node, parentIframe, isParentHighlighted) {
      if (!nodeData.isInteractive) return false;
      if (!isParentHighlighted) return true;
      return isDistinctInteraction(node);
    }

    function isTopElement(element, viewportExpansion) {
      if (viewportExpansion === -1) return true;

      const rects = cache.getCachedClientRects(element);
      if (!rects || rects.length === 0) return false;

      let hasViewportRect = false;
      for (const rect of rects) {
        if (helpers.hasRenderableDimensions(rect) && helpers.isRectInExpandedViewport(rect)) {
          hasViewportRect = true;
          break;
        }
      }
      if (!hasViewportRect) return false;

      const shadowRoot = element.getRootNode();
      if (shadowRoot instanceof ShadowRoot) {
        const center = helpers.getRectCenter(rects[Math.floor(rects.length / 2)]);
        try {
          const topEl = shadowRoot.elementFromPoint(center.x, center.y);
          if (!topEl) return false;
          let current = topEl;
          while (current && current !== shadowRoot) {
            if (current === element) return true;
            current = current.parentElement;
          }
          return false;
        } catch (e) {
          return true;
        }
      }

      if (element.ownerDocument !== window.document) return true;

      const checkPoints = helpers.getRectCheckPoints(rects[Math.floor(rects.length / 2)]);
      return checkPoints.some(({ x, y }) => {
        // If point is outside actual viewport, we can't use elementFromPoint.
        // We assume it's on top if it's in the expanded viewport (already checked by caller).
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
          return true;
        }

        try {
          const topEl = document.elementFromPoint(x, y);
          if (!topEl) return false;
          let current = topEl;
          while (current && current !== document.documentElement) {
            if (current === element) return true;
            current = current.parentElement;
          }
          return false;
        } catch (e) {
          return true;
        }
      });
    }

    return {
      hasInteractiveCursor,
      isDisabled,
      isEnabledFormElement,
      hasInteractiveRole,
      isEditableContent,
      hasClickListeners,
      isInteractiveElement,
      isDistinctInteraction,
      shouldHighlightElement,
      isTopElement,
    };
  };
})(window);

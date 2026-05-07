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
        if (helpers.hasInteractionListeners(element, ['click', 'mousedown', 'mouseup', 'dblclick'])) return true;
        return helpers.hasEventHandlers(element, ['onclick', 'onmousedown', 'onmouseup', 'ondblclick']);
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
      if (element.hasAttribute('onclick') || hasClickListeners(element)) return true;
      return false;
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
      if (element.hasAttribute('onclick') || typeof element.onclick === 'function') return true;

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

      return false;
    }

    function shouldHighlightElement(nodeData, node, parentIframe, isParentHighlighted) {
      if (!nodeData.isInteractive) return false;
      if (!isParentHighlighted) return true;
      return isDistinctInteraction(node);
    }

    function analyzeElementProperties(node, nodeData, parentIframe, isParentHighlighted, viewportExpansion) {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;

      nodeData.isVisible = helpers.isElementVisible(node);
      if (!nodeData.isVisible) return false;

      nodeData.isTopElement = isTopElement(node, viewportExpansion);
      const role = node.getAttribute('role');
      const isMenuContainer = role === 'menu' || role === 'menubar' || role === 'listbox';
      if (!nodeData.isTopElement && !isMenuContainer) return false;

      nodeData.isInteractive = isInteractiveElement(node);
      return shouldHighlightElement(nodeData, node, parentIframe, isParentHighlighted);
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
      analyzeElementProperties,
      isTopElement,
    };
  };
})(window);

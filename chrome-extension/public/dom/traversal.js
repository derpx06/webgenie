/**
 * DOM Tree Builder - Traversal Module
 * Orchestrates DOM traversal and serialization into the raw tree structure.
 */

(function initializeDomTreeBuilderTraversal(global) {
  const ns = (global.__DOM_TREE_BUILDER__ = global.__DOM_TREE_BUILDER__ || {});

  ns.createTraversal = function createTraversal({
    constants,
    cache,
    helpers,
    interactivity,
    highlighting,
    showHighlightElements,
    focusHighlightIndex,
    viewportExpansion,
    startId,
    startHighlightIndex,
  }) {
    const DOM_HASH_MAP = {};
    const ID = { current: startId };
    let highlightIndex = startHighlightIndex;
    let visitedNodes = null;

    function createNodeData(node) {
      return {
        tagName: node.tagName.toLowerCase(),
        attributes: {},
        xpath: helpers.getXPathTree(node, true),
        children: [],
      };
    }

    function extractNodeAttributes(node, nodeData) {
      if (!helpers.isInteractiveCandidate?.(node) && node.tagName.toLowerCase() !== 'iframe' && node.tagName.toLowerCase() !== 'body') {
        return;
      }
      const attributeNames = node.getAttributeNames?.() || [];
      for (const name of attributeNames) {
        nodeData.attributes[name] = node.getAttribute(name);
      }
    }

    function processTextNode(textNode) {
      const textContent = textNode.textContent?.trim();
      if (!textContent) return null;

      const parentElement = textNode.parentElement;
      if (!parentElement || parentElement.tagName.toLowerCase() === 'script') return null;

      const id = `${ID.current++}`;
      DOM_HASH_MAP[id] = {
        type: 'TEXT_NODE',
        text: textContent,
        isVisible: helpers.isTextNodeVisible(textNode),
      };
      return id;
    }

    function performHighlighting(nodeData, node, parentIframe) {
      nodeData.isInViewport = helpers.isInExpandedViewport(node);
      if (nodeData.isInViewport || viewportExpansion === -1) {
        nodeData.highlightIndex = highlightIndex++;
        if (focusHighlightIndex < 0 || focusHighlightIndex === nodeData.highlightIndex) {
          highlighting.highlightElement(node, nodeData.highlightIndex, parentIframe, showHighlightElements);
        }
        return true;
      }
      return false;
    }

    function analyzeElementProperties(node, nodeData, parentIframe, isParentHighlighted) {
      nodeData.isVisible = helpers.isElementVisible(node);
      if (!nodeData.isVisible) return false;

      nodeData.isTopElement = interactivity.isTopElement(node, viewportExpansion);

      const role = node.getAttribute('role');
      const isMenuContainer = role === 'menu' || role === 'menubar' || role === 'listbox';

      // Only check interactivity for elements that are on top or are menu containers
      // (matches original logic - avoids expensive check for non-top elements)
      if (nodeData.isTopElement || isMenuContainer) {
        nodeData.isInteractive = interactivity.isInteractiveElement(node);
      } else {
        nodeData.isInteractive = false;
      }

      // Even if not highlighted, we still need to return whether the node was highlighted
      // so children can use isParentHighlighted correctly
      if (!interactivity.shouldHighlightElement(nodeData, node, parentIframe, isParentHighlighted)) {
        return false;
      }
      return performHighlighting(nodeData, node, parentIframe);
    }

    function processIframeNode(node, parentIframe, isParentHighlighted, depth, nodeData) {
      const rect = cache.getCachedBoundingRect(node);
      nodeData.attributes.computedHeight = String(Math.ceil(rect.height));
      nodeData.attributes.computedWidth = String(Math.ceil(rect.width));

      if (helpers.isTrackingIframe(rect)) {
        nodeData.attributes.skipped = 'invisible-tracking-iframe';
        return;
      }

      const sandbox = node.getAttribute('sandbox');
      const isRestrictiveSandbox = sandbox !== null && !sandbox.includes('allow-same-origin');
      if (isRestrictiveSandbox) {
        nodeData.attributes.error = 'Cross-origin iframe access blocked by sandbox';
        return;
      }

      try {
        const iframeDoc = node.contentDocument || node.contentWindow?.document;
        if (iframeDoc?.childNodes) {
          for (const child of Array.from(iframeDoc.childNodes)) {
            const domElement = traverse(child, node, isParentHighlighted, depth + 1);
            if (domElement) nodeData.children.push(domElement);
          }
        }
      } catch (e) {
        nodeData.attributes.error = e.message;
        if (!e.message.includes('cross-origin') && !e.message.includes('origin "null"')) {
          console.warn('Unable to access iframe:', e);
        }
      }
    }

    function processChildNodes(node, parentIframe, isParentHighlighted, depth, nodeData) {
      const tagName = node.tagName.toLowerCase();

      if (node.isContentEditable || node.getAttribute('contenteditable') === 'true' || node.id === 'tinymce' || node.classList.contains('mce-content-body') || (tagName === 'body' && node.getAttribute('data-id')?.startsWith('mce_'))) {
        for (const child of Array.from(node.childNodes)) {
          const domElement = traverse(child, parentIframe, isParentHighlighted, depth + 1);
          if (domElement) nodeData.children.push(domElement);
        }
        return;
      }

      if (node.shadowRoot) {
        nodeData.shadowRoot = true;
        for (const child of Array.from(node.shadowRoot.childNodes)) {
          const domElement = traverse(child, parentIframe, isParentHighlighted, depth + 1);
          if (domElement) nodeData.children.push(domElement);
        }
        return;
      }

      for (const child of Array.from(node.childNodes)) {
        const domElement = traverse(child, parentIframe, isParentHighlighted, depth + 1);
        if (domElement) nodeData.children.push(domElement);
      }
    }

    function shouldSkipNode(node) {
      if (!node || node.id === constants.CONFIG.HIGHLIGHT_CONTAINER_ID) return true;
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return true;
      if (node.nodeType === Node.ELEMENT_NODE && visitedNodes?.has(node)) return true;
      return false;
    }

    function traverse(node, parentIframe = null, isParentHighlighted = false, depth = 0) {
      if (!visitedNodes) visitedNodes = new WeakSet();
      if (depth > constants.CONFIG.MAX_RECURSION_DEPTH || shouldSkipNode(node)) return null;
      if (node.nodeType === Node.ELEMENT_NODE) visitedNodes.add(node);

      if (node.nodeType === Node.TEXT_NODE) return processTextNode(node);

      if (node === document.body) {
        const nodeData = { tagName: 'body', attributes: {}, xpath: '/body', children: [] };
        for (const child of Array.from(node.childNodes)) {
          const id = traverse(child, parentIframe, false, depth + 1);
          if (id) nodeData.children.push(id);
        }
        const id = `${ID.current++}`;
        DOM_HASH_MAP[id] = nodeData;
        return id;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      if (!helpers.isElementAccepted(node)) return null;
      if (helpers.isQuicklyOutsideViewport(node)) return null;

      const nodeData = createNodeData(node);
      extractNodeAttributes(node, nodeData);

      const nodeWasHighlighted = analyzeElementProperties(node, nodeData, parentIframe, isParentHighlighted);
      const tagName = node.tagName.toLowerCase();

      if (tagName === 'iframe') {
        processIframeNode(node, parentIframe, isParentHighlighted, depth, nodeData);
      } else {
        processChildNodes(node, parentIframe, nodeWasHighlighted || isParentHighlighted, depth, nodeData);
      }

      if (tagName === 'a' && nodeData.children.length === 0 && !nodeData.attributes.href) {
        const rect = cache.getCachedBoundingRect(node);
        const hasSize = (rect && rect.width > 0 && rect.height > 0) || node.offsetWidth > 0 || node.offsetHeight > 0;
        if (!hasSize) return null;
      }

      const id = `${ID.current++}`;
      DOM_HASH_MAP[id] = nodeData;
      return id;
    }

    function execute() {
      visitedNodes = null;
      const rootNode = document.body || document.documentElement || document;
      const rootId = traverse(rootNode);
      cache.clearCache();
      return { rootId, map: DOM_HASH_MAP };
    }

    return {
      traverse,
      execute,
    };
  };
})(window);

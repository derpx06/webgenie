/**
 * DOM Tree Builder - Bootstrap Loader
 * Loads the modular DOM builder pieces and exposes the same window.buildDomTree API.
 */

(function initializeDomTreeBuilderBootstrap(global) {
  const ns = (global.__DOM_TREE_BUILDER__ = global.__DOM_TREE_BUILDER__ || {});
  ns.__xpathCache = ns.__xpathCache || new WeakMap();

  window.buildDomTree = function buildDomTree(args = {}) {
    const {
      showHighlightElements = false,
      focusHighlightIndex = -1,
      viewportExpansion = 0,
      debugMode = false,
      startId = 0,
      startHighlightIndex = 0,
    } = args;

    const cache = ns.createDOMCache();
    const helpers = ns.createDomHelpers({
      viewportExpansion,
      cache,
      constants: ns,
      features: ns.FEATURES,
    });
    const interactivity = ns.createInteractivityHelpers({
      constants: ns,
      cache,
      helpers,
      features: ns.FEATURES,
    });
    const highlighting = ns.createHighlightingHelpers({
      constants: ns,
      cache,
      helpers,
      config: ns.CONFIG,
    });
    const traversal = ns.createTraversal({
      constants: ns,
      cache,
      helpers,
      interactivity,
      highlighting,
      showHighlightElements,
      focusHighlightIndex,
      viewportExpansion,
      startId,
      startHighlightIndex,
      debugMode,
    });

    return traversal.execute();
  };
})(window);

/**
 * DOM Tree Builder - Bootstrap Loader
 * Loads the modular DOM builder pieces and exposes the same window.buildDomTree API.
 */

(function initializeDomTreeBuilderBootstrap(global) {
  const ns = (global.__DOM_TREE_BUILDER__ = global.__DOM_TREE_BUILDER__ || {});
  ns.__xpathCache = ns.__xpathCache || new WeakMap();

  class DomTreeBuilder {
    constructor() {
      this.args = {
        showHighlightElements: false,
        focusHighlightIndex: -1,
        viewportExpansion: 0,
        debugMode: false,
        startId: 0,
        startHighlightIndex: 0,
      };
    }

    withHighlightElements(show) {
      this.args.showHighlightElements = show;
      return this;
    }

    withFocusHighlightIndex(index) {
      this.args.focusHighlightIndex = index;
      return this;
    }

    withViewportExpansion(expansion) {
      this.args.viewportExpansion = expansion;
      return this;
    }

    withDebugMode(params = {}) {
      if (typeof params === 'boolean') {
        this.args.debugMode = params;
      } else {
        this.args.debugMode = params.debugMode || false;
      }
      return this;
    }

    withStartIndex(startId, startHighlightIndex) {
      this.args.startId = startId || 0;
      this.args.startHighlightIndex = startHighlightIndex || 0;
      return this;
    }

    buildAndExecute() {
      const cache = ns.createDOMCache();
      const helpers = ns.createDomHelpers({
        viewportExpansion: this.args.viewportExpansion,
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
        showHighlightElements: this.args.showHighlightElements,
        focusHighlightIndex: this.args.focusHighlightIndex,
        viewportExpansion: this.args.viewportExpansion,
        startId: this.args.startId,
        startHighlightIndex: this.args.startHighlightIndex,
        debugMode: this.args.debugMode,
      });

      return traversal.execute();
    }
  }

  // Export the builder
  window.DomTreeBuilder = DomTreeBuilder;

  // Maintain backward compatibility with the old API
  window.buildDomTree = function buildDomTree(args = {}) {
    return new DomTreeBuilder()
      .withHighlightElements(args.showHighlightElements || false)
      .withFocusHighlightIndex(args.focusHighlightIndex !== undefined ? args.focusHighlightIndex : -1)
      .withViewportExpansion(args.viewportExpansion || 0)
      .withDebugMode(args.debugMode || false)
      .withStartIndex(args.startId || 0, args.startHighlightIndex || 0)
      .buildAndExecute();
  };
})(window);

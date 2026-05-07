/**
 * DOM Tree Builder - Cache Module
 * Provides WeakMap-based caching for DOM measurements to avoid redundant queries.
 */

(function initializeDomTreeBuilderCache(global) {
  const ns = (global.__DOM_TREE_BUILDER__ = global.__DOM_TREE_BUILDER__ || {});

  ns.createDOMCache = function createDOMCache() {
    const cache = {
      boundingRects: new WeakMap(),
      clientRects: new WeakMap(),
      computedStyles: new WeakMap(),

      clearCache() {
        this.boundingRects = new WeakMap();
        this.clientRects = new WeakMap();
        this.computedStyles = new WeakMap();
      },
    };

    cache.getCachedBoundingRect = function (element) {
      if (!element) return null;
      if (this.boundingRects.has(element)) {
        return this.boundingRects.get(element);
      }

      const rect = element.getBoundingClientRect();
      if (rect) this.boundingRects.set(element, rect);
      return rect;
    };

    cache.getCachedComputedStyle = function (element) {
      if (!element) return null;
      if (this.computedStyles.has(element)) {
        return this.computedStyles.get(element);
      }

      const style = window.getComputedStyle(element);
      if (style) this.computedStyles.set(element, style);
      return style;
    };

    cache.getCachedClientRects = function (element) {
      if (!element) return null;
      if (this.clientRects.has(element)) {
        return this.clientRects.get(element);
      }

      const rects = element.getClientRects();
      if (rects) this.clientRects.set(element, rects);
      return rects;
    };

    return cache;
  };
})(window);

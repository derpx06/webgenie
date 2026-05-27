/**
 * DOM TREE BUILDER - Constants Module
 * Defines all constants used throughout the DOM tree builder.
 */

(function initializeDomTreeBuilderConstants(global) {
  const ns = (global.__DOM_TREE_BUILDER__ = global.__DOM_TREE_BUILDER__ || {});

  ns.INTERACTIVE_TAGS = new Set([
    'a',
    'button',
    'input',
    'select',
    'textarea',
    'details',
    'summary',
    'label',
    'option',
    'optgroup',
    'fieldset',
    'legend',
    'form',
  ]);

  ns.INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menu', 'menubar', 'menuitem',
    'menuitemradio', 'menuitemcheckbox', 'radio',
    'checkbox', 'tab', 'switch', 'slider',
    'spinbutton', 'combobox', 'searchbox', 'textbox',
    'listbox', 'option', 'scrollbar',
    // Modal / dialog
    'dialog', 'alertdialog',
    // Tree / grid structures (common in dashboards, file explorers)
    'treeitem', 'tree', 'row', 'gridcell', 'columnheader', 'rowheader',
    'grid', 'treegrid',
    // Status / info (so agent sees notification areas)
    'tooltip', 'log', 'status', 'alert',
  ]);

  ns.INTERACTIVE_CURSORS = new Set([
    'pointer', 'move', 'text', 'grab', 'grabbing', 'cell',
  ]);

  ns.NON_INTERACTIVE_CURSORS = new Set([
    'not-allowed', 'no-drop', 'wait', 'progress',
  ]);

  ns.ELEMENT_DENY_LIST = new Set([
    'script', 'style', 'link', 'meta', 'noscript', 'template',
  ]);

  ns.DISABLE_ATTRIBUTES = new Set(['disabled', 'readonly', 'inert', 'aria-disabled']);

  ns.ALWAYS_ACCEPT_TAGS = new Set([
    'body', 'div', 'main', 'article', 'section', 'nav', 'header', 'footer',
  ]);

  ns.HIGHLIGHT_COLORS = [
    '#FF0000', '#00FF00', '#0000FF', '#FFA500',
    '#800080', '#008080', '#FF69B4', '#4B0082',
    '#FF4500', '#2E8B57', '#DC143C', '#4682B4',
  ];

  ns.CONFIG = {
    MAX_RECURSION_DEPTH: 100,
    HIGHLIGHT_CONTAINER_ID: 'playwright-highlight-container',
    HIGHLIGHT_UPDATE_FPS: 60,
    HIGHLIGHT_THROTTLE_MS: 16,
    MIN_RECT_SIZE: 1,
    OFFSCREEN_THRESHOLD: 1000,
  };

  ns.FEATURES = {
    hasEventListenersAPI: typeof getEventListeners === 'function',
    hasCheckVisibility: typeof Element?.prototype?.checkVisibility === 'function',
  };
})(window);

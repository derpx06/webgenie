/**
 * DOM Analysis Module
 * Provides comprehensive DOM tree analysis, element detection, and accessibility information.
 * Builds machine-readable representations of web pages for agent reasoning.
 *
 * Structure:
 * - service: Core DOM analysis and accessibility tree building
 * - clickable: Detection of interactive elements
 * - history: DOM state tracking and snapshots
 * - views: DOM visualization and debugging utilities
 */

export * from './service';
export * from './views';
export * from './raw_types';
export * as DOMClickable from './clickable/index';
export * as DOMHistory from './history/index';

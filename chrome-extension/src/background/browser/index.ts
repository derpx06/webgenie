/**
 * Browser Interaction Module
 * Core abstraction layer over Chrome Extension APIs for browser automation.
 * Provides tab, page, and DOM interaction capabilities.
 *
 * Structure:
 * - DOM Analysis: Parse and analyze web page structure
 * - Page Interaction: Execute clicks, typing, scrolling on pages
 * - Context: Browser state and tab management
 * - Views: Debugging and visualization utilities
 * - Utils: Helper functions and utilities
 */

export * as DOM from './dom/index';
export * from './context';
export * from './page';
export * from './views';
export * from './util';

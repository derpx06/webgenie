/**
 * Side Panel Components Module
 * All components used in the side panel UI.
 * Organized by feature domain for clarity and maintainability.
 *
 * Structure:
 * - Chat features (input, history, messages)
 * - Visual features (agent sight, orb)
 * - Welcome/onboarding
 * - Navigation headers
 * - Bookmarks
 * - Utilities (empty states)
 */

// Chat Interface Components
export * from './ChatInput';
export * from './ChatHistoryList';
export * from './MessageList';
export * from './chat-input/index';

// Visual Components
export * from './AgentSight';
export * from './visual/index';

// Welcome & Onboarding
export * from './WelcomeScreen';
export * from './welcome/index';

// Navigation & Headers
export * from './SidePanelHeader';

// Utilities
export * from './BookmarkList';
export * from './EmptyChat';

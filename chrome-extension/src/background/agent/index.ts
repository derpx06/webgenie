/**
 * Agent Core Module
 * Main entry point for the multi-agent system orchestrator.
 * Exports the execution engine and related types/utilities.
 *
 * Architecture:
 * - Executor: Main orchestrator for agent lifecycle and task execution
 * - Agents: NavigatorAgent, PlannerAgent implementations
 * - Prompts: System contexts and reasoning templates
 * - Actions: Action definitions and validation schemas
 * - Messages: UI communication and event management
 * - History: Execution state tracking
 */

export { Executor } from './executor';
export type { ActionResult, AgentContext, AgentOptions, AgentOutput } from './types';

// Re-export agent implementations
export * from './agents/index';

// Re-export prompts
export * from './prompts/index';

// Re-export message management
export * from './messages/index';

// Re-export actions
export * from './actions/index';

// Re-export event system
export * from './event/index';

// Internal utilities
export { convertInputMessages, extractJsonFromModelOutput, removeThinkTags } from './messages/utils';
export * from './history';
export * from './helper';
export * from './types';

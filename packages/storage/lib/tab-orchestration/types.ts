/**
 * Tab Orchestration — Shared Type Definitions
 *
 * These types are the single source of truth used across:
 *   - packages/storage  (persistence layer)
 *   - chrome-extension/src/background/core  (orchestration engine)
 *   - pages/side-panel  (UI rendering)
 *
 * Keep this file free of Chrome API imports so it can be safely
 * consumed by all environments (background, content, side-panel).
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * The lifecycle state of an AI-managed tab.
 *
 * Only ONE tab should be PRIMARY_ACTIVE at any given moment.
 * All other AI tabs belong to one of the subordinate states.
 */
export enum TabState {
  /** The tab the AI is currently operating on. */
  PRIMARY_ACTIVE = 'primary_active',
  /** An AI tab active in the background (e.g., loading a page). */
  BACKGROUND_ACTIVE = 'background_active',
  /** The AI is waiting for this tab (page load, human input, etc.). */
  WAITING = 'waiting',
  /** An AI tab that is open but not currently needed. */
  IDLE = 'idle',
  /** The AI has finished with this tab. */
  COMPLETE = 'complete',
  /** The AI encountered an error on this tab. */
  ERROR = 'error',
}

/**
 * The semantic stage of work the AI is performing on a tab.
 * Drives the content-script visual glow state.
 */
export enum WorkflowStage {
  RESEARCHING = 'researching',
  TYPING = 'typing',
  CLICKING = 'clicking',
  WAITING = 'waiting',
  PLANNING = 'planning',
  COMPARING = 'comparing',
  COMPLETED = 'completed',
  ERROR = 'error',
  IDLE = 'idle',
}

/**
 * Visual color group assigned to a task group.
 * Maps to chrome.tabGroups.Color values.
 */
export enum GroupColor {
  BLUE = 'blue',       // Research
  GREEN = 'green',     // Execution
  YELLOW = 'yellow',   // Waiting
  PURPLE = 'purple',   // Planning
  RED = 'red',         // Error
  GREY = 'grey',       // Completed
  CYAN = 'cyan',       // General AI activity (fallback)
}

/**
 * The state of a TaskGroup lifecycle.
 */
export enum TaskGroupState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  COMPLETE = 'complete',
  ERROR = 'error',
}

// ---------------------------------------------------------------------------
// Core Interfaces
// ---------------------------------------------------------------------------

/**
 * Metadata record for a single AI-managed browser tab.
 * Stored in chrome.storage.local and mirrored in-memory for fast reads.
 */
export interface TabRecord {
  /** Chrome tab ID (immutable key). */
  readonly tabId: number;

  /** The task session ID this tab belongs to (matches chatHistoryStore sessionId). */
  taskId: string;

  /**
   * Human-readable semantic description of why this tab exists.
   * Example: "Comparing GPU benchmark scores", "Reading Reddit reviews"
   */
  purpose: string;

  /** Current workflow stage (drives content-script glow color). */
  workflowStage: WorkflowStage;

  /** Current activity state of the tab relative to the AI agent. */
  state: TabState;

  /**
   * Whether this tab was created for transient use (auto-close candidate).
   * Examples: quick searches, documentation lookups, comparison pages.
   */
  temporary: boolean;

  /** Unix timestamp when the tab was registered by the orchestrator. */
  createdAt: number;

  /** Unix timestamp of the last state/purpose update. */
  updatedAt: number;

  /**
   * Confidence score (0–1) for the purpose label.
   * Used when deciding whether to reuse a tab for a different task.
   */
  confidence: number;

  /** Description of the last action the AI performed on this tab. */
  lastAction: string;

  /** True if this tab was created or is being managed by the AI agent. */
  aiOwned: boolean;

  /** The chrome.tabGroups groupId this tab belongs to, or null. */
  groupId: number | null;

  /** Page title at time of last update (for display purposes). */
  pageTitle: string;

  /** URL at time of last update. */
  url: string;
}

/**
 * A logical grouping of tabs belonging to one agent task.
 * Mirrors a chrome.tabGroups entry when tabGroups API is available.
 */
export interface TaskGroup {
  /** Internal group identifier (UUID). Also used as the key in storage. */
  readonly groupId: string;

  /** The agent task session ID this group was created for. */
  taskId: string;

  /** Semantic title for the group (AI-generated from task description). */
  title: string;

  /** Visual color assigned to this group. */
  color: GroupColor;

  /** Current lifecycle state of the group. */
  state: TaskGroupState;

  /** Ordered list of tab IDs in this group. */
  tabIds: number[];

  /** Unix timestamp of group creation. */
  createdAt: number;

  /**
   * chrome.tabGroups native group ID, if the API is supported.
   * null when running in a non-grouping context (e.g., Firefox fallback).
   */
  chromeGroupId: number | null;
}

// ---------------------------------------------------------------------------
// Persisted State Shape
// ---------------------------------------------------------------------------

/**
 * The full shape of the tab orchestration state persisted to chrome.storage.local.
 */
export interface TabOrchestrationState {
  /** All known AI-managed tabs, keyed by tabId. */
  tabs: Record<number, TabRecord>;

  /** All task groups, keyed by groupId. */
  groups: Record<string, TaskGroup>;

  /** The currently primary-active tab ID (or null when agent is idle). */
  activeTabId: number | null;

  /** The currently active task group ID (or null when agent is idle). */
  activeGroupId: string | null;

  /** Unix timestamp of the last state flush to storage. */
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Message Protocol (Background ↔ Side Panel)
// ---------------------------------------------------------------------------

/**
 * Message sent from background to side panel with current orchestration state.
 * Sent in response to 'tab_orchestration_query' or as a push notification.
 */
export interface TabOrchestrationStateMessage {
  type: 'tab_orchestration_state';
  state: TabOrchestrationState;
}

/**
 * Richer AGENT_STATUS message enriched with workflow stage data.
 * Backward-compatible — all new fields are optional.
 */
export interface AgentStatusMessage {
  type: 'AGENT_STATUS';
  active: boolean;
  status?: string;
  showBorder?: boolean;
  showCapsule?: boolean;
  /** New: workflow stage for state-aware glow color. */
  workflowStage?: WorkflowStage;
  /** New: task name for display in the capsule. */
  taskName?: string;
}

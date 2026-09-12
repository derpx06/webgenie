/**
 * Compressed summary of a completed task outcome.
 */
export interface EpisodicNote {
  id: string;                // UUID — used for A-MEM Zettelkasten linking
  domain: string;
  pagePath: string;          // page path where the task was performed
  intent: string;            // e.g. "compose and send email"
  outcomeSteps: string;      // 3-line compressed summary of what worked
  successCount: number;      // number of times this intent succeeded
  linkedNoteIds: string[];   // A-MEM links to related notes on same domain
  timestamp: number;
}

/**
 * Per-domain KV intelligence record — tracks cross-session domain metadata.
 */
export interface DomainRecord {
  domain: string;
  lastVisited: number;
  layoutFingerprint: string;    // most recent structural fingerprint
  knownPanels: string[];        // discovered UI panels e.g. ["compose", "inbox"]
  totalSuccessfulTasks: number; // cumulative task success count
}

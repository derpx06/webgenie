export type ExecutionStatus = 'not_attempted' | 'executed' | 'threw';

export type ValidationStatus = 'not_applicable' | 'passed' | 'failed' | 'unknown';

export type Retryability = 'none' | 'retry_same' | 'retry_reobserve' | 'replan' | 'ask_human' | 'fatal';

export interface ValidationEvidence {
  kind:
    | 'url_change'
    | 'document_change'
    | 'new_tab'
    | 'active_tab'
    | 'target_value'
    | 'selection'
    | 'scroll_delta'
    | 'scroll_boundary'
    | 'focus_change'
    | 'modal_or_menu_change'
    | 'accepted_noop'
    | 'done_supported'
    | 'done_blocked'
    | 'error';
  passed: boolean;
  before?: unknown;
  after?: unknown;
  message: string;
}

export interface TargetFingerprint {
  index: number;
  actionType: string;
  tabId?: number;
  frameId?: string;
  backendNodeId?: number;
  xpath?: string;
  cssSelector?: string;
  role?: string;
  accessibleName?: string;
  tagName?: string;
  textHash?: string;
  rectHash?: string;
}

export interface BrowserObservation {
  id: string;
  tabId: number | null;
  url: string;
  title: string;
  capturedAt: number;
  documentFingerprint: string;
  layoutFingerprint: string;
  targets: TargetFingerprint[];
}

export type ExecutionStatus = 'not_attempted' | 'executed' | 'threw';

export type ValidationStatus = 'not_applicable' | 'passed' | 'failed' | 'unknown';

export type Retryability = 'none' | 'retry_reobserve' | 'replan';

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
    | 'modal_or_menu_change'
    | 'target_state'
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
  /** What the page says and offers (address, title, elements and their state, text) without where it sits: scrolling alone never changes it. */
  contentFingerprint?: string;
  targets: TargetFingerprint[];
}

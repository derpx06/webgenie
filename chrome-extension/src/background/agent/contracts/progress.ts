import type { ActionResult } from '../types';
import type { ValidatedProgressRecord } from './types';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ProgressLedger {
  static recordFromActionResult(params: {
    taskId: string;
    contractId: string;
    observationId: string | null;
    actionId: string | null;
    actionName: string;
    result: ActionResult;
  }): ValidatedProgressRecord {
    const status: ValidatedProgressRecord['status'] =
      params.result.isWaitingForHuman ? 'blocked' :
        params.result.validated === 'passed' ? 'completed' :
          params.result.validated === 'failed' ? 'failed' :
            params.result.validated === 'unknown' ? 'unknown' :
              'completed';
    const evidenceSummary = params.result.evidence
      .map(item => `${item.kind}:${item.passed ? 'pass' : 'fail'}`)
      .join(', ');

    return {
      id: makeId('progress'),
      taskId: params.taskId,
      contractId: params.contractId,
      observationId: params.observationId,
      actionId: params.actionId,
      summary: `${params.actionName} ${status}${evidenceSummary ? ` (${evidenceSummary})` : ''}`,
      status,
      evidence: params.result.evidence,
      createdAt: Date.now(),
    };
  }

  static append(records: ValidatedProgressRecord[], record: ValidatedProgressRecord, limit = 30): ValidatedProgressRecord[] {
    return [...records, record].slice(-limit);
  }
}

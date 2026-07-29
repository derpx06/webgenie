import type { ActionResult } from '../types';
import type { ReplanDecision } from './types';

export interface ReplanDecisionInput {
  step: number;
  navigatorDone: boolean;
  latestResults: ActionResult[];
  stepsSinceLastPlan: number;
  planningInterval: number;
  progressStalled: boolean;
  retrySameAttemptsForContract?: number;
  currentContractId?: string | null;
}

export function getReplanDecision(input: ReplanDecisionInput): ReplanDecision {
  if (input.step === 0) {
    return {
      shouldReplan: true,
      trigger: 'step_interval',
      reason: 'Initial step requires a planner contract.',
      retryability: null,
      failedContractId: input.currentContractId ?? undefined,
    };
  }

  const latestMutating = [...input.latestResults].reverse().find(result => result.executed);
  if (latestMutating) {
    if (latestMutating.isWaitingForHuman) {
      return {
        shouldReplan: true,
        trigger: 'human_needed',
        reason: 'Latest action is waiting for human input.',
        retryability: latestMutating.retryability,
        failedContractId: input.currentContractId ?? latestMutating.contractId ?? undefined,
      };
    }

    if (latestMutating.retryability === 'fatal') {
      return {
        shouldReplan: true,
        trigger: 'fatal_error',
        reason: latestMutating.failureReason ?? 'Latest action reported a fatal failure.',
        retryability: latestMutating.retryability,
        failedContractId: input.currentContractId ?? latestMutating.contractId ?? undefined,
      };
    }

    if (latestMutating.validated === 'unknown' || latestMutating.retryability === 'retry_reobserve') {
      return {
        shouldReplan: true,
        trigger: 'validation_unknown',
        reason: latestMutating.failureReason ?? 'Latest action validation is unknown; re-observe and replan.',
        retryability: latestMutating.retryability,
        failedContractId: input.currentContractId ?? latestMutating.contractId ?? undefined,
      };
    }

    if (latestMutating.validated === 'failed' || latestMutating.retryability === 'replan') {
      if (latestMutating.retryability === 'retry_same' && (input.retrySameAttemptsForContract ?? 0) < 1) {
        return {
          shouldReplan: false,
          trigger: 'validation_failed',
          reason: 'Validation failed with retry_same; allow one retry under the same contract.',
          retryability: latestMutating.retryability,
          failedContractId: input.currentContractId ?? latestMutating.contractId ?? undefined,
        };
      }
      return {
        shouldReplan: true,
        trigger: 'validation_failed',
        reason: latestMutating.failureReason ?? 'Latest action validation failed.',
        retryability: latestMutating.retryability,
        failedContractId: input.currentContractId ?? latestMutating.contractId ?? undefined,
      };
    }
  }

  if (input.navigatorDone) {
    return {
      shouldReplan: true,
      trigger: 'contract_complete',
      reason: 'Navigator reported step completion; planner must verify final state.',
      retryability: null,
      failedContractId: input.currentContractId ?? undefined,
    };
  }

  if (input.progressStalled) {
    return {
      shouldReplan: true,
      trigger: 'progress_stall',
      reason: 'Recent outputs repeated or progress stalled.',
      retryability: null,
      failedContractId: input.currentContractId ?? undefined,
    };
  }

  if (input.stepsSinceLastPlan >= input.planningInterval) {
    return {
      shouldReplan: true,
      trigger: 'step_interval',
      reason: 'Planner interval elapsed.',
      retryability: null,
      failedContractId: input.currentContractId ?? undefined,
    };
  }

  return {
    shouldReplan: false,
    trigger: 'step_interval',
    reason: 'Current contract remains active.',
    retryability: null,
    failedContractId: input.currentContractId ?? undefined,
  };
}

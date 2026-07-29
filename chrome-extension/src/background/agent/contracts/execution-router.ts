import type { NextStepContract } from './types';

export interface DeterministicRoute {
  contract: NextStepContract;
  actions: Record<string, unknown>[];
}

function makeContract(params: {
  goal: string;
  macroObjective: NextStepContract['macroObjective'];
  allowedActions: string[];
  successCondition: string;
  urlPattern?: string;
}): NextStepContract {
  return {
    id: `contract_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    mode: 'single_browser_action',
    goal: params.goal,
    macroObjective: params.macroObjective,
    allowedActions: params.allowedActions,
    expectedObservation: {
      observationId: null,
      urlPattern: params.urlPattern,
      expectedDocumentChange: true,
    },
    successCondition: params.successCondition,
    failureSignals: ['URL did not change', 'Document did not change', 'Validation failed'],
    replanTrigger: 'validation_failed',
    createdAt: Date.now(),
  };
}

function exactUrlTask(task: string): string | null {
  const trimmed = task.trim();
  const match = trimmed.match(/^(?:go to|open|navigate to|visit)\s+(https?:\/\/[^\s]+)$/i);
  return match?.[1] ?? null;
}

function exactSearchTask(task: string): string | null {
  const trimmed = task.trim();
  const match = trimmed.match(/^(?:search(?: google| web)? for|google)\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export class ExecutionRouter {
  static routeTask(task: string): DeterministicRoute | null {
    const url = exactUrlTask(task);
    if (url) {
      return {
        contract: makeContract({
          goal: task,
          macroObjective: 'NAVIGATE',
          allowedActions: ['go_to_url'],
          successCondition: `Active tab URL matches ${url}`,
          urlPattern: url,
        }),
        actions: [{ go_to_url: { url } }],
      };
    }

    const query = exactSearchTask(task);
    if (query) {
      return {
        contract: makeContract({
          goal: task,
          macroObjective: 'SEARCH',
          allowedActions: ['search_web', 'search_google'],
          successCondition: `Search results are loaded for ${query}`,
          urlPattern: query,
        }),
        actions: [{ search_web: { query } }],
      };
    }

    return null;
  }
}

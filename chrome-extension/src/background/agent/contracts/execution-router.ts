import type { NextStepContract } from './types';

export interface DeterministicRoute {
  contract: NextStepContract;
  actions: Record<string, unknown>[];
}

function exactUrlTask(task: string): string | null {
  const match = task.trim().match(/^(?:go to|open|navigate to|visit)\s+(https?:\/\/[^\s]+)$/i);
  return match?.[1] ?? null;
}

/**
 * Tasks that are exactly "go to <url>" run without the planner. Anything phrased more loosely
 * (including searches) goes through planning: routing a whole sentence to a search engine
 * searched the wrong thing and hit captchas.
 */
export class ExecutionRouter {
  static routeTask(task: string): DeterministicRoute | null {
    const url = exactUrlTask(task);
    if (!url) return null;
    return {
      contract: {
        id: `contract_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        mode: 'single_browser_action',
        goal: task,
        macroObjective: 'NAVIGATE',
        expectedObservation: { observationId: null, urlPattern: url, expectedDocumentChange: true },
        successCondition: `Active tab URL matches ${url}`,
        failureSignals: ['URL did not change', 'Document did not change', 'Validation failed'],
        createdAt: Date.now(),
      },
      actions: [{ go_to_url: { url } }],
    };
  }
}

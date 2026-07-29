import type { ContextBudgetReport } from './types';

export interface ContextBudgetInput {
  taskId: string;
  callId: string;
  actor: 'planner' | 'navigator';
  outputTokens: number;
  sections: {
    systemPrompt: string;
    structuredMemory: string;
    currentContract: string;
    validatedProgress: string;
    compactBrowserState: string;
    interactiveElements: string;
    screenshots: string;
  };
}

const SECTION_NAMES: Array<[keyof ContextBudgetInput['sections'], string]> = [
  ['systemPrompt', 'system prompt'],
  ['structuredMemory', 'structured memory'],
  ['currentContract', 'current contract'],
  ['validatedProgress', 'validated progress'],
  ['compactBrowserState', 'compact browser state'],
  ['interactiveElements', 'interactive elements'],
  ['screenshots', 'screenshots'],
];

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class ContextBudgetReporter {
  static build(input: ContextBudgetInput): ContextBudgetReport {
    const sections = SECTION_NAMES.map(([key, name]) => {
      const text = input.sections[key] ?? '';
      return {
        name,
        estimatedTokens: estimateTokens(text),
        included: text.length > 0,
      };
    });

    return {
      taskId: input.taskId,
      callId: input.callId,
      actor: input.actor,
      sections,
      totalEstimatedInputTokens: sections.reduce((sum, section) => sum + section.estimatedTokens, 0),
      outputTokens: input.outputTokens,
    };
  }
}

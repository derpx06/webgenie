import { createLogger } from '@src/background/log';
import { repairJsonString } from '@src/background/utils';

const logger = createLogger('NavigatorUtils');

/**
 * Normalizes LLM action output into an array of objects.
 * Handles cases where the model returns a string, a single object, or malformed JSON.
 */
export function normalizeActions(actionInput: unknown): Record<string, unknown>[] {
  if (Array.isArray(actionInput)) {
    const validActions = actionInput.filter((item): item is Record<string, unknown> => item !== null);
    if (validActions.length === 0) {
      logger.warning('No valid actions found in array', actionInput);
    }
    return validActions;
  }

  if (typeof actionInput === 'string') {
    try {
      return JSON.parse(actionInput);
    } catch {
      try {
        const repaired = repairJsonString(actionInput);
        return JSON.parse(repaired);
      } catch {
        logger.error('Failed to parse actions string even after repair', actionInput);
        throw new Error('Invalid action output format');
      }
    }
  }

  if (actionInput !== null && typeof actionInput === 'object') {
    return [actionInput as Record<string, unknown>];
  }

  return [];
}

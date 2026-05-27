import { Executor } from './executor';
import { createLogger } from '@src/background/log';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from './event/types';
import { analytics } from '../services/analytics';
import { RequestCancelledError, MaxStepsReachedError } from './agents/errors';

const logger = createLogger('AgentStates');

export abstract class AgentState {
  abstract execute(executor: Executor): Promise<AgentState | null>;
}

// Example State Pattern Implementation 
// (We will integrate this into executor.ts step by step)

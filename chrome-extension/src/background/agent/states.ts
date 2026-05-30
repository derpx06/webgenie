import type { Executor } from './executor';

export abstract class AgentState {
  abstract execute(executor: Executor): Promise<AgentState | null>;
}

// Example State Pattern Implementation 
// (We will integrate this into executor.ts step by step)

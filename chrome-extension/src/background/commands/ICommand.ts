import type { Executor } from '../agent/executor';
import type BrowserContext from '../browser/context';
import type { TabOrchestrator } from '../core/tab-orchestrator';
import type { GeneralSettingsStorage } from '@extension/storage';

export interface ICommandContext {
  port: chrome.runtime.Port;
  browserContext: BrowserContext;
  tabOrchestrator: TabOrchestrator;
  generalSettingsStore: GeneralSettingsStorage;
  currentExecutor: Executor | null;
  setExecutor: (executor: Executor | null) => void;
}

export interface ICommand {
  execute(message: unknown, context: ICommandContext): Promise<void>;
}

import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for general settings configuration
export interface GeneralSettingsConfig {
  /**
   * When the user read the notice shown before the first task, or null if they have not. The agent does not start
   * until this is set: the store requires a disclosure that is in the product and comes before collection, not only
   * in a policy document.
   */
  dataDisclosureAcceptedAt: number | null;
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  planningInterval: number;
  actionSettleTimeoutMs: number;
  actionDelayMs: number;
  displayHighlights: boolean;
  minWaitPageLoad: number;
  showAmbientBorder: boolean;
  showStatusCapsule: boolean;
  enableTracing: boolean;
  langsmithApiKey: string;
  langsmithEndpoint: string;
  langsmithProject: string;
  /** Whether to use chrome.tabGroups to visually group AI-managed tabs by task. */
  enableTabGrouping: boolean;
  /** Whether ephemeral (temporary) AI tabs are auto-closed when the task completes. */
  autoCloseEphemeralTabs: boolean;
  /** Minutes the agent waits for an answer before it saves the task and stops; replying later resumes it. */
  humanWaitMinutes: number;
  /** Whether the agent gets the tools that read or change bookmarks, history, downloads, browsing data and extensions. */
  enableBrowserDataTools: boolean;
  /** Whether the agent gets the power tools: running JavaScript in the page, reading the site's JSON API, and files. */
  enableAdvancedTools: boolean;
  /** Finish when the navigator's answer is fully backed by the page and validated steps, without the planner's extra check. */
  acceptEvidencedDone: boolean;
  /** How often it asks you to pick between matching options. Orders, payments, accounts and card details are handed back whatever this says. */
  askLevel: AskLevel;
}

/** How often the agent asks the user to choose between options: more (ask whenever options differ), balanced, or less (decide). */
export type AskLevel = 'more' | 'balanced' | 'less';

export type GeneralSettingsStorage = BaseStorage<GeneralSettingsConfig> & {
  updateSettings: (settings: Partial<GeneralSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<GeneralSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsConfig = {
  dataDisclosureAcceptedAt: null,
  // 50, not 100: raising the cap bought almost nothing in the measured runs (11 of the 39 that hit a limit were still on
  // track), and the control only ever offered up to 100, so the shipped value now sits inside it.
  maxSteps: 50,
  maxActionsPerStep: 5,
  maxFailures: 3,
  // Selective: a screenshot only when the model asks for one or the task is stuck, and only for models that read images.
  useVision: true,
  useVisionForPlanner: false,
  planningInterval: 5,
  actionSettleTimeoutMs: 2000,
  actionDelayMs: 150,
  displayHighlights: false,
  minWaitPageLoad: 250,
  showAmbientBorder: true,
  showStatusCapsule: true,
  enableTracing: false,
  langsmithApiKey: '',
  langsmithEndpoint: 'https://api.smith.langchain.com',
  langsmithProject: 'web-surfer',
  enableTabGrouping: true,
  autoCloseEphemeralTabs: false,
  humanWaitMinutes: 10,
  enableBrowserDataTools: false,
  enableAdvancedTools: false,
  acceptEvidencedDone: false,
  askLevel: 'balanced',
};


const storage = createStorage<GeneralSettingsConfig>('general-settings', DEFAULT_GENERAL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const generalSettingsStore: GeneralSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<GeneralSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_GENERAL_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      ...settings,
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_GENERAL_SETTINGS);
  },
};

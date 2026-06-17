import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for advanced settings configuration
export interface AdvancedSettingsConfig {
  // Developer Options
  enableDeveloperOptions: boolean;
  logDOMSnapshot: boolean;            // log the full DOM the LLM sees each step
}

export type AdvancedSettingsStorage = BaseStorage<AdvancedSettingsConfig> & {
  updateSettings: (settings: Partial<AdvancedSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<AdvancedSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default settings
export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettingsConfig = {
  enableDeveloperOptions: false,
  logDOMSnapshot: false,
};

const storage = createStorage<AdvancedSettingsConfig>('advanced-settings', DEFAULT_ADVANCED_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const advancedSettingsStore: AdvancedSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<AdvancedSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_ADVANCED_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_ADVANCED_SETTINGS,
      ...settings,
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_ADVANCED_SETTINGS);
  },
};

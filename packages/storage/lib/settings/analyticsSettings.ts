import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for analytics settings configuration
export interface AnalyticsSettingsConfig {
  enabled: boolean;
  anonymousUserId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export type AnalyticsSettingsStorage = BaseStorage<AnalyticsSettingsConfig> & {
  updateSettings: (settings: Partial<AnalyticsSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<AnalyticsSettingsConfig>;
  resetToDefaults: () => Promise<void>;
  generateAnonymousUserId: () => string;
  incrementTokens: (input: number, output: number) => Promise<void>;
};

// Generate a random anonymous user ID
function generateAnonymousUserId(): string {
  return 'anon_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Off until the user turns it on. Nothing about where the user browses leaves the machine before they have
// seen a settings screen and chosen it.
export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettingsConfig = {
  enabled: false,
  anonymousUserId: '',
  totalInputTokens: 0,
  totalOutputTokens: 0,
};

const storage = createStorage<AnalyticsSettingsConfig>('analytics-settings', DEFAULT_ANALYTICS_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const analyticsSettingsStore: AnalyticsSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<AnalyticsSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_ANALYTICS_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    const merged = { ...DEFAULT_ANALYTICS_SETTINGS, ...settings };

    // The identifier is minted only once the user has turned analytics on. Reading the settings used to mint and
    // persist one, so a stable id existed for every install that had never opened a settings screen.
    if (merged.enabled && !merged.anonymousUserId) {
      const withId = { ...merged, anonymousUserId: generateAnonymousUserId() };
      await storage.set(withId);
      return withId;
    }

    return merged;
  },
  async resetToDefaults() {
    // Keep the same user ID when resetting to defaults
    const currentSettings = await storage.get();
    const resetSettings = {
      ...DEFAULT_ANALYTICS_SETTINGS,
      anonymousUserId: currentSettings?.anonymousUserId || generateAnonymousUserId(),
    };
    await storage.set(resetSettings);
  },
  generateAnonymousUserId,
  async incrementTokens(input: number, output: number) {
    const current = (await storage.get()) || DEFAULT_ANALYTICS_SETTINGS;
    await storage.set({
      ...current,
      totalInputTokens: (current.totalInputTokens || 0) + input,
      totalOutputTokens: (current.totalOutputTokens || 0) + output,
    });
  },
};

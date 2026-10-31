import { useState, useEffect } from 'react';
import { 
  type GeneralSettingsConfig, 
  generalSettingsStore, 
  DEFAULT_GENERAL_SETTINGS 
} from '@extension/storage';
import { t } from '@extension/i18n';
import { FiLayers } from 'react-icons/fi';
import { DashboardSection } from './shared/DashboardSection';
import { SettingToggle } from './GeneralSettingsComponents';

interface AdvancedSettingsProps {
  isDarkMode?: boolean;
}

/**
 * What the browser-data tools need beyond the install-time set. They are declared optional in the manifest, so the
 * browser asks for them when the user turns the tools on instead of at install — a browsing agent does not need a
 * new user's bookmarks, history and open sessions to start, and asking for them up front was unrelated functionality
 * bundled into one consent.
 */
const BROWSER_DATA_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: [
    'bookmarks',
    'readingList',
    'history',
    'downloads',
    'browsingData',
    'sessions',
    'management',
    'system.cpu',
    'system.memory',
  ] as chrome.runtime.ManifestPermissions[],
};

export const AdvancedSettings = ({ isDarkMode = false }: AdvancedSettingsProps) => {
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    (async () => {
      const settings = await generalSettingsStore.getSettings();
      // A setting that says the tools are on while the browser says they are not granted — the user revoked access
      // from the extensions page — is off. Left alone, every browser-data tool would throw on an undefined API.
      if (settings.enableBrowserDataTools && !(await chrome.permissions.contains(BROWSER_DATA_PERMISSIONS))) {
        await generalSettingsStore.updateSettings({ enableBrowserDataTools: false });
        setGeneralSettings({ ...settings, enableBrowserDataTools: false });
        return;
      }
      setGeneralSettings(settings);
    })();
  }, []);

  /**
   * Turn the browser-data tools on or off, asking the browser for the access they need.
   *
   * `permissions.request` is only allowed while handling a user gesture, so it must be the first thing this does:
   * nothing may be awaited before it. A refusal leaves the tools off. Turning them off hands the access back.
   */
  const toggleBrowserDataTools = async (enable: boolean) => {
    if (enable) {
      const granted = await chrome.permissions.request(BROWSER_DATA_PERMISSIONS);
      if (!granted) return;
    } else {
      await chrome.permissions.remove(BROWSER_DATA_PERMISSIONS).catch(() => false);
    }
    await updateGeneralSetting('enableBrowserDataTools', enable);
  };

  const updateGeneralSetting = async <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => {
    setGeneralSettings(prev => ({ ...prev, [key]: value }));
    await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);
    const confirmed = await generalSettingsStore.getSettings();
    setGeneralSettings(confirmed);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 mx-auto flex max-w-2xl flex-col gap-6 pb-10 duration-700">
      
      {/* BROWSER INTERFACE MODULE */}
      <DashboardSection
        title="Browser Interface"
        subtitle="UI overlays and tab management"
        icon={<FiLayers size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="teal"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingToggle
          title="Vision for Planner Agent"
          desc="Allow the high-level Planner agent to process raw browser screenshots"
          checked={generalSettings.useVisionForPlanner}
          isDarkMode={isDarkMode}
          onChange={val => updateGeneralSetting('useVisionForPlanner', val)}
        />
        <SettingToggle
          title="Interaction Highlights"
          desc="Visualize active focus areas during execution"
          checked={generalSettings.displayHighlights}
          isDarkMode={isDarkMode}
          onChange={val => updateGeneralSetting('displayHighlights', val)}
        />
        <SettingToggle
          title="Task Tab Grouping"
          desc="Group AI-opened tabs by task using Chrome tab groups. Each task gets a color-coded group."
          checked={generalSettings.enableTabGrouping}
          isDarkMode={isDarkMode}
          onChange={val => updateGeneralSetting('enableTabGrouping', val)}
        />
        <SettingToggle
          title="Auto-Close Ephemeral Tabs"
          desc="Automatically close temporary AI tabs when a task completes to keep the browser clean."
          checked={generalSettings.autoCloseEphemeralTabs}
          isDarkMode={isDarkMode}
          onChange={val => updateGeneralSetting('autoCloseEphemeralTabs', val)}
        />
        <SettingToggle
          title={t('options_advanced_browserDataTools')}
          desc={t('options_advanced_browserDataTools_desc')}
          checked={generalSettings.enableBrowserDataTools}
          isDarkMode={isDarkMode}
          onChange={val => void toggleBrowserDataTools(val)}
        />
        <SettingToggle
          title={t('options_advanced_advancedTools')}
          desc={t('options_advanced_advancedTools_desc')}
          checked={generalSettings.enableAdvancedTools}
          isDarkMode={isDarkMode}
          onChange={val => updateGeneralSetting('enableAdvancedTools', val)}
        />
        <SettingToggle
          title="Show Ambient Border"
          desc="Render the glowing screen-edge border when the agent is actively executing"
          checked={generalSettings.showAmbientBorder}
          isDarkMode={isDarkMode}
          onChange={val => updateGeneralSetting('showAmbientBorder', val)}
        />
        <SettingToggle
          title="Show Status Capsule"
          desc="Render the floating execution state indicator on the current web page"
          checked={generalSettings.showStatusCapsule}
          isDarkMode={isDarkMode}
          onChange={val => updateGeneralSetting('showStatusCapsule', val)}
        />
      </DashboardSection>
    </div>
  );
};

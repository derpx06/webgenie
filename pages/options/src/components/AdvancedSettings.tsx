import { useState, useEffect } from 'react';
import { 
  type GeneralSettingsConfig, 
  generalSettingsStore, 
  DEFAULT_GENERAL_SETTINGS 
} from '@extension/storage';
import { FiLayers } from 'react-icons/fi';
import { DashboardSection } from './shared/DashboardSection';
import { SettingToggle } from './GeneralSettingsComponents';

interface AdvancedSettingsProps {
  isDarkMode?: boolean;
}

export const AdvancedSettings = ({ isDarkMode = false }: AdvancedSettingsProps) => {
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    generalSettingsStore.getSettings().then(setGeneralSettings);
  }, []);

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
    <div className="animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-6 max-w-2xl mx-auto pb-10 duration-700">
      
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

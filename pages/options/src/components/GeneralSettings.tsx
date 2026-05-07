/* eslint-disable jsx-a11y/label-has-associated-control */
import { useState, useEffect } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { t } from '@extension/i18n';
import { FiSettings, FiShield, FiActivity, FiZap } from 'react-icons/fi';

interface GeneralSettingsProps {
  isDarkMode?: boolean;
}

import { DashboardSection } from './shared/DashboardSection';
import { SettingToggle, SettingInput } from './GeneralSettingsComponents';

export const GeneralSettings = ({ isDarkMode = false }: GeneralSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    generalSettingsStore.getSettings().then(setSettings);
  }, []);

  const updateSetting = async <K extends keyof GeneralSettingsConfig>(key: K, value: GeneralSettingsConfig[K]) => {
    setSettings(prevSettings => ({ ...prevSettings, [key]: value }));
    await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);
    const latestSettings = await generalSettingsStore.getSettings();
    setSettings(latestSettings);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* 1. SYSTEM RUNTIME MODULE */}
      <DashboardSection
        title="Runtime"
        subtitle="Safety and execution thresholds"
        icon={<FiZap size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingInput title="Maximum Mission Steps" desc="Safety limit for sequential reasoning" value={settings.maxSteps} isDarkMode={isDarkMode} onChange={val => updateSetting('maxSteps', val)} min={1} max={50} />
        <SettingInput title="Actions Per Step" desc="Maximum sub-tasks per mission step" value={settings.maxActionsPerStep} isDarkMode={isDarkMode} onChange={val => updateSetting('maxActionsPerStep', val)} min={1} max={50} />
        <SettingInput title="Retry Limit" desc="Maximum failure tolerance for complex operations" value={settings.maxFailures} isDarkMode={isDarkMode} onChange={val => updateSetting('maxFailures', val)} min={1} max={10} />
        <SettingInput title="Planning Interval" desc="Model refresh rate in seconds" value={settings.planningInterval} isDarkMode={isDarkMode} onChange={val => updateSetting('planningInterval', val)} min={1} max={20} />
        <SettingInput title="Page Load Buffer" desc="Network latency compensation in milliseconds" value={settings.minWaitPageLoad} isDarkMode={isDarkMode} onChange={val => updateSetting('minWaitPageLoad', val)} min={250} max={5000} step={50} />
      </DashboardSection>

      {/* 2. COGNITIVE FEEDBACK MODULE */}
      <DashboardSection
        title="Telemetry"
        subtitle="System monitoring and analysis"
        icon={<FiActivity size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingToggle title="Visual Analysis" desc="Enable multi-modal environment analysis" checked={settings.useVision} isDarkMode={isDarkMode} onChange={val => updateSetting('useVision', val)} />
        <SettingToggle title="Interaction Highlights" desc="Visualize active focus areas during execution" checked={settings.displayHighlights} isDarkMode={isDarkMode} onChange={val => updateSetting('displayHighlights', val)} />
        <SettingToggle title="Session Replay" desc="Store and replay historical task logs" checked={settings.replayHistoricalTasks} isDarkMode={isDarkMode} onChange={val => updateSetting('replayHistoricalTasks', val)} />
      </DashboardSection>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}} />
    </div>
  );
};

/* eslint-disable jsx-a11y/label-has-associated-control */
import { useState, useEffect } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { FiActivity, FiZap } from 'react-icons/fi';
import { DashboardSection } from './shared/DashboardSection';
import { SettingToggle, SettingStepperInput, SettingInlineUnitInput } from './GeneralSettingsComponents';

interface GeneralSettingsProps {
  isDarkMode?: boolean;
}

export const GeneralSettings = ({ isDarkMode = false }: GeneralSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    generalSettingsStore.getSettings().then(setSettings);
  }, []);

  const updateSetting = async <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => {
    // Optimistic UI update — instant visual feedback
    setSettings(prev => ({ ...prev, [key]: value }));
    // Persist to storage
    await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);
    // Re-read to confirm persistence (handles edge cases like storage quota issues)
    const confirmed = await generalSettingsStore.getSettings();
    setSettings(confirmed);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-6 max-w-2xl mx-auto pb-10 duration-700">

      {/* 1. SAFETY & LIMITS MODULE */}
      <DashboardSection
        title="Safety & Limits"
        subtitle="Mission bounds and threshold constraints"
        icon={<FiZap size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingInlineUnitInput title="Maximum Mission Steps" desc="Safety limit for sequential reasoning" value={settings.maxSteps} unit="steps" isDarkMode={isDarkMode} onChange={val => updateSetting('maxSteps', val)} min={1} max={50} />
        <SettingStepperInput title="Actions Per Step" desc="Maximum sub-tasks per mission step" value={settings.maxActionsPerStep} isDarkMode={isDarkMode} onChange={val => updateSetting('maxActionsPerStep', val)} min={1} max={50} />
        <SettingStepperInput title="Retry Limit" desc="Maximum failure tolerance for complex operations" value={settings.maxFailures} isDarkMode={isDarkMode} onChange={val => updateSetting('maxFailures', val)} min={1} max={10} />
      </DashboardSection>

      {/* 2. EXECUTION TUNING MODULE */}
      <DashboardSection
        title="Execution Tuning"
        subtitle="Network latency and capability options"
        icon={<FiActivity size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingInlineUnitInput title="Planning Interval" desc="Model refresh rate in seconds" value={settings.planningInterval} unit="s" isDarkMode={isDarkMode} onChange={val => updateSetting('planningInterval', val)} min={1} max={20} />
        <SettingInlineUnitInput title="Page Load Buffer" desc="Network latency compensation in milliseconds" value={settings.minWaitPageLoad} unit="ms" isDarkMode={isDarkMode} onChange={val => updateSetting('minWaitPageLoad', val)} min={250} max={5000} step={50} />
        <SettingToggle title="Visual Analysis" desc="Enable multi-modal environment analysis (Vision)" checked={settings.useVision} isDarkMode={isDarkMode} onChange={val => updateSetting('useVision', val)} />
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

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

interface GeneralSettingsProps {
  isDarkMode?: boolean;
}

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
        subtitle="Safety Thresholds"
        icon={<FiZap size={18} />}
        isDarkMode={isDarkMode}
        colorTheme="amber"
        headerClassName="py-4 px-6"
        contentClassName="flex flex-col"
      >
        <SettingInput title={t('options_general_maxSteps')} desc="Safety limit for sequential reasoning" value={settings.maxSteps} isDarkMode={isDarkMode} onChange={val => updateSetting('maxSteps', val)} min={1} max={50} />
        <SettingInput title={t('options_general_maxActions')} desc="Maximum sub-tasks per mission step" value={settings.maxActionsPerStep} isDarkMode={isDarkMode} onChange={val => updateSetting('maxActionsPerStep', val)} min={1} max={50} />
        <SettingInput title={t('options_general_maxFailures')} desc="Retry ceiling for complex operations" value={settings.maxFailures} isDarkMode={isDarkMode} onChange={val => updateSetting('maxFailures', val)} min={1} max={10} />
        <SettingInput title={t('options_general_planningInterval')} desc="Cognitive refresh rate (seconds)" value={settings.planningInterval} isDarkMode={isDarkMode} onChange={val => updateSetting('planningInterval', val)} min={1} max={20} />
        <SettingInput title={t('options_general_minWaitPageLoad')} desc="Network latency buffer (ms)" value={settings.minWaitPageLoad} isDarkMode={isDarkMode} onChange={val => updateSetting('minWaitPageLoad', val)} min={250} max={5000} step={50} />
      </DashboardSection>

      {/* 2. COGNITIVE FEEDBACK MODULE */}
      <DashboardSection
        title="Telemetry"
        subtitle="Bio-Feedback Loops"
        icon={<FiActivity size={18} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-4 px-6"
        contentClassName="flex flex-col"
      >
        <SettingToggle title="Neural Vision" desc="Enable multi-modal environment analysis" checked={settings.useVision} isDarkMode={isDarkMode} onChange={val => updateSetting('useVision', val)} />
        <SettingToggle title="Display Highlights" desc="Visualize active cognitive focus areas" checked={settings.displayHighlights} isDarkMode={isDarkMode} onChange={val => updateSetting('displayHighlights', val)} />
        <SettingToggle title="Mission Replay" desc="Store and replay historical task logs" checked={settings.replayHistoricalTasks} isDarkMode={isDarkMode} onChange={val => updateSetting('replayHistoricalTasks', val)} />

        {/* Ambient Neural Grid (Visual Only) */}
        <div className="mt-auto p-6 opacity-[0.03]">
           <div className={`h-20 w-full rounded-xl border border-dashed flex items-center justify-center ${isDarkMode ? 'border-indigo-500' : 'border-indigo-400'}`}>
              <span className="text-[10px] font-black uppercase tracking-[0.5em]">Neural Mesh Overlay</span>
           </div>
        </div>
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

import { useState, useEffect } from 'react';
import { 
  type AdvancedSettingsConfig, 
  advancedSettingsStore, 
  DEFAULT_ADVANCED_SETTINGS, 
  type GeneralSettingsConfig, 
  generalSettingsStore, 
  DEFAULT_GENERAL_SETTINGS 
} from '@extension/storage';
import { FiTerminal, FiActivity } from 'react-icons/fi';
import { DashboardSection } from './shared/DashboardSection';
import { SettingToggle, SettingTextInput } from './GeneralSettingsComponents';

interface DeveloperSettingsProps {
  isDarkMode?: boolean;
}

export const DeveloperSettings = ({ isDarkMode = false }: DeveloperSettingsProps) => {
  const [settings, setSettings] = useState<AdvancedSettingsConfig>(DEFAULT_ADVANCED_SETTINGS);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    advancedSettingsStore.getSettings().then(setSettings);
    generalSettingsStore.getSettings().then(setGeneralSettings);
  }, []);

  const updateSetting = async <K extends keyof AdvancedSettingsConfig>(
    key: K,
    value: AdvancedSettingsConfig[K],
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    await advancedSettingsStore.updateSettings({ [key]: value } as Partial<AdvancedSettingsConfig>);
    const confirmed = await advancedSettingsStore.getSettings();
    setSettings(confirmed);
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
    <div className="animate-in fade-in slide-in-from-bottom-4 grid grid-cols-1 gap-8 duration-700 lg:grid-cols-2">
      
      {/* 1. DEVELOPER DIAGNOSTICS */}
      <DashboardSection
        title="Developer Diagnostics"
        subtitle="Low-level telemetry and console overrides"
        icon={<FiTerminal size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingToggle
          title="Enable Developer Options"
          desc="Master toggle to unlock aggressive logging and security bypasses"
          checked={settings.enableDeveloperOptions}
          isDarkMode={isDarkMode}
          onChange={val => updateSetting('enableDeveloperOptions', val)}
        />
        {settings.enableDeveloperOptions && (
          <div className="animate-in fade-in slide-in-from-top-2 flex flex-col duration-300">
            <SettingToggle
              title="Log DOM Snapshot (What LLM Sees)"
              desc="Log the complete serialized DOM — all indexed interactive elements — that the LLM receives each step. Inspect in the background service worker console."
              checked={settings.logDOMSnapshot}
              isDarkMode={isDarkMode}
              onChange={val => updateSetting('logDOMSnapshot', val)}
              severity="caution"
            />
            <SettingToggle 
              title="Session Replay" 
              desc="Store and replay historical task logs for post-mortem debugging" 
              checked={generalSettings.replayHistoricalTasks} 
              isDarkMode={isDarkMode} 
              onChange={val => updateGeneralSetting('replayHistoricalTasks', val)} 
              severity="caution"
            />
          </div>
        )}
      </DashboardSection>

      {/* 2. LANGSMITH OBSERVABILITY */}
      <DashboardSection
        title="Langsmith Tracing"
        subtitle="LLM observability and execution profiling"
        icon={<FiActivity size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="rose"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingToggle
          title="Enable Langsmith Tracing"
          desc="Stream LLM prompts, generations, and token metrics to Langsmith"
          checked={generalSettings.enableTracing}
          isDarkMode={isDarkMode}
          onChange={val => updateGeneralSetting('enableTracing', val)}
        />
        {generalSettings.enableTracing && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-300">
            <SettingTextInput
              title="Langsmith API Key"
              desc="Your authentication token for the Langsmith platform"
              value={generalSettings.langsmithApiKey}
              placeholder="ls__..."
              isSecret={true}
              isDarkMode={isDarkMode}
              onChange={val => updateGeneralSetting('langsmithApiKey', val)}
            />
            <SettingTextInput
              title="Langsmith Project"
              desc="The project name to group these traces under"
              value={generalSettings.langsmithProject}
              placeholder="default"
              isDarkMode={isDarkMode}
              onChange={val => updateGeneralSetting('langsmithProject', val)}
            />
          </div>
        )}
      </DashboardSection>

    </div>
  );
};

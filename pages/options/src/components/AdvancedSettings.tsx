import { useState, useEffect } from 'react';
import { 
  type AdvancedSettingsConfig, 
  advancedSettingsStore, 
  DEFAULT_ADVANCED_SETTINGS, 
  type GeneralSettingsConfig, 
  generalSettingsStore, 
  DEFAULT_GENERAL_SETTINGS 
} from '@extension/storage';
import { FiMonitor, FiLayers, FiSliders } from 'react-icons/fi';
import { DashboardSection } from './shared/DashboardSection';
import { SettingToggle, SettingInput } from './GeneralSettingsComponents';

interface AdvancedSettingsProps {
  isDarkMode?: boolean;
}

interface SelectProps {
  title: string;
  desc: string;
  value: string;
  options: { value: string; label: string }[];
  isDarkMode: boolean;
  onChange: (val: any) => void;
}

const SettingSelect: React.FC<SelectProps> = ({ title, desc, value, options, isDarkMode, onChange }) => (
  <label className={`group relative flex cursor-pointer items-center justify-between gap-6 border-b px-8 py-6 transition-all duration-300 last:border-0 ${
    isDarkMode ? 'border-white/5 hover:bg-white/[0.02]' : 'border-slate-100 hover:bg-slate-50'
  }`}>
    <div className="flex-1">
      <h3 className={`font-outfit text-[14px] font-black uppercase tracking-wider ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
        {title}
      </h3>
      <p className={`mt-1 text-[12px] font-medium leading-relaxed opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
        {desc}
      </p>
    </div>
    <div className="flex items-center gap-3">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`font-outfit w-48 cursor-pointer rounded-xl border px-3 py-2 text-center text-[13px] font-bold transition-all duration-300 focus:outline-none
          ${isDarkMode ? 'border-white/10 bg-[#161821] text-white focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20'
            : 'border-slate-200 bg-white text-slate-900 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10'}`}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  </label>
);

export const AdvancedSettings = ({ isDarkMode = false }: AdvancedSettingsProps) => {
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
      
      {/* 1. LOW-LEVEL PROTOCOL LIMITS MODULE */}
      <DashboardSection
        title="Low-Level Protocol Limits"
        subtitle="Hardware latencies and socket configurations"
        icon={<FiSliders size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingInput
          title="CDP Command Timeout"
          desc="Timeout limit (milliseconds) for native DevTools Protocol socket operations"
          value={settings.cdpCommandTimeout}
          isDarkMode={isDarkMode}
          onChange={val => updateSetting('cdpCommandTimeout', val)}
          min={1000}
          max={120000}
          step={500}
        />
        <SettingInput
          title="Action Latency Buffer"
          desc="Artificial hardware response latency (milliseconds) injected to bypass anti-bot heuristics"
          value={settings.hardwareActionLatency}
          isDarkMode={isDarkMode}
          onChange={val => updateSetting('hardwareActionLatency', val)}
          min={0}
          max={1000}
          step={10}
        />
        <SettingInput
          title="Concurrent Mission Cap"
          desc="Limit of concurrently running autonomous browser worker processes on this system node"
          value={settings.concurrentTaskCap}
          isDarkMode={isDarkMode}
          onChange={val => updateSetting('concurrentTaskCap', val)}
          min={1}
          max={10}
        />
        <SettingSelect
          title="Input Emulation Mode"
          desc="Mechanism to synthesize cursor movements, typing events, and hardware clicks"
          value={settings.inputEmulationMode}
          options={[
            { value: 'cdp', label: 'CDP Input API' },
            { value: 'dom', label: 'Standard Dom Events' },
            { value: 'hybrid', label: 'Hybrid Smart Mode' }
          ]}
          isDarkMode={isDarkMode}
          onChange={val => updateSetting('inputEmulationMode', val)}
        />
      </DashboardSection>

      {/* 2. EXPERIMENTAL CAPABILITIES MODULE */}
      <DashboardSection
        title="Experimental AI Capabilities"
        subtitle="Beta multi-modal and reasoning features"
        icon={<FiMonitor size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="slate"
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
      </DashboardSection>

      {/* 3. BROWSER INTERFACE MODULE */}
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

import { useState, useEffect } from 'react';
import { type AdvancedSettingsConfig, advancedSettingsStore, DEFAULT_ADVANCED_SETTINGS } from '@extension/storage';
import { FiSliders, FiTerminal } from 'react-icons/fi';
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
  <div className={`group relative flex items-center justify-between gap-6 border-b px-8 py-6 transition-all duration-300 last:border-0 ${
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
        className={`w-48 rounded-xl border px-3 py-2 text-center font-outfit text-[13px] font-bold transition-all duration-300 focus:outline-none cursor-pointer
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
  </div>
);

export const AdvancedSettings = ({ isDarkMode = false }: AdvancedSettingsProps) => {
  const [settings, setSettings] = useState<AdvancedSettingsConfig>(DEFAULT_ADVANCED_SETTINGS);

  useEffect(() => {
    advancedSettingsStore.getSettings().then(setSettings);
  }, []);

  const updateSetting = async <K extends keyof AdvancedSettingsConfig>(
    key: K,
    value: AdvancedSettingsConfig[K],
  ) => {
    // Optimistic UI update
    setSettings(prev => ({ ...prev, [key]: value }));
    // Persist to storage
    await advancedSettingsStore.updateSettings({ [key]: value } as Partial<AdvancedSettingsConfig>);
    // Confirm write
    const confirmed = await advancedSettingsStore.getSettings();
    setSettings(confirmed);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 grid grid-cols-1 gap-8 duration-700 lg:grid-cols-2">
      
      {/* 1. DEVELOPER OPTIONS MODULE */}
      <DashboardSection
        title="Developer Options"
        subtitle="Internal diagnostics, sandbox controls, and trace overrides"
        icon={<FiTerminal size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="teal"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingToggle
          title="Enable Developer Options"
          desc="Unlock advanced debugging, diagnostics, and protocol overrides"
          checked={settings.enableDeveloperOptions}
          isDarkMode={isDarkMode}
          onChange={val => updateSetting('enableDeveloperOptions', val)}
        />
        
        {settings.enableDeveloperOptions && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-300">
            <SettingToggle
              title="Verbose CDP Event Logs"
              desc="Enable detailed Chrome DevTools Protocol logging in the system background console"
              checked={settings.enableVerboseCDPDebug}
              isDarkMode={isDarkMode}
              onChange={val => updateSetting('enableVerboseCDPDebug', val)}
            />
            <SettingToggle
              title="Bypass Security Sandbox"
              desc="Disable URL filters, navigation checks, and safety rules during task execution (Warning: Use only in local dev)"
              checked={settings.bypassSecuritySandbox}
              isDarkMode={isDarkMode}
              onChange={val => updateSetting('bypassSecuritySandbox', val)}
            />
            <SettingToggle
              title="Trace DOM Mutation Cycles"
              desc="Actively output MutationObserver cycles and structural updates to the developer logs"
              checked={settings.traceDOMMutationCycles}
              isDarkMode={isDarkMode}
              onChange={val => updateSetting('traceDOMMutationCycles', val)}
            />
            <SettingToggle
              title="Log LLM Context Frames"
              desc="Log the complete frame system context and raw payload files before launching any agent reasoning step"
              checked={settings.logLLMContextBeforeSteps}
              isDarkMode={isDarkMode}
              onChange={val => updateSetting('logLLMContextBeforeSteps', val)}
            />
          </div>
        )}
      </DashboardSection>

      {/* 2. ADVANCED CONFIGURATION MODULE */}
      <DashboardSection
        title="Advanced Configuration"
        subtitle="Low-level protocol thresholds and input configurations"
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
    </div>
  );
};

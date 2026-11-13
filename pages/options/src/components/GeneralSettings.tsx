/* eslint-disable jsx-a11y/label-has-associated-control */
import { useState, useEffect } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { t } from '@extension/i18n';
import { FiActivity, FiMessageCircle, FiTrash2, FiZap } from 'react-icons/fi';
import { DashboardSection } from './shared/DashboardSection';
import { SettingToggle, SettingStepperInput, SettingInlineUnitInput, SettingChoice } from './GeneralSettingsComponents';

interface GeneralSettingsProps {
  isDarkMode?: boolean;
}

export const GeneralSettings = ({ isDarkMode = false }: GeneralSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);
  const [memoryStatus, setMemoryStatus] = useState('');

  /** The background clears every cross-task memory store, so nothing is left for the next task to read. */
  const forgetSiteMemory = async () => {
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'forget_site_memory' });
      setMemoryStatus(reply?.ok ? t('options_memory_forgotten') : t('options_memory_forgetFailed', [String(reply?.error ?? 'unknown')]));
    } catch (error) {
      setMemoryStatus(t('options_memory_forgetFailed', [error instanceof Error ? error.message : String(error)]));
    }
  };

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
    <div className="animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-6 pb-10 duration-700">

      {/* 0. HOW OFTEN IT ASKS */}
      <DashboardSection
        title="Asking"
        subtitle="How much it decides for you"
        icon={<FiMessageCircle size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingChoice
          title="When several choices fit"
          desc="Orders, payments, new accounts and card details are always left to you, whatever you pick here. So are CAPTCHAs, logins and anything only you know."
          value={settings.askLevel ?? 'balanced'}
          isDarkMode={isDarkMode}
          onChange={val => updateSetting('askLevel', val)}
          options={[
            { value: 'more', label: 'Ask me more', hint: 'It asks whenever two options differ in price, size or the like.' },
            { value: 'balanced', label: 'Balanced', hint: 'It decides what you can undo in a moment (a cart, a filter, a sort), tells you what it chose, and asks about the rest.' },
            { value: 'less', label: 'Ask me less', hint: 'It chooses the closest match itself and tells you what it chose, rather than asking about options.' },
          ]}
        />
      </DashboardSection>

      {/* 1. SAFETY & LIMITS MODULE */}
      <DashboardSection
        title="Safety & Limits"
        subtitle="Limits for a single task"
        icon={<FiZap size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingInlineUnitInput title="Maximum steps per task" desc="Stops a task that has not finished by then" value={settings.maxSteps} unit="steps" isDarkMode={isDarkMode} onChange={val => updateSetting('maxSteps', val)} min={1} max={100} />
        <SettingStepperInput title="Actions Per Step" desc="Most actions it may take in one step" value={settings.maxActionsPerStep} isDarkMode={isDarkMode} onChange={val => updateSetting('maxActionsPerStep', val)} min={1} max={50} />
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
        <SettingInlineUnitInput title="Action Settle Timeout" desc="Maximum time to wait for dynamic page updates after an action" value={settings.actionSettleTimeoutMs} unit="ms" isDarkMode={isDarkMode} onChange={val => updateSetting('actionSettleTimeoutMs', val)} min={500} max={5000} step={100} />
        <SettingInlineUnitInput title="Action Delay" desc="Small pause between sequential browser actions" value={settings.actionDelayMs} unit="ms" isDarkMode={isDarkMode} onChange={val => updateSetting('actionDelayMs', val)} min={0} max={1000} step={25} />
        <SettingInlineUnitInput title="Page Load Buffer" desc="Network latency compensation in milliseconds" value={settings.minWaitPageLoad} unit="ms" isDarkMode={isDarkMode} onChange={val => updateSetting('minWaitPageLoad', val)} min={250} max={5000} step={50} />
        <SettingToggle title="Visual Analysis" desc="Let the agent look at a screenshot when the page text is not enough (charts, colours, layout) or it is stuck; only for models that read images" checked={settings.useVision} isDarkMode={isDarkMode} onChange={val => updateSetting('useVision', val)} />
      </DashboardSection>

      {/* 3. SITE MEMORY MODULE */}
      <DashboardSection
        title={t('options_memory_title')}
        subtitle={t('options_memory_subtitle')}
        icon={<FiTrash2 size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <div className={`flex flex-wrap items-center justify-between gap-6 px-8 py-6 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
          <p className="max-w-lg font-sans text-[13px] leading-relaxed">{memoryStatus || t('options_memory_desc')}</p>
          <button
            type="button"
            onClick={forgetSiteMemory}
            className={`rounded-xl px-4 py-2 text-[11px] font-medium uppercase tracking-wide transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7C3AED] ${isDarkMode ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}`}
          >
            {t('options_memory_forget')}
          </button>
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

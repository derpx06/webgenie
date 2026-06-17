/* eslint-disable jsx-a11y/label-has-associated-control */
import { useState, useEffect, useCallback } from 'react';
import { firewallStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { FiShield, FiPlus, FiTrash2, FiSlash, FiTarget, FiChevronRight } from 'react-icons/fi';

interface FirewallSettingsProps {
  isDarkMode: boolean;
}

import { DashboardSection } from './shared/DashboardSection';

export const FirewallSettings = ({ isDarkMode }: FirewallSettingsProps) => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [allowList, setAllowList] = useState<string[]>([]);
  const [denyList, setDenyList] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newUrlType, setNewUrlType] = useState<'allow' | 'deny'>('allow');

  const loadFirewallSettings = useCallback(async () => {
    const settings = await firewallStore.getFirewall();
    setIsEnabled(settings.enabled);
    setAllowList(settings.allowList);
    setDenyList(settings.denyList);
  }, []);

  useEffect(() => {
    loadFirewallSettings();
  }, [loadFirewallSettings]);

  const handleToggleFirewall = async () => {
    await firewallStore.updateFirewall({ enabled: !isEnabled });
    await loadFirewallSettings();
  };

  const handleAddUrl = async () => {
    const cleanUrl = newUrl.trim().replace(/^https?:\/\//, '');
    if (!cleanUrl) return;
    if (newUrlType === 'allow') {
      await firewallStore.addToAllowList(cleanUrl);
    } else {
      await firewallStore.addToDenyList(cleanUrl);
    }
    await loadFirewallSettings();
    setNewUrl('');
  };

  const handleRemoveUrl = async (url: string, listType: 'allow' | 'deny') => {
    if (listType === 'allow') {
      await firewallStore.removeFromAllowList(url);
    } else {
      await firewallStore.removeFromDenyList(url);
    }
    await loadFirewallSettings();
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 mx-auto flex max-w-2xl flex-col gap-6 pb-10 duration-700">
      
      {/* Top Master Toggle Card */}
      <div className={`flex items-center justify-between rounded-2xl border p-6 transition-all duration-300 ${isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-slate-200 bg-white'}`}>
        <div>
          <h3 className={`font-outfit text-base font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            Firewall Protection
          </h3>
          <p className="mt-1 text-xs text-slate-400 opacity-80">
            Toggle domain access filtering on or off
          </p>
        </div>
        <label className="group relative inline-flex shrink-0 cursor-pointer items-center">
          <input type="checkbox" className="peer sr-only" checked={isEnabled} onChange={handleToggleFirewall} />
          <div className={`peer h-6 w-11 rounded-full border transition-all duration-300 after:absolute 
            after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-focus:outline-none
            ${isDarkMode ? 'border-white/10 bg-white/5 after:bg-[#818cf8] peer-checked:bg-indigo-500' : 'border-slate-200 bg-slate-200 after:bg-white peer-checked:bg-indigo-600'} 
            peer-checked:after:border-white peer-checked:after:bg-white`}>
          </div>
        </label>
      </div>

      {/* 1. SYSTEM RUNTIME MODULE */}
      <DashboardSection
        title="Domain Filtering"
        subtitle="Control which websites the agent can access"
        icon={<FiShield size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="slate"
        headerClassName="justify-between py-4 px-6"
      >
        <div className="p-6">
          {/* Active Rules List */}
          <div className="mb-6 min-h-[60px] space-y-2">
            {allowList.map(url => (
              <div key={`allow-${url}`} className={`group/item flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-200 ${isDarkMode ? 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]' : 'border-slate-100 bg-slate-50/50 hover:bg-white hover:shadow-sm'}`}>
                <div className="flex items-center gap-3">
                  <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? 'bg-teal-500/10 text-teal-400' : 'bg-teal-50 text-teal-700'}`}>Allow</span>
                  <span className={`font-mono text-[13px] font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{url}</span>
                </div>
                <button onClick={() => handleRemoveUrl(url, 'allow')} className={`rounded-lg p-2 opacity-0 transition-all duration-200 group-hover/item:opacity-100 ${isDarkMode ? 'text-slate-500 hover:bg-rose-500/10 hover:text-rose-400' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'}`}>
                  <FiTrash2 size={14} />
                </button>
              </div>
            ))}

            {denyList.map(url => (
              <div key={`deny-${url}`} className={`group/item flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-200 ${isDarkMode ? 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]' : 'border-slate-100 bg-slate-50/50 hover:bg-white hover:shadow-sm'}`}>
                <div className="flex items-center gap-3">
                  <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${isDarkMode ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-700'}`}>Block</span>
                  <span className={`font-mono text-[13px] font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{url}</span>
                </div>
                <button onClick={() => handleRemoveUrl(url, 'deny')} className={`rounded-lg p-2 opacity-0 transition-all duration-200 group-hover/item:opacity-100 ${isDarkMode ? 'text-slate-500 hover:bg-rose-500/10 hover:text-rose-400' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'}`}>
                  <FiTrash2 size={14} />
                </button>
              </div>
            ))}

            {allowList.length === 0 && denyList.length === 0 && (
              <div className={`rounded-xl border border-dashed py-8 text-center ${isDarkMode ? 'border-white/5 bg-black/10' : 'border-slate-200 bg-slate-50/30'}`}>
                <div className="flex flex-col items-center">
                  <FiSlash size={24} className={`mb-3 ${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`} />
                  <span className={`text-[11px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>No filtering rules configured</span>
                </div>
              </div>
            )}
          </div>

          {/* Add Rule Interface */}
          <div className={`flex flex-col items-stretch gap-3 rounded-xl border p-3 transition-all duration-300 sm:flex-row sm:items-center ${isDarkMode ? 'border-white/5 bg-black/20 focus-within:border-indigo-500/30' : 'border-slate-200 bg-slate-50'}`}>
            <div className="relative flex-1">
              <FiTarget className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 opacity-40" />
              <input
                type="text"
                className={`w-full rounded-lg border-0 py-2.5 pl-10 pr-4 focus:ring-1 focus:ring-indigo-500 ${isDarkMode ? 'bg-white/5 text-white placeholder:text-slate-600' : 'bg-white text-slate-900 shadow-sm placeholder:text-slate-400'} font-mono text-[13px] font-medium transition-all`}
                placeholder="domain.com"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
              />
            </div>
            
            {/* Segmented Control instead of select */}
            <div className={`flex rounded-lg border p-0.5 ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-100'}`}>
              <button
                type="button"
                onClick={() => setNewUrlType('allow')}
                className={`rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${newUrlType === 'allow'
                  ? (isDarkMode ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-indigo-600 shadow-sm')
                  : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Allow
              </button>
              <button
                type="button"
                onClick={() => setNewUrlType('deny')}
                className={`rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${newUrlType === 'deny'
                  ? (isDarkMode ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-indigo-600 shadow-sm')
                  : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Block
              </button>
            </div>

            <button
              onClick={handleAddUrl}
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-[11px] font-bold uppercase tracking-widest text-white shadow-lg shadow-indigo-500/10 transition-all hover:bg-indigo-500 active:scale-95"
            >
              <FiPlus size={14} />
              Add Rule
            </button>
          </div>
        </div>
      </DashboardSection>

      {/* Protocol Information */}
      <DashboardSection
        title={t('options_firewall_howItWorks_header')}
        subtitle="Security protocols and evaluation order"
        icon={<FiShield size={24} />}
        isDarkMode={isDarkMode}
        colorTheme="teal"
      >
        <div className="space-y-5 p-10">
          {t('options_firewall_howItWorks')
            .split('\n')
            .map((rule, idx) => (
              <div key={idx} className="group/item flex items-start gap-5">
                <div className={`mt-1.5 shrink-0 transition-transform group-hover/item:translate-x-1 ${isDarkMode ? 'text-teal-500' : 'text-teal-600'}`}>
                  <FiChevronRight size={14} className="opacity-70" />
                </div>
                <p className={`text-[13px] font-medium leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>{rule}</p>
              </div>
            ))}
        </div>
      </DashboardSection>
    </div>
  );
};

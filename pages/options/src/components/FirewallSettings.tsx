/* eslint-disable jsx-a11y/label-has-associated-control */
import { useState, useEffect, useCallback } from 'react';
import { firewallStore } from '@extension/storage';
import { t } from '@extension/i18n';
import { FiShield, FiPlus, FiTrash2, FiSlash, FiTarget, FiChevronRight } from 'react-icons/fi';

interface FirewallSettingsProps {
  isDarkMode: boolean;
}

import { DashboardSection } from './shared/DashboardSection';

interface FirewallSettingsProps {
  isDarkMode: boolean;
}

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
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-12 duration-700">

      {/* Firewall Status & Rules Section */}
      <DashboardSection
        title="Domain Sentinel"
        subtitle="Hardware-level domain filtering and validation"
        icon={<FiShield size={24} />}
        isDarkMode={isDarkMode}
        colorTheme="cyan"
        headerClassName="justify-between"
      >
        <div className="absolute right-10 top-8">
          <label className="group relative inline-flex shrink-0 cursor-pointer items-center">
            <input type="checkbox" className="peer sr-only" checked={isEnabled} onChange={handleToggleFirewall} />
            <div className={`peer h-8 w-14 rounded-full border transition-all duration-300 after:absolute 
              after:left-[4px] after:top-[4px] after:size-6 after:rounded-full after:shadow-2xl 
              after:backdrop-blur-md after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none
              ${isDarkMode ? 'border-white/10 bg-white/5 after:bg-white/20 peer-checked:bg-cyan-500/80 shadow-cyan-500/20' : 'border-slate-200 bg-slate-200 after:bg-white peer-checked:bg-cyan-500 shadow-sm'} 
              peer-checked:after:bg-white peer-checked:after:after:shadow-cyan-500/50`}>
            </div>
          </label>
        </div>

        <div className="p-10">
          {/* Active Rules List */}
          <div className="mb-10 min-h-[100px] space-y-3">
            {allowList.map(url => (
              <div key={`allow-${url}`} className={`group/item flex items-center justify-between rounded-2xl border px-6 py-4 transition-all duration-300 ${isDarkMode ? 'border-white/5 bg-white/5 hover:bg-white/10' : 'border-slate-100 bg-slate-50 hover:bg-white hover:shadow-lg'}`}>
                <div className="flex items-center gap-4">
                  <span className={`rounded-lg px-3 py-1 text-[11px] font-black uppercase tracking-widest ${isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>Allow</span>
                  <span className={`font-mono text-sm font-bold ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{url}</span>
                </div>
                <button onClick={() => handleRemoveUrl(url, 'allow')} className={`rounded-xl p-2.5 opacity-0 transition-all duration-300 group-hover/item:opacity-100 ${isDarkMode ? 'text-slate-500 hover:bg-red-500/20 hover:text-red-400' : 'text-slate-400 hover:bg-red-50 hover:text-red-500'}`}>
                  <FiTrash2 size={16} />
                </button>
              </div>
            ))}

            {denyList.map(url => (
              <div key={`deny-${url}`} className={`group/item flex items-center justify-between rounded-2xl border px-6 py-4 transition-all duration-300 ${isDarkMode ? 'border-white/5 bg-white/5 hover:bg-white/10' : 'border-slate-100 bg-slate-50 hover:bg-white hover:shadow-lg'}`}>
                <div className="flex items-center gap-4">
                  <span className={`rounded-lg px-3 py-1 text-[11px] font-black uppercase tracking-widest ${isDarkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700'}`}>Block</span>
                  <span className={`font-mono text-sm font-bold ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{url}</span>
                </div>
                <button onClick={() => handleRemoveUrl(url, 'deny')} className={`rounded-xl p-2.5 opacity-0 transition-all duration-300 group-hover/item:opacity-100 ${isDarkMode ? 'text-slate-500 hover:bg-red-500/20 hover:text-red-400' : 'text-slate-400 hover:bg-red-50 hover:text-red-500'}`}>
                  <FiTrash2 size={16} />
                </button>
              </div>
            ))}

            {allowList.length === 0 && denyList.length === 0 && (
              <div className={`rounded-[2.5rem] border-2 border-dashed py-16 text-center ${isDarkMode ? 'border-white/5 bg-black/10' : 'border-slate-100 bg-slate-50/30'}`}>
                <div className="flex flex-col items-center">
                  <div className={`mb-6 flex size-16 items-center justify-center rounded-full ${isDarkMode ? 'bg-white/5 text-slate-600' : 'bg-white text-slate-300 shadow-sm'}`}>
                    <FiSlash size={32} />
                  </div>
                  <span className={`text-sm font-black uppercase tracking-widest ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>Zero Rules Implemented</span>
                </div>
              </div>
            )}
          </div>

          {/* Add Rule Interface */}
          <div className={`group-within:shadow-2xl flex flex-col items-stretch gap-4 rounded-[2rem] border p-5 transition-all duration-500 sm:flex-row sm:items-center ${isDarkMode ? 'border-white/5 bg-black/20 focus-within:border-indigo-500/30' : 'border-slate-200 bg-slate-50'}`}>
            <div className="relative flex-1">
              <FiTarget className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 opacity-50" />
              <input
                type="text"
                className={`w-full rounded-2xl border-0 py-4 pl-12 pr-4 focus:ring-2 focus:ring-indigo-500 ${isDarkMode ? 'bg-white/5 text-white placeholder:text-slate-600' : 'bg-white text-slate-900 shadow-sm placeholder:text-slate-400'} font-mono text-[14px] font-bold transition-all`}
                placeholder={t('options_firewall_placeholders_domainUrl')}
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
              />
            </div>
            <div className="relative">
              <select
                className={`h-full min-w-[120px] rounded-2xl border-0 px-6 py-4 focus:ring-2 focus:ring-indigo-500 ${isDarkMode ? 'cursor-pointer bg-white/5 text-white' : 'cursor-pointer bg-white text-slate-900 shadow-sm'} appearance-none text-[13px] font-black uppercase tracking-wider outline-none`}
                value={newUrlType}
                onChange={e => setNewUrlType(e.target.value as 'allow' | 'deny')}>
                <option value="allow" className={isDarkMode ? 'bg-[#1a1c23]' : ''}>Allow</option>
                <option value="deny" className={isDarkMode ? 'bg-[#1a1c23]' : ''}>Block</option>
              </select>
            </div>
            <button
              onClick={handleAddUrl}
              className="flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 px-8 py-4 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-indigo-500/20 transition-all hover:-translate-y-0.5 hover:shadow-indigo-500/40 active:scale-95"
            >
              <FiPlus size={16} />
              Deploy Rule
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
        colorTheme="emerald"
      >
        <div className="space-y-5 p-10">
          {t('options_firewall_howItWorks')
            .split('\n')
            .map((rule, idx) => (
              <div key={idx} className="group/item flex items-start gap-5">
                <div className={`mt-1.5 shrink-0 transition-transform group-hover/item:translate-x-1 ${isDarkMode ? 'text-emerald-500' : 'text-emerald-600'}`}>
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

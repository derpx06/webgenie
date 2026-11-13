import React, { useState } from 'react';
import { FiCpu, FiCheck, FiX, FiSearch, FiGlobe, FiServer, FiActivity, FiShield } from 'react-icons/fi';
import { SiOpenai, SiAnthropic, SiGoogle } from 'react-icons/si';
import { ProviderTypeEnum, getDefaultDisplayNameFromProviderId } from '@extension/storage';

interface ProviderSelectorProps {
  isDarkMode: boolean;
  isProviderSelectorOpen: boolean;
  setIsProviderSelectorOpen: (open: boolean) => void;
  providersFromStorage: Set<string>;
  modifiedProviders: Set<string>;
  handleProviderSelection: (type: ProviderTypeEnum) => void;
}

const PROVIDER_METADATA: Record<string, { category: string; type: string; icon: React.ReactNode; color: string }> = {
  [ProviderTypeEnum.OpenAI]: { category: 'Recommended', type: 'Hosted API', icon: <SiOpenai />, color: 'bg-slate-900' },
  [ProviderTypeEnum.Anthropic]: { category: 'Recommended', type: 'Hosted API', icon: <SiAnthropic />, color: 'bg-white' },
  [ProviderTypeEnum.Gemini]: { category: 'Recommended', type: 'Hosted API', icon: <SiGoogle />, color: 'bg-blue-500' },
  [ProviderTypeEnum.DeepSeek]: { category: 'Recommended', type: 'Hosted API', icon: <FiActivity />, color: 'bg-indigo-600' },
  [ProviderTypeEnum.Grok]: { category: 'Recommended', type: 'Hosted API', icon: <FiActivity />, color: 'bg-black' },
  [ProviderTypeEnum.Ollama]: { category: 'Local & Open Source', type: 'Local Runtime', icon: <FiServer />, color: 'bg-orange-500' },
  [ProviderTypeEnum.Groq]: { category: 'Local & Open Source', type: 'Hosted API', icon: <FiCpu />, color: 'bg-orange-600' },
  [ProviderTypeEnum.Cerebras]: { category: 'Local & Open Source', type: 'Hosted API', icon: <FiCpu />, color: 'bg-emerald-600' },
  [ProviderTypeEnum.Llama]: { category: 'Local & Open Source', type: 'Hosted API', icon: <FiActivity />, color: 'bg-blue-600' },
  [ProviderTypeEnum.AzureOpenAI]: { category: 'Enterprise & Compatible', type: 'Enterprise API', icon: <FiShield />, color: 'bg-blue-700' },
  [ProviderTypeEnum.OpenRouter]: { category: 'Enterprise & Compatible', type: 'API Aggregator', icon: <FiGlobe />, color: 'bg-violet-600' },
  [ProviderTypeEnum.Bedrock]: { category: 'Enterprise & Compatible', type: 'Enterprise API', icon: <FiShield />, color: 'bg-orange-700' },
  [ProviderTypeEnum.VertexAI]: { category: 'Enterprise & Compatible', type: 'Enterprise API', icon: <SiGoogle />, color: 'bg-blue-600' },
  [ProviderTypeEnum.CustomOpenAI]: { category: 'Enterprise & Compatible', type: 'Custom Endpoint', icon: <FiCpu />, color: 'bg-slate-500' },
};

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  isDarkMode,
  isProviderSelectorOpen,
  setIsProviderSelectorOpen,
  providersFromStorage,
  modifiedProviders,
  handleProviderSelection,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isProviderSelectorOpen) return null;

  const categories = ['Recommended', 'Local & Open Source', 'Enterprise & Compatible'];
  
  const allProviders = Object.values(ProviderTypeEnum);

  const filteredProviders = allProviders.filter(type => {
    const name = getDefaultDisplayNameFromProviderId(type).toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  return (
    <div className={`animate-in fade-in zoom-in-95 absolute right-0 z-[999] mt-2 w-[480px] overflow-hidden rounded-2xl border shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-md duration-200 ${
      isDarkMode ? 'border-white/10 bg-slate-900' : 'border-slate-200 bg-white'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 p-5 pb-4">
        <div>
          <h3 className={`font-outfit text-base font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Connect Provider</h3>
          <p className={`text-[11px] font-medium opacity-50 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Choose a provider to power AI features</p>
        </div>
        <button 
          onClick={() => setIsProviderSelectorOpen(false)}
          className={`flex size-8 items-center justify-center rounded-lg transition-all ${isDarkMode ? 'text-slate-500 hover:bg-white/5 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-900'}`}
        >
          <FiX size={16} />
        </button>
      </div>

      {/* Search */}
      <div className="px-5 pt-4">
        <div className="group relative">
          <FiSearch className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-sm opacity-30 transition-opacity group-focus-within:opacity-100 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`} />
          <input 
            type="text"
            placeholder="Search providers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full rounded-xl border py-2.5 pl-10 pr-4 text-xs font-semibold outline-none transition-all ${
              isDarkMode 
                ? 'border-white/5 bg-white/5 text-white focus:border-indigo-500/50 focus:bg-white/[0.08]' 
                : 'border-slate-100 bg-slate-50 text-slate-900 focus:border-indigo-300 focus:bg-white focus:shadow-sm'
            }`}
          />
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="scrollbar-thin max-h-[500px] overflow-y-auto px-5 py-4">
        {categories.map(category => {
          const providersInCategory = filteredProviders.filter(type => PROVIDER_METADATA[type]?.category === category);
          if (providersInCategory.length === 0) return null;

          return (
            <div key={category} className="mb-6 last:mb-2">
              <div className="mb-2.5 flex items-center gap-3 px-1">
                <span className={`text-[10px] font-black uppercase tracking-wider opacity-30 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {category}
                </span>
                <div className={`h-px grow opacity-5 ${isDarkMode ? 'bg-white' : 'bg-slate-900'}`} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {providersInCategory.map(type => {
                  const isAdded = providersFromStorage.has(type) || modifiedProviders.has(type);
                  const isAzure = type === ProviderTypeEnum.AzureOpenAI;
                  const isCustom = type === ProviderTypeEnum.CustomOpenAI;
                  const isDisabled = isAdded && !isAzure && !isCustom;
                  const meta = PROVIDER_METADATA[type];

                  return (
                    <button
                      key={type}
                      onClick={() => handleProviderSelection(type)}
                      disabled={isDisabled}
                      className={`group/item flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200 ${
                        isDarkMode 
                          ? 'border-white/5 bg-white/[0.02] hover:border-indigo-500/30 hover:bg-indigo-500/5' 
                          : 'border-slate-100 bg-slate-50/50 hover:border-indigo-200 hover:bg-white hover:shadow-sm'
                      } ${isDisabled ? 'cursor-not-allowed opacity-40 grayscale-[0.5]' : ''}`}
                    >
                      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg border text-sm transition-transform duration-300 group-hover/item:scale-105 ${
                        isDarkMode ? 'border-white/5 bg-white/5 text-slate-400' : 'border-slate-200 bg-white text-slate-600'
                      }`}>
                        {meta?.icon || <FiCpu />}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex items-center gap-1.5">
                          <span className={`truncate text-[12px] font-bold tracking-tight ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                            {getDefaultDisplayNameFromProviderId(type)}
                          </span>
                          {isDisabled && <FiCheck size={10} className="shrink-0 text-emerald-500" />}
                        </div>
                        <span className={`block text-[9px] font-bold opacity-30 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {meta?.type || 'Inference API'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

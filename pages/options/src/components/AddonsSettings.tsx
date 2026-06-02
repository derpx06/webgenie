/* eslint-disable jsx-a11y/label-has-associated-control */
import { useState, useEffect } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { 
  FiSearch, 
  FiCpu, 
  FiActivity, 
  FiGlobe, 
  FiShield, 
  FiLayers, 
  FiTerminal, 
  FiCompass, 
  FiPlus, 
  FiEye, 
  FiEyeOff, 
  FiCheck,
  FiX
} from 'react-icons/fi';

interface AddonsSettingsProps {
  isDarkMode?: boolean;
}

const ENGINES = [
  { id: 'tavily', label: 'Tavily Search', desc: 'AI-First grounding', icon: FiSearch },
  { id: 'perplexity', label: 'Perplexity AI', desc: 'Conversational reasoning summaries', icon: FiCpu },
  { id: 'exa', label: 'Exa Search', desc: 'Neural semantic link discovery', icon: FiActivity },
  { id: 'serper', label: 'Serper.dev', desc: 'High-speed Google wrapper', icon: FiGlobe },
  { id: 'brave', label: 'Brave Search', desc: 'Independent index index', icon: FiShield },
  { id: 'jina', label: 'Jina Reader', desc: 'URL page scraper to markdown', icon: FiLayers },
  { id: 'google', label: 'Google Search', desc: 'Official Custom Search Engine (CSE)', icon: FiTerminal },
  { id: 'duckduckgo', label: 'DuckDuckGo', desc: 'Free organic Lite scraper', icon: FiCompass },
];

export const AddonsSettings = ({ isDarkMode = false }: AddonsSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);
  
  // Dynamic UI Form states
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedNewEngine, setSelectedEngine] = useState<string>('tavily');
  const [newApiKey, setNewApiKey] = useState<string>('');
  const [newSearchEngineId, setNewSearchEngineId] = useState<string>('');
  
  // Password Visibility toggles
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    generalSettingsStore.getSettings().then(setSettings);
  }, []);



  const getEngineLabel = (engineId: string) => {
    return ENGINES.find(e => e.id === engineId)?.label || engineId.toUpperCase();
  };

  // Helper to determine if a provider is configured
  const getConfiguredProviders = () => {
    const list: string[] = [];
    if (settings.tavilyApiKey) list.push('tavily');
    if (settings.perplexityApiKey) list.push('perplexity');
    if (settings.exaApiKey) list.push('exa');
    if (settings.serperApiKey) list.push('serper');
    if (settings.braveApiKey) list.push('brave');
    if (settings.jinaApiKey) list.push('jina');
    if (settings.googleApiKey && settings.googleSearchEngineId) list.push('google');
    
    // DuckDuckGo is always configured as a fallback (no credentials needed)
    list.push('duckduckgo');
    return list;
  };

  const handleAddProvider = async () => {
    if (selectedNewEngine === 'duckduckgo') {
      // DuckDuckGo has no credentials, just enable it
      await generalSettingsStore.updateSettings({
        enableDuckDuckGo: true
      });
      setIsAddingNew(false);
      const updated = await generalSettingsStore.getSettings();
      setSettings(updated);
      return;
    }

    const updates: Partial<GeneralSettingsConfig> = {};
    if (selectedNewEngine === 'tavily') {
      updates.tavilyApiKey = newApiKey;
      updates.enableTavilySearch = true;
    } else if (selectedNewEngine === 'perplexity') {
      updates.perplexityApiKey = newApiKey;
      updates.enablePerplexitySearch = true;
    } else if (selectedNewEngine === 'exa') {
      updates.exaApiKey = newApiKey;
      updates.enableExaSearch = true;
    } else if (selectedNewEngine === 'serper') {
      updates.serperApiKey = newApiKey;
      updates.enableSerperSearch = true;
    } else if (selectedNewEngine === 'brave') {
      updates.braveApiKey = newApiKey;
      updates.enableBraveSearch = true;
    } else if (selectedNewEngine === 'jina') {
      updates.jinaApiKey = newApiKey;
      updates.enableJinaSearch = true;
    } else if (selectedNewEngine === 'google') {
      updates.googleApiKey = newApiKey;
      updates.googleSearchEngineId = newSearchEngineId;
      updates.enableGoogleSearch = true;
    }

    // Set as primary engine automatically on add if it's the first provider
    const activeBefore = getConfiguredProviders().filter(p => p !== 'duckduckgo');
    if (activeBefore.length === 0) {
      updates.primarySearchEngine = selectedNewEngine;
    }

    await generalSettingsStore.updateSettings(updates);
    const updated = await generalSettingsStore.getSettings();
    setSettings(updated);
    
    // Reset form fields
    setNewApiKey('');
    setNewSearchEngineId('');
    setIsAddingNew(false);
  };

  const handleDeleteProvider = async (engineId: string) => {
    const updates: Partial<GeneralSettingsConfig> = {};
    
    if (engineId === 'tavily') {
      updates.tavilyApiKey = '';
      updates.enableTavilySearch = false;
    } else if (engineId === 'perplexity') {
      updates.perplexityApiKey = '';
      updates.enablePerplexitySearch = false;
    } else if (engineId === 'exa') {
      updates.exaApiKey = '';
      updates.enableExaSearch = false;
    } else if (engineId === 'serper') {
      updates.serperApiKey = '';
      updates.enableSerperSearch = false;
    } else if (engineId === 'brave') {
      updates.braveApiKey = '';
      updates.enableBraveSearch = false;
    } else if (engineId === 'jina') {
      updates.jinaApiKey = '';
      updates.enableJinaSearch = false;
    } else if (engineId === 'google') {
      updates.googleApiKey = '';
      updates.googleSearchEngineId = '';
      updates.enableGoogleSearch = false;
    }

    // If the deleted engine was the primary one, fallback to duckduckgo
    if (settings.primarySearchEngine === engineId) {
      updates.primarySearchEngine = 'duckduckgo';
    }

    await generalSettingsStore.updateSettings(updates);
    const updated = await generalSettingsStore.getSettings();
    setSettings(updated);
  };

  const handleSelectPrimary = async (engineId: string) => {
    await generalSettingsStore.updateSettings({
      primarySearchEngine: engineId
    });
    const updated = await generalSettingsStore.getSettings();
    setSettings(updated);
  };

  const toggleVisibility = (engineId: string) => {
    setVisibleKeys(prev => ({
      ...prev,
      [engineId]: !prev[engineId]
    }));
  };

  const configured = getConfiguredProviders();

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-6 max-w-2xl mx-auto pb-10">
      
      {/* 1. HEADER SECTION */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-2 relative">
        <div>
          <h1 className={`font-outfit text-[22px] font-black uppercase tracking-wider ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
            Search Connectivity
          </h1>
          <p className={`text-[11px] font-bold tracking-widest uppercase opacity-55 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
            API & Integration Status
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsAddingNew(true)}
          className="flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 hover:scale-[1.05] active:scale-[0.95] shadow-lg shadow-indigo-600/15 bg-indigo-600 text-white hover:bg-indigo-500"
        >
          <FiPlus size={20} />
        </button>
      </div>

      {/* 2. ADD NEW PROVIDER DIALOG MODAL */}
      {isAddingNew && (
        <div 
          onClick={() => setIsAddingNew(false)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-in fade-in duration-200"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className={`search-provider-modal-content w-full max-w-xl rounded-3xl border p-6 shadow-2xl flex flex-col gap-5 animate-in zoom-in-95 duration-200
              ${isDarkMode ? 'border-white/10 bg-[#161821] text-white' : 'border-slate-200 bg-white text-slate-900'}`}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div>
                <h3 className="font-outfit text-[16px] font-black uppercase tracking-wider">
                  Connect Search Provider
                </h3>
                <p className="text-[11px] opacity-50 mt-1">Configure credentials for a search grounding node</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsAddingNew(false)}
                className={`flex size-9 items-center justify-center rounded-xl transition-all ${
                  isDarkMode ? 'text-slate-400 hover:bg-white/5 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <FiX size={18} />
              </button>
            </div>

            {/* Scrollable Content Container */}
            <div className="scrollbar-thin max-h-[420px] overflow-y-auto pr-1 flex flex-col gap-5">
              {/* Grid Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider mb-2.5 opacity-60">
                  Choose Search Engine
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ENGINES.map(e => {
                    const isAdded = configured.includes(e.id);
                    const isSelected = selectedNewEngine === e.id;
                    
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => setSelectedEngine(e.id)}
                        className={`group/item flex items-center gap-3.5 rounded-xl border p-3 text-left transition-all duration-200 active:scale-[0.98] ${
                          isSelected
                            ? isDarkMode 
                              ? 'border-indigo-500 bg-indigo-500/10 text-white ring-2 ring-indigo-500/20' 
                              : 'border-indigo-600 bg-indigo-50/55 text-slate-900 ring-2 ring-indigo-600/10'
                            : isDarkMode 
                              ? 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-[#1f212d]' 
                              : 'border-slate-100 bg-slate-50/50 hover:border-indigo-200 hover:bg-white hover:shadow-sm'
                        }`}
                      >
                        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg border text-sm transition-transform duration-300 group-hover/item:scale-105 ${
                          isSelected
                            ? isDarkMode
                              ? 'border-indigo-500/30 bg-indigo-500/20 text-indigo-400'
                              : 'border-indigo-200 bg-indigo-100/50 text-indigo-600'
                            : isDarkMode
                              ? 'border-white/5 bg-white/5 text-slate-400'
                              : 'border-slate-200 bg-white text-slate-600'
                        }`}>
                          <e.icon size={15} />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <div className="flex items-center gap-1.5">
                            <span className={`truncate text-[12px] font-bold tracking-tight ${
                              isSelected
                                ? isDarkMode ? 'text-white' : 'text-slate-900'
                                : isDarkMode ? 'text-slate-200' : 'text-slate-700'
                            }`}>
                              {e.label}
                            </span>
                            {isAdded && (
                              <span className="flex items-center justify-center rounded-full bg-emerald-500/10 p-0.5" title="Configured">
                                <FiCheck size={9} className="text-emerald-500" />
                              </span>
                            )}
                          </div>
                          <span className={`block text-[9px] font-medium leading-normal mt-0.5 truncate opacity-50 ${
                            isDarkMode ? 'text-slate-400' : 'text-slate-500'
                          }`}>
                            {e.desc}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* API Key Inputs */}
              {selectedNewEngine !== 'duckduckgo' && (
                <div className="flex flex-col gap-4 border-t border-white/5 pt-4 animate-in fade-in duration-200">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5 opacity-60">Access Key (API Key)</label>
                    <input
                      type="password"
                      value={newApiKey}
                      onChange={e => setNewApiKey(e.target.value)}
                      placeholder={`Enter ${getEngineLabel(selectedNewEngine)} Key`}
                      className={`w-full rounded-xl border px-3.5 py-2.5 font-mono text-[12px] focus:outline-none
                        ${isDarkMode 
                          ? 'border-white/10 bg-[#0e0f14] text-white placeholder:text-white/20 focus:border-indigo-500/50' 
                          : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-300 focus:border-indigo-500/50'}`}
                    />
                  </div>

                  {selectedNewEngine === 'google' && (
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5 opacity-60">Search Engine ID (CX ID)</label>
                      <input
                        type="text"
                        value={newSearchEngineId}
                        onChange={e => setNewSearchEngineId(e.target.value)}
                        placeholder="Enter custom CX ID"
                        className={`w-full rounded-xl border px-3.5 py-2.5 font-mono text-[12px] focus:outline-none
                          ${isDarkMode 
                            ? 'border-white/10 bg-[#0e0f14] text-white placeholder:text-white/20 focus:border-indigo-500/50' 
                            : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-300 focus:border-indigo-500/50'}`}
                      />
                    </div>
                  )}
                </div>
              )}

              {selectedNewEngine === 'duckduckgo' && (
                <div className="text-[12px] opacity-60 p-3.5 rounded-xl border border-white/5 bg-white/5 border-t mt-2">
                  DuckDuckGo queries organic pages directly and requires no developer credentials.
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-white/5 pt-4 mt-2">
              <button
                type="button"
                onClick={() => setIsAddingNew(false)}
                className={`rounded-xl border px-5 py-2.5 font-outfit text-[12px] font-black uppercase tracking-wider transition-all duration-300
                  ${isDarkMode 
                    ? 'border-white/10 text-white hover:bg-white/5' 
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddProvider}
                className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 font-outfit text-[12px] font-black uppercase tracking-wider text-white hover:bg-indigo-500 transition-all duration-300 hover:scale-[1.02]"
              >
                <FiCheck size={14} /> Connect Engine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. SEARCH PROVIDERS & ROUTING CONSOLIDATED CARD */}
      <div className={`rounded-2xl border overflow-hidden
        ${isDarkMode ? 'border-white/5 bg-[#161821]' : 'border-slate-100 bg-white'}`}
      >
        {/* Card Header */}
        <div className={`flex items-center gap-3.5 px-6 py-5 border-b
          ${isDarkMode ? 'border-white/5 bg-[#1a1c27]' : 'border-slate-100 bg-slate-50/50'}`}
        >
          <div className={`p-2 rounded-xl ${isDarkMode ? 'bg-indigo-600/10 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
            <FiSearch size={18} />
          </div>
          <div>
            <h2 className={`font-outfit text-[15px] font-black uppercase tracking-wider ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
              Search Grounding
            </h2>
            <p className={`text-[11px] font-medium opacity-50 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Connection credentials and primary engine routing
            </p>
          </div>
        </div>

        {/* Card Content (Provider Nodes List) */}
        <div className="flex flex-col">
          <div className="divide-y divide-white/5">
            {configured.map((engineId) => {
              const isLive = settings.primarySearchEngine === engineId;
              const engineLabel = getEngineLabel(engineId);
              
              // Access credentials safely for listing
              let keyDisplay = '••••••••••••••••••••••••••••••••';
              if (engineId === 'tavily') keyDisplay = settings.tavilyApiKey || '';
              else if (engineId === 'perplexity') keyDisplay = settings.perplexityApiKey || '';
              else if (engineId === 'exa') keyDisplay = settings.exaApiKey || '';
              else if (engineId === 'serper') keyDisplay = settings.serperApiKey || '';
              else if (engineId === 'brave') keyDisplay = settings.braveApiKey || '';
              else if (engineId === 'jina') keyDisplay = settings.jinaApiKey || '';
              else if (engineId === 'google') keyDisplay = settings.googleApiKey || '';
              
              const isVisible = visibleKeys[engineId] || false;

              return (
                <div 
                  key={engineId} 
                  className={`p-6 flex flex-col gap-4 transition-all duration-300
                    ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}
                >
                  {/* Node Title + Status Badge + Delete */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`font-outfit text-[13px] font-black uppercase tracking-wider ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                        {engineLabel}
                      </span>
                      {isLive ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Live Node
                        </span>
                      ) : (
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider
                          ${isDarkMode ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                          Configured
                        </span>
                      )}
                    </div>
                    
                    {engineId !== 'duckduckgo' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteProvider(engineId)}
                        className="text-[10px] font-black uppercase tracking-wider text-rose-500 hover:text-rose-400 active:scale-[0.98] transition-all"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {/* Input Fields */}
                  {engineId !== 'duckduckgo' ? (
                    <div className="flex flex-col gap-3">
                      <div>
                        <span className={`block text-[9px] font-black uppercase tracking-widest mb-1.5 opacity-40 ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>
                          Access Key
                        </span>
                        <div className="relative">
                          <input
                            type={isVisible ? 'text' : 'password'}
                            value={keyDisplay}
                            readOnly
                            className={`w-full rounded-xl border px-4 py-3 font-mono text-[12px] tracking-wider pr-10 focus:outline-none
                              ${isDarkMode 
                                ? 'border-white/5 bg-[#0e0f14]/50 text-white' 
                                : 'border-slate-100 bg-slate-50/50 text-slate-800'}`}
                          />
                          <button
                            type="button"
                            onClick={() => toggleVisibility(engineId)}
                            className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-200 transition-colors"
                          >
                            {isVisible ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                          </button>
                        </div>
                      </div>

                      {engineId === 'google' && (
                        <div>
                          <span className={`block text-[9px] font-black uppercase tracking-widest mb-1.5 opacity-40 ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>
                            Search Engine ID (CX ID)
                          </span>
                          <input
                            type="text"
                            value={settings.googleSearchEngineId || ''}
                            readOnly
                            className={`w-full rounded-xl border px-4 py-3 font-mono text-[12px] focus:outline-none
                              ${isDarkMode 
                                ? 'border-white/5 bg-[#0e0f14]/50 text-white' 
                                : 'border-slate-100 bg-slate-50/50 text-slate-800'}`}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={`p-3.5 rounded-xl border text-[11px] leading-relaxed opacity-60
                      ${isDarkMode ? 'border-white/5 bg-[#0e0f14]/40' : 'border-slate-100 bg-slate-50/30'}`}>
                      DuckDuckGo provides organic search scraping via HTML Lite. No authentication credentials are required.
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Unified Primary Selector Bottom Row */}
          <div className={`p-6 border-t ${isDarkMode ? 'border-white/5 bg-[#14151d]/50' : 'border-slate-100 bg-slate-50/20'}`}>
            <div className="flex flex-col gap-2">
              <label className={`text-[10px] font-black uppercase tracking-widest opacity-45 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                Primary Search Engine
              </label>
              <select
                value={settings.primarySearchEngine || 'duckduckgo'}
                onChange={e => handleSelectPrimary(e.target.value)}
                className={`font-outfit w-full cursor-pointer rounded-xl border px-4 py-3.5 text-[13px] font-bold focus:outline-none transition-all duration-300
                  ${isDarkMode 
                    ? 'border-white/10 bg-[#0e0f14] text-white focus:border-indigo-500/50' 
                    : 'border-slate-200 bg-white text-slate-900 focus:border-indigo-500/50'}`}
              >
                {configured.map((id) => (
                  <option key={id} value={id}>
                    {getEngineLabel(id)} {id === 'duckduckgo' ? '(No Key)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};

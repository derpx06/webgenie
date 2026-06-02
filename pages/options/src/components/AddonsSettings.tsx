/* eslint-disable jsx-a11y/label-has-associated-control */
import { useState, useEffect } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { FiSearch, FiGlobe, FiKey, FiCpu, FiCheck, FiPlus, FiAlertCircle } from 'react-icons/fi';
import { DashboardSection } from './shared/DashboardSection';
import { SettingToggle, SettingTextInput } from './GeneralSettingsComponents';

interface AddonsSettingsProps {
  isDarkMode?: boolean;
}

export const AddonsSettings = ({ isDarkMode = false }: AddonsSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);
  const [selectedEngine, setSelectedEngine] = useState<string>('tavily');
  const [tempApiKey, setTempApiKey] = useState<string>('');
  const [tempSearchEngineId, setTempSearchEngineId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    generalSettingsStore.getSettings().then(s => {
      setSettings(s);
      setSelectedEngine(s.primarySearchEngine || 'tavily');
    });
  }, []);

  // Sync temp input values when settings are loaded or when the selected search engine changes
  useEffect(() => {
    if (!settings) return;
    
    switch (selectedEngine) {
      case 'tavily':
        setTempApiKey(settings.tavilyApiKey || '');
        break;
      case 'perplexity':
        setTempApiKey(settings.perplexityApiKey || '');
        break;
      case 'exa':
        setTempApiKey(settings.exaApiKey || '');
        break;
      case 'serper':
        setTempApiKey(settings.serperApiKey || '');
        break;
      case 'brave':
        setTempApiKey(settings.braveApiKey || '');
        break;
      case 'jina':
        setTempApiKey(settings.jinaApiKey || '');
        break;
      case 'google':
        setTempApiKey(settings.googleApiKey || '');
        setTempSearchEngineId(settings.googleSearchEngineId || '');
        break;
      default:
        setTempApiKey('');
    }
  }, [selectedEngine, settings]);

  const handleAddEngine = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    // Prepare updates
    const updates: Partial<GeneralSettingsConfig> = {
      primarySearchEngine: selectedEngine,
    };

    // Disable all search engines, and only enable the active one
    updates.enableTavilySearch = selectedEngine === 'tavily';
    updates.enablePerplexitySearch = selectedEngine === 'perplexity';
    updates.enableExaSearch = selectedEngine === 'exa';
    updates.enableSerperSearch = selectedEngine === 'serper';
    updates.enableBraveSearch = selectedEngine === 'brave';
    updates.enableJinaSearch = selectedEngine === 'jina';
    updates.enableGoogleSearch = selectedEngine === 'google';
    updates.enableDuckDuckGo = selectedEngine === 'duckduckgo';

    // Store credentials for the currently selected engine
    if (selectedEngine === 'tavily') updates.tavilyApiKey = tempApiKey;
    if (selectedEngine === 'perplexity') updates.perplexityApiKey = tempApiKey;
    if (selectedEngine === 'exa') updates.exaApiKey = tempApiKey;
    if (selectedEngine === 'serper') updates.serperApiKey = tempApiKey;
    if (selectedEngine === 'brave') updates.braveApiKey = tempApiKey;
    if (selectedEngine === 'jina') updates.jinaApiKey = tempApiKey;
    if (selectedEngine === 'google') {
      updates.googleApiKey = tempApiKey;
      updates.googleSearchEngineId = tempSearchEngineId;
    }

    // Persist to store
    await generalSettingsStore.updateSettings(updates);
    const updated = await generalSettingsStore.getSettings();
    setSettings(updated);

    // Simulate network save latency for beautiful premium UX
    setTimeout(() => {
      setIsSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }, 800);
  };

  const getEngineLabel = (engine: string) => {
    switch (engine) {
      case 'tavily': return 'Tavily Search API';
      case 'perplexity': return 'Perplexity AI';
      case 'exa': return 'Exa Semantic Search';
      case 'serper': return 'Serper.dev (Google SERP)';
      case 'brave': return 'Brave Search API';
      case 'jina': return 'Jina Reader API';
      case 'google': return 'Google Custom Search';
      case 'duckduckgo': return 'DuckDuckGo (Free / No Key)';
      default: return 'Search Engine';
    }
  };

  const updateSetting = async <K extends keyof GeneralSettingsConfig>(
    key: K,
    value: GeneralSettingsConfig[K],
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);
    const confirmed = await generalSettingsStore.getSettings();
    setSettings(confirmed);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 grid grid-cols-1 gap-8 duration-700 lg:grid-cols-2">

      {/* SEARCH INTEGRATION MANAGER */}
      <DashboardSection
        title="Search Engine Integration"
        subtitle="Manage and register search grounding integrations for the AI agent"
        icon={<FiSearch size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col p-8"
      >
        <div className="flex flex-col gap-6">
          {/* Dropdown Selector */}
          <div>
            <label className={`block text-[11px] font-black uppercase tracking-wider mb-2 opacity-70 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              Choose Search Engine
            </label>
            <select
              value={selectedEngine}
              onChange={e => setSelectedEngine(e.target.value)}
              className={`font-outfit w-full cursor-pointer rounded-xl border px-4 py-3 text-[14px] font-bold transition-all duration-300 focus:outline-none
                ${isDarkMode ? 'border-white/10 bg-[#161821] text-white focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20'
                  : 'border-slate-200 bg-white text-slate-900 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10'}`}
            >
              <option value="tavily">Tavily Search (AI-First)</option>
              <option value="perplexity">Perplexity AI (Conversational)</option>
              <option value="exa">Exa Search (Neural Links)</option>
              <option value="serper">Serper.dev (High-speed Google Wrapper)</option>
              <option value="brave">Brave Search API (Independent Index)</option>
              <option value="jina">Jina Reader API (Markdown scraper)</option>
              <option value="google">Google Custom Search (CSE Container)</option>
              <option value="duckduckgo">DuckDuckGo Search (Free scraper)</option>
            </select>
          </div>

          {/* Dynamic Credentials Inputs */}
          {selectedEngine !== 'duckduckgo' && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300 flex flex-col gap-4">
              <div>
                <label className={`block text-[11px] font-black uppercase tracking-wider mb-2 opacity-70 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                  API Key / Credentials
                </label>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={e => setTempApiKey(e.target.value)}
                  placeholder={`Enter ${getEngineLabel(selectedEngine)} API Key`}
                  className={`w-full rounded-xl border px-4 py-3 font-mono text-[13px] font-medium transition-all duration-300 focus:outline-none
                    ${isDarkMode ? 'border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20'
                      : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-300 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10'}`}
                />
              </div>

              {selectedEngine === 'google' && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className={`block text-[11px] font-black uppercase tracking-wider mb-2 opacity-70 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                    Search Engine ID (CX ID)
                  </label>
                  <input
                    type="text"
                    value={tempSearchEngineId}
                    onChange={e => setTempSearchEngineId(e.target.value)}
                    placeholder="Enter Custom Search Engine ID"
                    className={`w-full rounded-xl border px-4 py-3 font-mono text-[13px] font-medium transition-all duration-300 focus:outline-none
                      ${isDarkMode ? 'border-white/10 bg-white/5 text-white placeholder:text-white/20 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20'
                        : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-300 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10'}`}
                  />
                </div>
              )}
            </div>
          )}

          {selectedEngine === 'duckduckgo' && (
            <div className={`p-4 rounded-xl border flex items-start gap-3 transition-colors duration-300 ${
              isDarkMode ? 'border-indigo-500/10 bg-indigo-500/5' : 'border-indigo-100 bg-indigo-50/50'
            }`}>
              <FiAlertCircle className={`mt-0.5 shrink-0 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`} size={16} />
              <div className="text-[12px] font-medium leading-relaxed opacity-85">
                No credentials are required for DuckDuckGo. WebGenie will scrape and parse the search results through DuckDuckGo Lite.
              </div>
            </div>
          )}

          {/* Action Save/Add Button */}
          <div className="flex items-center gap-4 mt-2">
            <button
              onClick={handleAddEngine}
              disabled={isSaving}
              className={`flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-outfit text-[13px] font-black uppercase tracking-wider transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-md disabled:opacity-50
                ${isDarkMode ? 'bg-indigo-600 text-white hover:bg-indigo-500 hover:shadow-indigo-500/20'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-600/10'}`}
            >
              {isSaving ? (
                <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : saveSuccess ? (
                <FiCheck size={16} className="text-emerald-400" />
              ) : (
                <FiPlus size={16} />
              )}
              {isSaving ? 'Registering...' : saveSuccess ? 'Saved!' : 'Add Search Engine'}
            </button>

            {/* Currently Configured Badge */}
            {settings.primarySearchEngine && (
              <div className="flex items-center gap-2">
                <div className="size-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                <span className={`text-[11px] font-bold uppercase tracking-wider opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                  Active: {getEngineLabel(settings.primarySearchEngine)}
                </span>
              </div>
            )}
          </div>
        </div>
      </DashboardSection>

      {/* CLOUD BROWSER SANDBOX */}
      <DashboardSection
        title="Cloud Browser Hosting"
        subtitle="Offload execution to remote sandbox browsers"
        icon={<FiGlobe size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingToggle title="Enable Browserbase" desc="Run browser automation Headless in the cloud" checked={settings.enableBrowserbase} isDarkMode={isDarkMode} onChange={val => updateSetting('enableBrowserbase', val)} />
        <SettingTextInput title="Browserbase API Key" desc="Authentication API key for remote browser launch" value={settings.browserbaseApiKey} isSecret={true} placeholder="bb-..." isDarkMode={isDarkMode} onChange={val => updateSetting('browserbaseApiKey', val)} />
        <SettingTextInput title="Browserbase Project ID" desc="Project sandbox scope identifier" value={settings.browserbaseProjectId} placeholder="project-id" isDarkMode={isDarkMode} onChange={val => updateSetting('browserbaseProjectId', val)} />
      </DashboardSection>

      {/* CAPTCHA & AUTO-BYPASS */}
      <DashboardSection
        title="CAPTCHA Auto-Bypass"
        subtitle="Third-party automated challenge solving APIs"
        icon={<FiKey size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingToggle title="Enable Capsolver" desc="Automatically solve Turnstile and hCaptcha checks" checked={settings.enableCapsolver} isDarkMode={isDarkMode} onChange={val => updateSetting('enableCapsolver', val)} />
        <SettingTextInput title="Capsolver API Key" desc="Capsolver developer secret key" value={settings.capsolverApiKey} isSecret={true} placeholder="CAP-..." isDarkMode={isDarkMode} onChange={val => updateSetting('capsolverApiKey', val)} />
      </DashboardSection>

      {/* DOM RECOVERY & RESILIENCE */}
      <DashboardSection
        title="DOM Resilience"
        subtitle="Self-healing selectors and fuzzy target matching"
        icon={<FiCpu size={20} />}
        isDarkMode={isDarkMode}
        colorTheme="indigo"
        headerClassName="py-5 px-8"
        contentClassName="flex flex-col"
      >
        <SettingToggle title="Self-Healing Selectors" desc="Fuzzy matching for element identification when primary locator fails" checked={settings.enableSelfHealing} isDarkMode={isDarkMode} onChange={val => updateSetting('enableSelfHealing', val)} />
      </DashboardSection>

    </div>
  );
};

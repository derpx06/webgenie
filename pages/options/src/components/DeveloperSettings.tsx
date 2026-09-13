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

const TRACE_DB = 'WebGenieTraces';

// Reads the background's trace table directly: extension pages share one IndexedDB origin.
function traceStoreRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(TRACE_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('records')) {
        db.close();
        resolve(undefined);
        return;
      }
      const request = run(db.transaction('records', mode).objectStore('records'));
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        reject(request.error);
        db.close();
      };
    };
  });
}

async function downloadTraces(): Promise<number> {
  const records = (await traceStoreRequest<unknown[]>('readonly', store => store.getAll())) ?? [];
  if (records.length === 0) return 0;
  const blob = new Blob([records.map(entry => JSON.stringify(entry)).join('\n')], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `webgenie-traces-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return records.length;
}

export const DeveloperSettings = ({ isDarkMode = false }: DeveloperSettingsProps) => {
  const [traceStatus, setTraceStatus] = useState('');
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
        <div className="flex flex-wrap items-center gap-3 px-8 py-4">
          {[
            {
              label: 'Clear site memory',
              // Routes remembered from finished tasks, plus the stores older versions kept.
              run: async () => {
                await chrome.storage.local.remove(['wg_mem:routes', 'wg_mem:episodes', 'wg_mem:domains']);
                setTraceStatus('Site memory cleared.');
              },
            },
            {
              label: 'Clear remembered confirmations',
              run: async () => {
                const keys = Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('auto_confirm'));
                await chrome.storage.local.remove(keys);
                setTraceStatus(`Cleared ${keys.length} remembered confirmation${keys.length === 1 ? '' : 's'}.`);
              },
            },
          ].map(({ label, run }) => (
            <button
              key={label}
              type="button"
              onClick={() => run().catch(error => setTraceStatus(`Storage error: ${error instanceof Error ? error.message : String(error)}`))}
              className={`rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7C3AED] ${isDarkMode ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {!settings.enableDeveloperOptions && traceStatus && (
          <p className="px-8 pb-4 text-[11px] opacity-70" aria-live="polite">
            {traceStatus}
          </p>
        )}
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
              title="Capture Traces"
              desc="Persist structured logs, agent events, every LLM call (latency, finish reason, token usage, raw output on parse failure) and action timings to this browser's IndexedDB. Includes page text and prompts; API keys and tokens are redacted. Nothing leaves the browser."
              checked={settings.captureTraces}
              isDarkMode={isDarkMode}
              onChange={val => updateSetting('captureTraces', val)}
              severity="caution"
            />
            <div className="flex flex-wrap gap-3 px-8 py-4">
              {[
                {
                  label: 'Download traces (JSONL)',
                  run: async () => {
                    const count = await downloadTraces();
                    setTraceStatus(count ? `Downloaded ${count} trace records.` : 'No trace records yet. Enable capture and run a task.');
                  },
                },
                {
                  label: 'Clear traces',
                  run: async () => {
                    await traceStoreRequest('readwrite', store => store.clear());
                    setTraceStatus('Trace records cleared.');
                  },
                },
              ].map(({ label, run }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => run().catch(error => setTraceStatus(`Trace storage error: ${error instanceof Error ? error.message : String(error)}`))}
                  className={`rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7C3AED] ${isDarkMode ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {traceStatus && (
              <p className="px-8 pb-4 text-[11px] opacity-70" aria-live="polite">
                {traceStatus}
              </p>
            )}
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
              title="Langsmith Endpoint"
              desc="Langsmith API endpoint"
              value={generalSettings.langsmithEndpoint}
              placeholder="https://api.smith.langchain.com"
              isDarkMode={isDarkMode}
              onChange={val => updateGeneralSetting('langsmithEndpoint', val)}
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

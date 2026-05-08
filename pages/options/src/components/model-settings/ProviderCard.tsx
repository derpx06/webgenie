import React from 'react';
import { FiEyeOff, FiEye, FiX } from 'react-icons/fi';
import { ProviderTypeEnum, type ProviderConfig, llmProviderModelNames } from '@extension/storage';

interface ProviderCardProps {
  providerId: string;
  providerConfig: ProviderConfig;
  isDarkMode: boolean;
  isInStorage: boolean;
  isModified: boolean;
  visibleApiKeys: Record<string, boolean>;
  newModelInputs: Record<string, string>;
  getButtonProps: (provider: string) => { variant: string; children: string; disabled: boolean };
  handleDelete: (provider: string) => void;
  handleSave: (provider: string) => void;
  handleNameChange: (provider: string, name: string) => void;
  handleApiKeyChange: (provider: string, apiKey: string, baseUrl?: string) => void;
  handleRegionChange: (provider: string, region: string) => void;
  handleSecretKeyChange: (provider: string, secretKey: string) => void;
  toggleApiKeyVisibility: (provider: string) => void;
  removeModel: (provider: string, model: string) => void;
  addModel: (provider: string, model: string) => void;
  handleModelsChange: (provider: string, value: string) => void;
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
  providerId,
  providerConfig,
  isDarkMode,
  isInStorage,
  isModified,
  visibleApiKeys,
  newModelInputs,
  getButtonProps,
  handleDelete,
  handleSave,
  handleNameChange,
  handleApiKeyChange,
  handleRegionChange,
  handleSecretKeyChange,
  toggleApiKeyVisibility,
  removeModel,
  addModel,
  handleModelsChange,
}) => {
  const isDark = isDarkMode;
  const buttonProps = getButtonProps(providerId);

  return (
    <div className="p-6 transition-all duration-300 hover:bg-white/[0.01]">
      <div className="mb-6 flex flex-col justify-between gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-tighter ${isInStorage
              ? (isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-100 text-emerald-700')
              : (isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-100 text-amber-700')
              }`}>
              {isInStorage ? 'Live Node' : 'Draft'}
            </div>
            <h3 className={`font-outfit text-sm font-black uppercase tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{providerConfig.name || providerId}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all duration-300 active:scale-95 disabled:opacity-30 ${buttonProps.variant === 'danger'
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white'
                : 'bg-indigo-600 text-white hover:bg-indigo-500'
                }`}
              disabled={buttonProps.disabled}
              onClick={() => isInStorage && !isModified ? handleDelete(providerId) : handleSave(providerId)}
            >
              {buttonProps.children}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {providerConfig.type === ProviderTypeEnum.CustomOpenAI && (
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Identity</label>
            <input
              type="text"
              id={`${providerId}-name`}
              className={`w-full rounded-xl border px-4 py-3 text-xs font-bold outline-none transition-all focus:ring-1 focus:ring-indigo-500 ${isDark ? 'border-white/10 bg-white/5 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}
              placeholder="Provider Label"
              value={providerConfig.name || ''}
              onChange={e => handleNameChange(providerId, e.target.value)}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Access Key</label>
          <div className="group relative">
            <input
              type={visibleApiKeys[providerId] ? 'text' : 'password'}
              id={`${providerId}-api-key`}
              className={`w-full rounded-xl border px-4 py-3 font-mono text-xs font-bold outline-none transition-all focus:ring-1 focus:ring-indigo-500 ${isDark ? 'border-white/10 bg-white/5 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}
              placeholder="••••••••••••••••"
              value={providerConfig.apiKey || ''}
              onChange={e => handleApiKeyChange(providerId, e.target.value, providerConfig.baseUrl)}
            />
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30 transition-opacity hover:opacity-100"
              onClick={() => toggleApiKeyVisibility(providerId)}
            >
              {visibleApiKeys[providerId] ? <FiEyeOff size={14} /> : <FiEye size={14} />}
            </button>
          </div>
        </div>

        {providerConfig.type === ProviderTypeEnum.Bedrock && (
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">AWS Region</label>
            <input
              type="text"
              className={`w-full rounded-xl border px-4 py-3 font-mono text-xs font-bold outline-none transition-all focus:ring-1 focus:ring-indigo-500 ${isDark ? 'border-white/10 bg-white/5 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}
              placeholder="us-east-1"
              value={providerConfig.region || ''}
              onChange={e => handleRegionChange(providerId, e.target.value)}
            />
          </div>
        )}

        {providerConfig.type === ProviderTypeEnum.Bedrock && (
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">AWS Secret Key</label>
            <div className="group relative">
              <input
                type={visibleApiKeys[`${providerId}-secret`] ? 'text' : 'password'}
                className={`w-full rounded-xl border px-4 py-3 font-mono text-xs font-bold outline-none transition-all focus:ring-1 focus:ring-indigo-500 ${isDark ? 'border-white/10 bg-white/5 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}
                placeholder="••••••••••••••••"
                value={providerConfig.bedrockSecretKey || ''}
                onChange={e => handleSecretKeyChange(providerId, e.target.value)}
              />
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30 transition-opacity hover:opacity-100"
                onClick={() => toggleApiKeyVisibility(`${providerId}-secret`)}
              >
                {visibleApiKeys[`${providerId}-secret`] ? <FiEyeOff size={14} /> : <FiEye size={14} />}
              </button>
            </div>
          </div>
        )}

        {(providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
          providerConfig.type === ProviderTypeEnum.Ollama ||
          providerConfig.type === ProviderTypeEnum.AzureOpenAI ||
          providerConfig.type === ProviderTypeEnum.OpenRouter ||
          providerConfig.type === ProviderTypeEnum.Llama) && (
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Base Endpoint</label>
              <input
                type="text"
                className={`w-full rounded-xl border px-4 py-3 font-mono text-xs font-bold outline-none transition-all focus:ring-1 focus:ring-indigo-500 ${isDark ? 'border-white/10 bg-white/5 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}
                placeholder="https://api.example.com/v1"
                value={providerConfig.baseUrl || ''}
                onChange={e => handleApiKeyChange(providerId, providerConfig.apiKey || '', e.target.value)}
              />
            </div>
          )}
      </div>

      {providerConfig.type !== ProviderTypeEnum.AzureOpenAI && (
        <div className="mt-6 space-y-3">
          <label className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Intelligence Matrix</label>
          <div className={`flex min-h-[40px] flex-wrap gap-1.5 rounded-xl border p-4 ${isDark ? 'border-white/5 bg-black/20' : 'border-slate-100 bg-slate-50'}`}>
            {(providerConfig.modelNames || llmProviderModelNames[providerId as keyof typeof llmProviderModelNames] || []).map(model => (
              <div key={model} className="group/tag flex items-center gap-1.5 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-tight text-indigo-400">
                {model}
                <button onClick={() => removeModel(providerId, model)} className="opacity-0 transition-opacity group-hover/tag:opacity-100">
                  <FiX size={8} />
                </button>
              </div>
            ))}
            <input
              type="text"
              className={`ml-1 border-none bg-transparent text-[10px] font-bold outline-none ${isDark ? 'text-white placeholder:text-white/20' : 'text-slate-900 placeholder:text-slate-400'}`}
              placeholder="Add ID..."
              value={newModelInputs[providerId] || ''}
              onChange={e => handleModelsChange(providerId, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addModel(providerId, (newModelInputs[providerId] || '').trim());
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

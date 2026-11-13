import React, { useState } from 'react';
import { FiEyeOff, FiEye, FiX, FiChevronDown, FiChevronUp } from 'react-icons/fi';
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
  handleSessionTokenChange: (provider: string, sessionToken: string) => void;
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
  handleSessionTokenChange,
  toggleApiKeyVisibility,
  removeModel,
  addModel,
  handleModelsChange,
}) => {
  const isDark = isDarkMode;
  const buttonProps = getButtonProps(providerId);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`transition-all duration-300 ${isExpanded ? 'bg-white/[0.01]' : 'hover:bg-white/[0.005]'}`}>
      {/* Header section (always visible) */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`Toggle ${providerConfig.name || providerId} settings`}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        className="flex cursor-pointer select-none items-center justify-between p-6"
      >
        <div className="flex items-center gap-3">
          <div className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-tighter ${isInStorage
            ? (isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-100 text-emerald-700')
            : (isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-100 text-amber-700')
            }`}>
            {isInStorage ? 'Live Node' : 'Draft'}
          </div>
          <h3 className={`font-sans text-sm font-bold tracking-normal ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {providerConfig.name || providerId}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all duration-300 active:scale-95 disabled:opacity-30 ${buttonProps.variant === 'danger'
              ? 'border border-red-500/20 bg-transparent text-red-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500'
              : 'bg-[#7C3AED] text-white shadow-md shadow-[#7C3AED]/20 hover:bg-[#7C3AED]/90'
              }`}
            disabled={buttonProps.disabled}
            onClick={event => {
              event.stopPropagation();
              isInStorage && !isModified ? handleDelete(providerId) : handleSave(providerId);
            }}
          >
            {buttonProps.children}
          </button>
          <button 
            onClick={event => {
              event.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className={`flex size-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-white/5 hover:text-white`}
          >
            {isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-1 space-y-4 border-t border-white/5 px-6 pb-6 pt-2 duration-200">
          {providerConfig.type === ProviderTypeEnum.CustomOpenAI && (
            <div className="space-y-1.5">
              <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Identity</div>
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
            <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">
              {providerConfig.type === ProviderTypeEnum.Bedrock ? 'Access Key ID' : 'Access Key'}
            </div>
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
              <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">AWS Region</div>
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
              <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Secret Access Key</div>
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

          {providerConfig.type === ProviderTypeEnum.Bedrock && (
            <div className="space-y-1.5">
              <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Session Token (Optional)</div>
              <div className="group relative">
                <input
                  type={visibleApiKeys[`${providerId}-session`] ? 'text' : 'password'}
                  className={`w-full rounded-xl border px-4 py-3 font-mono text-xs font-bold outline-none transition-all focus:ring-1 focus:ring-indigo-500 ${isDark ? 'border-white/10 bg-white/5 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}
                  placeholder="For temporary STS credentials only"
                  value={providerConfig.bedrockSessionToken || ''}
                  onChange={e => handleSessionTokenChange(providerId, e.target.value)}
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30 transition-opacity hover:opacity-100"
                  onClick={() => toggleApiKeyVisibility(`${providerId}-session`)}
                >
                  {visibleApiKeys[`${providerId}-session`] ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                </button>
              </div>
              <div className="mt-1 text-[10px] text-slate-400 opacity-60">
                For temporary STS credentials only.
              </div>
            </div>
          )}

          {(providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
            providerConfig.type === ProviderTypeEnum.Ollama ||
            providerConfig.type === ProviderTypeEnum.AzureOpenAI ||
            providerConfig.type === ProviderTypeEnum.OpenRouter ||
            providerConfig.type === ProviderTypeEnum.Gemini ||
            providerConfig.type === ProviderTypeEnum.VertexAI ||
            providerConfig.type === ProviderTypeEnum.Llama) && (
              <div className="space-y-1.5">
                <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Base Endpoint</div>
                <input
                  type="text"
                  className={`w-full rounded-xl border px-4 py-3 font-mono text-xs font-bold outline-none transition-all focus:ring-1 focus:ring-indigo-500 ${isDark ? 'border-white/10 bg-white/5 text-white' : 'border-slate-200 bg-slate-50 text-slate-900'}`}
                  placeholder={
                    providerConfig.type === ProviderTypeEnum.Gemini || providerConfig.type === ProviderTypeEnum.VertexAI
                      ? "https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1"
                      : "https://api.example.com/v1"
                  }
                  value={providerConfig.baseUrl || ''}
                  onChange={e => handleApiKeyChange(providerId, providerConfig.apiKey || '', e.target.value)}
                />
              </div>
            )}

          {providerConfig.type !== ProviderTypeEnum.AzureOpenAI && (
            <div className="mt-6 space-y-3">
              <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-40">Intelligence Matrix</div>
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
      )}
    </div>
  );
};

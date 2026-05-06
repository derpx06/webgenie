import React from 'react';
import { FiCpu, FiCheck } from 'react-icons/fi';
import { ProviderTypeEnum, getDefaultDisplayNameFromProviderId } from '@extension/storage';

interface ProviderSelectorProps {
  isDarkMode: boolean;
  isProviderSelectorOpen: boolean;
  setIsProviderSelectorOpen: (open: boolean) => void;
  providersFromStorage: Set<string>;
  modifiedProviders: Set<string>;
  handleProviderSelection: (type: ProviderTypeEnum) => void;
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  isDarkMode,
  isProviderSelectorOpen,
  setIsProviderSelectorOpen,
  providersFromStorage,
  modifiedProviders,
  handleProviderSelection,
}) => {
  if (!isProviderSelectorOpen) return null;

  return (
    <div className={`animate-in fade-in zoom-in-95 absolute right-0 z-[999] mt-4 w-80 overflow-hidden rounded-[2.5rem] border p-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-3xl duration-300 ${isDarkMode ? 'border-white/10 bg-slate-900/90' : 'border-slate-200 bg-white/95'
      }`}>
      <div className="mb-4 px-4 py-2">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Select Neural Architecture</p>
      </div>
      <div className="grid grid-cols-1 gap-1">
        {Object.values(ProviderTypeEnum)
          .filter(type => type !== ProviderTypeEnum.CustomOpenAI)
          .map(type => {
            const isAdded = providersFromStorage.has(type) || modifiedProviders.has(type);
            const isAzure = type === ProviderTypeEnum.AzureOpenAI;
            return (
              <button
                key={type}
                onClick={() => handleProviderSelection(type)}
                className={`flex w-full items-center justify-between rounded-2xl px-5 py-4 text-[14px] font-bold transition-all duration-200 ${isDarkMode
                  ? 'text-slate-300 hover:bg-white/5 hover:text-white hover:shadow-lg'
                  : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-600'
                  } ${isAdded && !isAzure ? 'cursor-not-allowed opacity-30' : ''}`}
                disabled={isAdded && !isAzure}
              >
                <span className="flex items-center gap-3">
                  <div className={`size-2 rounded-full ${isAdded && !isAzure ? 'bg-slate-500' : 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]'}`}></div>
                  {getDefaultDisplayNameFromProviderId(type)}
                </span>
                {isAdded && !isAzure && <FiCheck size={14} className="text-emerald-500" />}
              </button>
            );
          })}
      </div>
      <div className="my-4 border-t border-white/5"></div>
      <button
        onClick={() => handleProviderSelection(ProviderTypeEnum.CustomOpenAI)}
        className={`flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left text-[14px] font-bold transition-all duration-200 ${isDarkMode ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'
          }`}
      >
        <FiCpu size={16} />
        Custom OpenAI Compatible
      </button>
    </div>
  );
};

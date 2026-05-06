import React from 'react';
import { FiTrendingUp, FiChevronDown } from 'react-icons/fi';
import { ProviderTypeEnum, type ProviderConfig } from '@extension/storage';

interface VocalIntelligenceCardProps {
  isDarkMode: boolean;
  selectedSpeechToTextModel: string;
  availableModels: Array<{ provider: string; providerName: string; model: string }>;
  providers: Record<string, ProviderConfig>;
  handleSpeechToTextModelChange: (value: string) => void;
}

export const VocalIntelligenceCard: React.FC<VocalIntelligenceCardProps> = ({
  isDarkMode,
  selectedSpeechToTextModel,
  availableModels,
  providers,
  handleSpeechToTextModelChange,
}) => {
  return (
    <section className={`group overflow-hidden rounded-[2.5rem] border transition-all duration-500 hover:shadow-2xl ${isDarkMode ? 'border-emerald-500/20 bg-emerald-500/5 shadow-2xl backdrop-blur-3xl' : 'border-slate-200 bg-white shadow-xl'
      }`}>
      <div className={`flex items-center gap-6 border-b px-10 py-8 ${isDarkMode ? 'border-white/5 bg-white/5' : 'border-slate-100 bg-slate-50/50'}`}>
        <div className={`flex size-14 items-center justify-center rounded-2xl shadow-inner ${isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-600'
          }`}>
          <FiTrendingUp size={24} />
        </div>
        <div>
          <h2 className={`font-outfit text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Vocal Intelligence</h2>
          <p className={`mt-1 text-[13px] font-medium ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
            Real-time speech analysis
          </p>
        </div>
      </div>
      <div className="p-10">
        <div className="space-y-4">
          <label className="text-[11px] font-black uppercase tracking-[0.2em] opacity-40">Primary Audio Processor</label>
          <div className="group/sel relative">
            <select
              className={`w-full cursor-pointer appearance-none rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-bold outline-none transition-all focus:ring-2 focus:ring-emerald-500 ${isDarkMode ? 'text-white' : 'text-slate-900'
                }`}
              value={selectedSpeechToTextModel}
              onChange={e => handleSpeechToTextModelChange(e.target.value)}
            >
              <option value="" className="bg-[#1a1c23]">Disable Voice Command</option>
              {availableModels
                .filter(({ provider }) => providers[provider]?.type === ProviderTypeEnum.Gemini)
                .map(({ provider, providerName, model }) => (
                  <option key={`${provider}>${model}`} value={`${provider}>${model}`} className="bg-[#1a1c23]">
                    {`${providerName} | ${model}`}
                  </option>
                ))}
            </select>
            <FiChevronDown className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 opacity-40 transition-opacity group-hover/sel:opacity-100" />
          </div>
        </div>
      </div>
    </section>
  );
};

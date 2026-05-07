import React from 'react';
import { FiMic, FiChevronDown } from 'react-icons/fi';
import { ProviderTypeEnum, type ProviderConfig } from '@extension/storage';
import { DashboardSection } from '../shared/DashboardSection';

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
    <DashboardSection
      title="Speech Processing"
      subtitle="Voice-to-text integration"
      icon={<FiMic size={20} />}
      isDarkMode={isDarkMode}
      colorTheme="slate"
      contentClassName="p-6"
    >
      <div className="space-y-4">
        <label className="text-[9px] font-bold uppercase tracking-[0.1em] opacity-40">Primary Audio Engine</label>
        <div className="group/sel relative">
          <select
            className={`w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold outline-none transition-all focus:ring-2 focus:ring-indigo-500 ${isDarkMode ? 'text-white' : 'text-slate-900'
              }`}
            value={selectedSpeechToTextModel}
            onChange={e => handleSpeechToTextModelChange(e.target.value)}
          >
            <option value="" className="bg-[#1a1c23]">Disabled</option>
            {availableModels
              .filter(({ provider }) => providers[provider]?.type === ProviderTypeEnum.Gemini)
              .map(({ provider, providerName, model }) => (
                <option key={`${provider}>${model}`} value={`${provider}>${model}`} className="bg-[#1a1c23]">
                  {`${providerName} | ${model}`}
                </option>
              ))}
          </select>
          <FiChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 opacity-40 transition-opacity group-hover/sel:opacity-100" />
        </div>
      </div>
    </DashboardSection>
  );
};

import React from 'react';
import { FiChevronDown } from 'react-icons/fi';
import { AgentNameEnum } from '@extension/storage';
import { isOpenAIReasoningModel, isAnthropicModel, getAgentDescription } from './ModelSettingsUtils';

interface AgentCalibrationCardProps {
  agentName: AgentNameEnum;
  isDarkMode: boolean;
  availableModels: Array<{ provider: string; providerName: string; model: string }>;
  selectedModels: Record<AgentNameEnum, string>;
  modelParameters: Record<AgentNameEnum, { temperature: number; topP: number }>;
  reasoningEffort: Record<AgentNameEnum, 'minimal' | 'low' | 'medium' | 'high' | undefined>;
  handleModelChange: (agentName: AgentNameEnum, value: string) => void;
  handleParameterChange: (agentName: AgentNameEnum, param: 'temperature' | 'topP', value: number) => void;
  handleReasoningEffortChange: (agentName: AgentNameEnum, effort: 'minimal' | 'low' | 'medium' | 'high') => void;
}

const getFriendlyBedrockName = (modelId: string): string => {
  if (modelId.includes('claude-3-5-sonnet-20241022') || modelId.includes('claude-3-5-sonnet-v2')) return 'Anthropic Claude 3.5 Sonnet (v2)';
  if (modelId.includes('claude-3-5-sonnet-20240620') || modelId.includes('claude-3-5-sonnet-v1')) return 'Anthropic Claude 3.5 Sonnet (v1)';
  if (modelId.includes('claude-3-5-haiku')) return 'Anthropic Claude 3.5 Haiku';
  if (modelId.includes('claude-3-opus')) return 'Anthropic Claude 3 Opus';
  if (modelId.includes('claude-3-sonnet')) return 'Anthropic Claude 3 Sonnet';
  if (modelId.includes('claude-3-haiku')) return 'Anthropic Claude 3 Haiku';
  if (modelId.includes('meta.llama3')) return 'Meta Llama 3';
  if (modelId.includes('cohere.command')) return 'Cohere Command';
  return modelId;
};

export const AgentCalibrationCard: React.FC<AgentCalibrationCardProps> = ({
  agentName,
  isDarkMode,
  availableModels,
  selectedModels,
  modelParameters,
  reasoningEffort,
  handleModelChange,
  handleParameterChange,
  handleReasoningEffortChange,
}) => {
  const isPlanner = agentName === AgentNameEnum.Planner;
  const isDark = isDarkMode;

  const currentSelectedValue = selectedModels[agentName] || '';
  const isBedrock = currentSelectedValue.startsWith('bedrock>');
  const bedrockArn = isBedrock ? currentSelectedValue.split('>')[1] : '';

  return (
    <div className={`group/agent relative overflow-hidden rounded-2xl border transition-all duration-300 ${isDark ? 'border-white/5 bg-white/[0.02]' : 'border-slate-200 bg-white'
      } p-6`}>
      <div className="mb-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-3">
          <div className={`w-fit rounded-lg px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${isPlanner
            ? (isDark ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-50 text-indigo-700')
            : (isDark ? 'bg-slate-500/10 text-slate-400' : 'bg-slate-100 text-slate-700')
            }`}>
            {isPlanner ? 'Planning Model' : 'Execution Model'}
          </div>
          <h3 className={`font-outfit text-xl font-bold tracking-tight ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            {isPlanner ? 'Primary Model' : 'Automation Model'}
          </h3>
        </div>
        <div className={`max-w-xs text-[13px] font-medium leading-relaxed opacity-60 ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
          {getAgentDescription(agentName)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {/* Model Selection Field */}
        <div className={`group/field relative rounded-xl border p-4 transition-all duration-200 ${isDark ? 'border-white/5 bg-black/20 focus-within:border-indigo-500/30' : 'border-slate-200 bg-slate-50 focus-within:border-indigo-300'
          }`}>
          <div className="mb-2 ml-1 block text-[9px] font-bold uppercase tracking-widest opacity-40">Selected Model</div>
          <div className="relative">
            <select
              className={`w-full cursor-pointer appearance-none bg-transparent pr-10 text-sm font-semibold outline-none focus:ring-0 ${isDark ? 'text-white' : 'text-slate-900'
                }`}
              disabled={availableModels.length === 0}
              value={currentSelectedValue}
              onChange={e => handleModelChange(agentName, e.target.value)}
            >
              <option value="" className="bg-[#1a1c23]">Unassigned</option>
              {availableModels.map(({ provider, providerName, model }) => {
                const displayName = provider === 'bedrock' 
                  ? `${providerName} | ${getFriendlyBedrockName(model)}` 
                  : `${providerName} | ${model}`;
                return (
                  <option key={`${provider}>${model}`} value={`${provider}>${model}`} className="bg-[#1a1c23]">
                    {displayName}
                  </option>
                );
              })}
            </select>
            <FiChevronDown className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 opacity-40 transition-transform group-hover/field:scale-110" />
          </div>
          {isBedrock && (
            <div className="mt-2 border-t border-white/5 px-1 pt-1 font-mono text-[10px] opacity-50">
              ARN: <span className="select-all">{bedrockArn}</span>
            </div>
          )}
        </div>

        {/* Parameters Grid */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {selectedModels[agentName] && !isOpenAIReasoningModel(selectedModels[agentName]) && (
            <div className={`rounded-xl border p-4 ${isDark ? 'border-white/5 bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[9px] font-bold uppercase tracking-widest opacity-40">Temperature</div>
                <span className={`font-mono text-[11px] font-bold ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                  {modelParameters[agentName].temperature.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={modelParameters[agentName].temperature}
                className="unified-slider cursor-pointer"
                onChange={e => handleParameterChange(agentName, 'temperature', parseFloat(e.target.value))}
              />
            </div>
          )}

          {selectedModels[agentName] &&
            !isOpenAIReasoningModel(selectedModels[agentName]) &&
            !isAnthropicModel(selectedModels[agentName]) && (
              <div className={`rounded-xl border p-4 ${isDark ? 'border-white/5 bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[9px] font-bold uppercase tracking-widest opacity-40">Top P</div>
                  <span className={`font-mono text-[11px] font-bold ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                    {modelParameters[agentName].topP.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={modelParameters[agentName].topP}
                  className="unified-slider cursor-pointer"
                  onChange={e => handleParameterChange(agentName, 'topP', parseFloat(e.target.value))}
                />
              </div>
            )}

          {/* Reasoning Effort (O-series models) */}
          {selectedModels[agentName] && isOpenAIReasoningModel(selectedModels[agentName]) && (
            <div className={`col-span-1 rounded-xl border p-4 md:col-span-2 ${isDark ? 'border-white/5 bg-black/20' : 'border-slate-200 bg-slate-50'}`}>
              <div className="mb-3 block text-[9px] font-bold uppercase tracking-widest opacity-40">Reasoning Effort</div>
              <div className="flex gap-2">
                {(['minimal', 'low', 'medium', 'high'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => handleReasoningEffortChange(agentName, level)}
                    className={`flex-1 rounded-lg py-2 text-[10px] font-bold uppercase tracking-tight transition-all duration-200 ${(reasoningEffort[agentName] || (agentName === AgentNameEnum.Planner ? 'low' : 'minimal')) === level
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                      : isDarkMode ? 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300' : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                      }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

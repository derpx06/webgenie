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

  return (
    <div className={`group/agent relative overflow-hidden rounded-[2.5rem] border transition-all duration-500 hover:scale-[1.01] ${isDark ? 'border-white/5 bg-white/[0.02] shadow-2xl' : 'border-slate-200 bg-slate-50 shadow-lg'
      } mb-6 p-10`}>
      <div className="mb-10 flex flex-col justify-between gap-8 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-4">
          <div className={`w-fit rounded-full px-5 py-2 text-[11px] font-black uppercase tracking-[0.3em] shadow-lg ${isPlanner
            ? (isDark ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30' : 'bg-indigo-100 text-indigo-700')
            : (isDark ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30' : 'bg-cyan-100 text-cyan-700')
            }`}>
            {isPlanner ? 'Strategic Planner' : 'Execution Navigator'}
          </div>
          <h3 className={`font-outfit text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {isPlanner ? 'Neural Core' : 'Tactical Unit'}
          </h3>
        </div>
        <div className={`max-w-xs text-[14px] font-medium leading-relaxed opacity-70 ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
          {getAgentDescription(agentName)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Model Selection Field */}
        <div className={`group/field relative rounded-2xl border p-6 transition-all duration-300 ${isDark ? 'border-white/5 bg-black/20 hover:border-indigo-500/30' : 'border-slate-200 bg-white shadow-sm hover:border-indigo-300'
          }`}>
          <label className="mb-3 ml-1 block text-[10px] font-black uppercase tracking-widest opacity-40">Assigned Neural Model</label>
          <div className="relative">
            <select
              className={`w-full cursor-pointer appearance-none bg-transparent pr-10 text-sm font-bold outline-none focus:ring-0 ${isDark ? 'text-white' : 'text-slate-900'
                }`}
              disabled={availableModels.length === 0}
              value={selectedModels[agentName] || ''}
              onChange={e => handleModelChange(agentName, e.target.value)}
            >
              <option value="" className="bg-[#1a1c23]">Unassigned</option>
              {availableModels.map(({ provider, providerName, model }) => (
                <option key={`${provider}>${model}`} value={`${provider}>${model}`} className="bg-[#1a1c23]">
                  {`${providerName} | ${model}`}
                </option>
              ))}
            </select>
            <FiChevronDown className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 opacity-40 transition-transform group-hover/field:scale-110" />
          </div>
        </div>

        {/* Parameters Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {selectedModels[agentName] && !isOpenAIReasoningModel(selectedModels[agentName]) && (
            <div className={`rounded-2xl border p-6 ${isDark ? 'border-white/5 bg-black/20' : 'border-slate-200 bg-white shadow-sm'}`}>
              <div className="mb-4 flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">Creativity (Temp)</label>
                <span className={`font-mono text-xs font-black ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>
                  {modelParameters[agentName].temperature.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={modelParameters[agentName].temperature}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-indigo-500/10 accent-indigo-500"
                onChange={e => handleParameterChange(agentName, 'temperature', parseFloat(e.target.value))}
              />
            </div>
          )}

          {selectedModels[agentName] &&
            !isOpenAIReasoningModel(selectedModels[agentName]) &&
            !isAnthropicModel(selectedModels[agentName]) && (
              <div className={`rounded-2xl border p-6 ${isDark ? 'border-white/5 bg-black/20' : 'border-slate-200 bg-white shadow-sm'}`}>
                <div className="mb-4 flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest opacity-40">Nucleus Sampling (TopP)</label>
                  <span className={`font-mono text-xs font-black ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
                    {modelParameters[agentName].topP.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={modelParameters[agentName].topP}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-cyan-500/10 accent-cyan-500"
                  onChange={e => handleParameterChange(agentName, 'topP', parseFloat(e.target.value))}
                />
              </div>
            )}

          {/* Reasoning Effort (O-series models) */}
          {selectedModels[agentName] && isOpenAIReasoningModel(selectedModels[agentName]) && (
            <div className={`col-span-1 rounded-2xl border p-6 md:col-span-2 ${isDark ? 'border-white/5 bg-black/20' : 'border-slate-200 bg-white shadow-sm'}`}>
              <label className="mb-4 block text-[10px] font-black uppercase tracking-widest opacity-40">Cognitive Effort</label>
              <div className="flex gap-2">
                {(['minimal', 'low', 'medium', 'high'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => handleReasoningEffortChange(agentName, level)}
                    className={`flex-1 rounded-xl py-3 text-xs font-black uppercase tracking-tighter transition-all duration-300 ${(reasoningEffort[agentName] || (agentName === AgentNameEnum.Planner ? 'low' : 'minimal')) === level
                      ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-indigo-400/50'
                      : isDarkMode ? 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
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

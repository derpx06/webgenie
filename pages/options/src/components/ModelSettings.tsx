import React from 'react';
import { FiCpu, FiShield } from 'react-icons/fi';
import { AgentNameEnum } from '@extension/storage';
import { useModelSettings } from './model-settings/useModelSettings';
import { AgentCalibrationCard } from './model-settings/AgentCalibrationCard';
import { ProviderSelector } from './model-settings/ProviderSelector';
import { ProviderCard } from './model-settings/ProviderCard';
import { VocalIntelligenceCard } from './model-settings/VocalIntelligenceCard';

import { DashboardSection } from './shared/DashboardSection';

interface ModelSettingsProps {
  isDarkMode?: boolean;
}

export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
  const {
    isProviderSelectorOpen,
    setIsProviderSelectorOpen,
    providersFromStorage,
    modifiedProviders,
    handleProviderSelection,
    getSortedProviders,
    visibleApiKeys,
    newModelInputs,
    getButtonProps,
    handleDelete,
    handleSave,
    handleNameChange,
    handleApiKeyChange,
    toggleApiKeyVisibility,
    removeModel,
    addModel,
    handleModelsChange,
    availableModels,
    selectedModels,
    modelParameters,
    reasoningEffort,
    handleModelChange,
    handleParameterChange,
    handleReasoningEffortChange,
    selectedSpeechToTextModel,
    handleSpeechToTextModelChange,
    providers,
  } = useModelSettings(isDarkMode);

  return (
    <div className={`grid grid-cols-1 xl:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>

      {/* LEFT COLUMN: AGENT CALIBRATION (7 COLUMNS) */}
      <div className="xl:col-span-7 space-y-8">
        <DashboardSection
          title="Agent Calibration"
          subtitle="Assigned cognitive roles and parameter tuning"
          icon={<FiShield size={24} />}
          isDarkMode={isDarkMode}
          colorTheme="violet"
          contentClassName="space-y-6 p-8"
        >
          <AgentCalibrationCard
            agentName={AgentNameEnum.Planner}
            isDarkMode={isDarkMode}
            availableModels={availableModels}
            selectedModels={selectedModels}
            modelParameters={modelParameters}
            reasoningEffort={reasoningEffort}
            handleModelChange={handleModelChange}
            handleParameterChange={handleParameterChange}
            handleReasoningEffortChange={handleReasoningEffortChange}
          />
          <AgentCalibrationCard
            agentName={AgentNameEnum.Navigator}
            isDarkMode={isDarkMode}
            availableModels={availableModels}
            selectedModels={selectedModels}
            modelParameters={modelParameters}
            reasoningEffort={reasoningEffort}
            handleModelChange={handleModelChange}
            handleParameterChange={handleParameterChange}
            handleReasoningEffortChange={handleReasoningEffortChange}
          />
        </DashboardSection>
      </div>

      {/* RIGHT COLUMN: INTELLIGENCE NODES & VOCAL (5 COLUMNS) */}
      <div className="xl:col-span-5 space-y-8">
        <div className="flex items-center justify-between px-2">
          <div>
            <h2 className="font-outfit text-2xl font-black tracking-tight">Intelligence Nodes</h2>
            <p className={`mt-1 text-[11px] font-black uppercase tracking-wider ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
              Neural Configurations
            </p>
          </div>

          <div className="group/add provider-selector-container relative">
            <button
              onClick={() => setIsProviderSelectorOpen(!isProviderSelectorOpen)}
              className={`flex size-10 items-center justify-center rounded-xl shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 ${isDarkMode ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              title="Add New Provider"
            >
              <FiCpu size={18} />
            </button>

            <ProviderSelector
              isDarkMode={isDarkMode}
              isProviderSelectorOpen={isProviderSelectorOpen}
              setIsProviderSelectorOpen={setIsProviderSelectorOpen}
              providersFromStorage={providersFromStorage}
              modifiedProviders={modifiedProviders}
              handleProviderSelection={handleProviderSelection}
            />
          </div>
        </div>

        <DashboardSection
          title="Intelligence Matrix"
          subtitle="Neural connection protocols"
          icon={<FiCpu size={24} />}
          isDarkMode={isDarkMode}
          colorTheme="slate"
          isOverflowVisible={true}
          contentClassName="divide-y divide-white/[0.03]"
        >
          {getSortedProviders().length === 0 ? (
            <div className="p-16 text-center">
              <div className="mb-6 inline-flex size-16 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500">
                <FiCpu size={24} />
              </div>
              <h3 className="mb-2 text-lg font-bold">No Active Nodes</h3>
              <p className={`mx-auto max-w-xs text-xs opacity-50 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                Connect an AI provider to enable autonomous capabilities.
              </p>
            </div>
          ) : (
            getSortedProviders().map(([providerId, providerConfig]) => (
              <ProviderCard
                key={providerId}
                providerId={providerId}
                providerConfig={providerConfig}
                isDarkMode={isDarkMode}
                isInStorage={providersFromStorage.has(providerId)}
                isModified={modifiedProviders.has(providerId)}
                visibleApiKeys={visibleApiKeys}
                newModelInputs={newModelInputs}
                getButtonProps={getButtonProps}
                handleDelete={handleDelete}
                handleSave={handleSave}
                handleNameChange={handleNameChange}
                handleApiKeyChange={handleApiKeyChange}
                toggleApiKeyVisibility={toggleApiKeyVisibility}
                removeModel={removeModel}
                addModel={addModel}
                handleModelsChange={handleModelsChange}
              />
            ))
          )}
        </DashboardSection>

        <VocalIntelligenceCard
          isDarkMode={isDarkMode}
          selectedSpeechToTextModel={selectedSpeechToTextModel}
          availableModels={availableModels}
          providers={providers}
          handleSpeechToTextModelChange={handleSpeechToTextModelChange}
        />
      </div>
    </div>
  );
};

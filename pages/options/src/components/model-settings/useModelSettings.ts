import { useEffect, useState, useRef, useCallback } from 'react';
import {
  llmProviderStore,
  agentModelStore,
  speechToTextModelStore,
  AgentNameEnum,
  llmProviderModelNames,
  ProviderTypeEnum,
  getDefaultDisplayNameFromProviderId,
  getDefaultAgentModelParams,
  getDefaultProviderConfig,
  getProviderTypeByProviderId,
  type ProviderConfig,
} from '@extension/storage';
import { isOpenAIReasoningModel, isAnthropicModel } from './ModelSettingsUtils';
import { t } from '@extension/i18n';

export const useModelSettings = (isDarkMode: boolean) => {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [modifiedProviders, setModifiedProviders] = useState<Set<string>>(new Set());
  const [providersFromStorage, setProvidersFromStorage] = useState<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Record<AgentNameEnum, string>>({
    [AgentNameEnum.Navigator]: '',
    [AgentNameEnum.Planner]: '',
  });
  const [modelParameters, setModelParameters] = useState<Record<AgentNameEnum, { temperature: number; topP: number }>>({
    [AgentNameEnum.Navigator]: { temperature: 0, topP: 0 },
    [AgentNameEnum.Planner]: { temperature: 0, topP: 0 },
  });

  const [reasoningEffort, setReasoningEffort] = useState<
    Record<AgentNameEnum, 'minimal' | 'low' | 'medium' | 'high' | undefined>
  >({
    [AgentNameEnum.Navigator]: undefined,
    [AgentNameEnum.Planner]: undefined,
  });
  const [newModelInputs, setNewModelInputs] = useState<Record<string, string>>({});
  const [isProviderSelectorOpen, setIsProviderSelectorOpen] = useState(false);
  const newlyAddedProviderRef = useRef<string | null>(null);
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>({});
  const [availableModels, setAvailableModels] = useState<
    Array<{ provider: string; providerName: string; model: string }>
  >([]);
  const [selectedSpeechToTextModel, setSelectedSpeechToTextModel] = useState<string>('');

  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === 'string' && error.trim()) {
      return error;
    }
    return 'Failed to save provider configuration. Please verify your settings and try again.';
  };

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const allProviders = await llmProviderStore.getAllProviders();
        const migrationProviders = { ...allProviders };
        Object.keys(migrationProviders).forEach(id => {
          if (!migrationProviders[id].type) {
            migrationProviders[id].type = getProviderTypeByProviderId(id);
          }
        });

        const fromStorage = new Set(Object.keys(migrationProviders));
        setProvidersFromStorage(fromStorage);

        setProviders(prev => ({
          ...migrationProviders,
          ...prev,
        }));
      } catch (error) {
        console.error('Error loading providers:', error);
        setProvidersFromStorage(new Set());
      }
    };

    loadProviders();
  }, []);

  useEffect(() => {
    const loadAgentModels = async () => {
      try {
        const models: Record<AgentNameEnum, string> = {
          [AgentNameEnum.Planner]: '',
          [AgentNameEnum.Navigator]: '',
        };

        for (const agent of Object.values(AgentNameEnum)) {
          const config = await agentModelStore.getAgentModel(agent);
          if (config) {
            models[agent] = `${config.provider}>${config.modelName}`;
            if (config.parameters?.temperature !== undefined || config.parameters?.topP !== undefined) {
              setModelParameters(prev => ({
                ...prev,
                [agent]: {
                  temperature: config.parameters?.temperature ?? prev[agent].temperature,
                  topP: config.parameters?.topP ?? prev[agent].topP,
                },
              }));
            }
            if (config.reasoningEffort) {
              setReasoningEffort(prev => ({
                ...prev,
                [agent]: config.reasoningEffort as 'minimal' | 'low' | 'medium' | 'high',
              }));
            }
          }
        }
        setSelectedModels(models);
      } catch (error) {
        console.error('Error loading agent models:', error);
      }
    };

    loadAgentModels();
  }, []);

  useEffect(() => {
    const loadSpeechToTextModel = async () => {
      try {
        const config = await speechToTextModelStore.getSpeechToTextModel();
        if (config) {
          setSelectedSpeechToTextModel(`${config.provider}>${config.modelName}`);
        }
      } catch (error) {
        console.error('Error loading speech-to-text model:', error);
      }
    };

    loadSpeechToTextModel();
  }, []);

  useEffect(() => {
    if (newlyAddedProviderRef.current && providers[newlyAddedProviderRef.current]) {
      const providerId = newlyAddedProviderRef.current;
      const config = providers[providerId];

      if (config.type === ProviderTypeEnum.CustomOpenAI) {
        const nameInput = document.getElementById(`${providerId}-name`);
        if (nameInput) nameInput.focus();
      } else {
        const apiKeyInput = document.getElementById(`${providerId}-api-key`);
        if (apiKeyInput) apiKeyInput.focus();
      }
      newlyAddedProviderRef.current = null;
    }
  }, [providers]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isProviderSelectorOpen && !target.closest('.provider-selector-container')) {
        setIsProviderSelectorOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProviderSelectorOpen]);

  const getAvailableModelsCallback = useCallback(async () => {
    const models: Array<{ provider: string; providerName: string; model: string }> = [];
    try {
      const storedProviders = await llmProviderStore.getAllProviders();
      for (const [provider, config] of Object.entries(storedProviders)) {
        if (config.type === ProviderTypeEnum.AzureOpenAI) {
          const deploymentNames = config.azureDeploymentNames || [];
          models.push(...deploymentNames.map(deployment => ({
            provider,
            providerName: config.name || provider,
            model: deployment,
          })));
        } else {
          const providerModels = config.modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
          models.push(...providerModels.map(model => ({
            provider,
            providerName: config.name || provider,
            model,
          })));
        }
      }
    } catch (error) {
      console.error('Error loading providers for model selection:', error);
    }
    return models;
  }, []);

  useEffect(() => {
    const updateAvailableModels = async () => {
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    };
    updateAvailableModels();
  }, [getAvailableModelsCallback]);

  const handleApiKeyChange = (provider: string, apiKey: string, baseUrl?: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        apiKey: apiKey.trim(),
        baseUrl: baseUrl !== undefined ? baseUrl.trim() : prev[provider]?.baseUrl,
      },
    }));
  };

  const handleRegionChange = (provider: string, region: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        region: region.trim(),
      },
    }));
  };

  const handleSecretKeyChange = (provider: string, secretKey: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        bedrockSecretKey: secretKey.trim(),
      },
    }));
  };

  const toggleApiKeyVisibility = (provider: string) => {
    setVisibleApiKeys(prev => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const handleNameChange = (provider: string, name: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        name: name.trim(),
      },
    }));
  };

  const handleModelsChange = (provider: string, modelsString: string) => {
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: modelsString,
    }));
  };

  const addModel = (provider: string, model: string) => {
    if (!model.trim()) return;
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const providerData = prev[provider] || {};
      let currentModels = providerData.modelNames;
      if (currentModels === undefined) {
        currentModels = [...(llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [])];
      }
      if (currentModels.includes(model.trim())) return prev;
      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: [...currentModels, model.trim()],
        },
      };
    });
    setNewModelInputs(prev => ({ ...prev, [provider]: '' }));
  };

  const removeModel = (provider: string, modelToRemove: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const providerData = prev[provider] || {};
      if (!providerData.modelNames) {
        const defaultModels = llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
        const filteredModels = defaultModels.filter(model => model !== modelToRemove);
        return {
          ...prev,
          [provider]: { ...providerData, modelNames: filteredModels },
        };
      }
      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: providerData.modelNames.filter(model => model !== modelToRemove),
        },
      };
    });
  };

  const getButtonProps = (provider: string) => {
    const isInStorage = providersFromStorage.has(provider);
    const isModified = modifiedProviders.has(provider);

    if (isInStorage && !isModified) {
      return {
        variant: 'danger',
        children: t('options_models_providers_btnDelete'),
        disabled: false,
      };
    }

    let hasInput = false;
    const config = providers[provider];
    const providerType = config?.type;

    if (providerType === ProviderTypeEnum.CustomOpenAI || providerType === ProviderTypeEnum.Ollama) {
      hasInput = Boolean(config?.baseUrl?.trim());
    } else if (providerType === ProviderTypeEnum.AzureOpenAI) {
      hasInput = Boolean(config?.apiKey?.trim()) && Boolean(config?.baseUrl?.trim()) && Boolean(config?.azureDeploymentNames?.length) && Boolean(config?.azureApiVersion?.trim());
    } else if (providerType === ProviderTypeEnum.OpenRouter || providerType === ProviderTypeEnum.Llama) {
      hasInput = Boolean(config?.apiKey?.trim()) && Boolean(config?.baseUrl?.trim());
    } else if (providerType === ProviderTypeEnum.Bedrock) {
      hasInput = Boolean(config?.apiKey?.trim()) && Boolean(config?.region?.trim()) && Boolean(config?.bedrockSecretKey?.trim());
    } else {
      hasInput = Boolean(config?.apiKey?.trim());
    }

    return {
      variant: 'primary',
      children: t('options_models_providers_btnSave'),
      disabled: !hasInput || !isModified,
    };
  };

  const handleSave = async (provider: string) => {
    try {
      // Spaces are now allowed in custom provider names as we use stable unique IDs

      if (
        (providers[provider].type === ProviderTypeEnum.CustomOpenAI ||
          providers[provider].type === ProviderTypeEnum.Ollama ||
          providers[provider].type === ProviderTypeEnum.AzureOpenAI ||
          providers[provider].type === ProviderTypeEnum.OpenRouter ||
          providers[provider].type === ProviderTypeEnum.Llama) &&
        (!providers[provider].baseUrl || !providers[provider].baseUrl.trim())
      ) {
        alert(t('options_models_providers_errors_baseUrlRequired', getDefaultDisplayNameFromProviderId(provider)));
        return;
      }

      const configToSave: ProviderConfig = {
        ...providers[provider],
        apiKey: providers[provider].apiKey || '',
        name: providers[provider].name || getDefaultDisplayNameFromProviderId(provider),
        type: providers[provider].type as ProviderTypeEnum,
        createdAt: providers[provider].createdAt || Date.now(),
      };

      if (configToSave.type === ProviderTypeEnum.AzureOpenAI) {
        configToSave.modelNames = undefined;
      } else {
        configToSave.modelNames = providers[provider].modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
      }

      await llmProviderStore.setProvider(provider, configToSave);
      setNameErrors(prev => { const n = { ...prev }; delete n[provider]; return n; });
      setProvidersFromStorage(prev => new Set(prev).add(provider));
      setModifiedProviders(prev => { const n = new Set(prev); n.delete(provider); return n; });
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    } catch (error) {
      console.error('Error saving API key:', error);
      alert(getErrorMessage(error));
    }
  };

  const handleDelete = async (provider: string) => {
    try {
      await llmProviderStore.removeProvider(provider);
      setProvidersFromStorage(prev => { const n = new Set(prev); n.delete(provider); return n; });
      setProviders(prev => { const n = { ...prev }; delete n[provider]; return n; });
      setModifiedProviders(prev => { const n = new Set(prev); n.delete(provider); return n; });
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    } catch (error) {
      console.error('Error deleting provider:', error);
    }
  };

  const handleProviderSelection = (type: ProviderTypeEnum) => {
    const providerId = type === ProviderTypeEnum.CustomOpenAI ? `custom_${Date.now()}` : type;
    newlyAddedProviderRef.current = providerId;
    setProviders(prev => ({
      ...prev,
      [providerId]: {
        ...getDefaultProviderConfig(type),
        type,
        name: type === ProviderTypeEnum.CustomOpenAI ? '' : getDefaultDisplayNameFromProviderId(type),
      },
    }));
    setModifiedProviders(prev => new Set(prev).add(providerId));
    setIsProviderSelectorOpen(false);
  };

  const handleModelChange = async (agentName: AgentNameEnum, modelValue: string) => {
    const [provider, model] = modelValue.split('>');
    const newParameters = getDefaultAgentModelParams(provider, agentName);
    setModelParameters(prev => ({ ...prev, [agentName]: newParameters }));
    setSelectedModels(prev => ({ ...prev, [agentName]: modelValue }));

    try {
      if (model) {
        if (isOpenAIReasoningModel(modelValue)) {
          const defaultReasoningEffort = agentName === AgentNameEnum.Planner ? 'low' : 'minimal';
          setReasoningEffort(prev => ({ ...prev, [agentName]: prev[agentName] || defaultReasoningEffort }));
        } else {
          setReasoningEffort(prev => ({ ...prev, [agentName]: undefined }));
        }

        const parametersToSave = isAnthropicModel(modelValue) ? { temperature: newParameters.temperature } : newParameters;
        await agentModelStore.setAgentModel(agentName, {
          provider,
          modelName: model,
          parameters: parametersToSave,
          reasoningEffort: isOpenAIReasoningModel(modelValue) ? reasoningEffort[agentName] || (agentName === AgentNameEnum.Planner ? 'low' : 'minimal') : undefined,
        });
      } else {
        await agentModelStore.resetAgentModel(agentName);
      }
    } catch (error) {
      console.error('Error saving agent model:', error);
    }
  };

  const handleReasoningEffortChange = async (agentName: AgentNameEnum, value: 'minimal' | 'low' | 'medium' | 'high') => {
    setReasoningEffort(prev => ({ ...prev, [agentName]: value }));
    if (selectedModels[agentName] && isOpenAIReasoningModel(selectedModels[agentName])) {
      try {
        const [provider, modelName] = selectedModels[agentName].split('>');
        if (provider && modelName) {
          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName,
            parameters: modelParameters[agentName],
            reasoningEffort: value,
          });
        }
      } catch (error) {
        console.error('Error saving reasoning effort:', error);
      }
    }
  };

  const handleParameterChange = async (agentName: AgentNameEnum, paramName: 'temperature' | 'topP', value: number) => {
    const newParameters = { ...modelParameters[agentName], [paramName]: value };
    setModelParameters(prev => ({ ...prev, [agentName]: newParameters }));
    if (selectedModels[agentName]) {
      try {
        const [provider, modelName] = selectedModels[agentName].split('>');
        if (provider && modelName) {
          const parametersToSave = isAnthropicModel(selectedModels[agentName]) ? { temperature: newParameters.temperature } : newParameters;
          await agentModelStore.setAgentModel(agentName, { provider, modelName, parameters: parametersToSave });
        }
      } catch (error) {
        console.error('Error saving agent parameters:', error);
      }
    }
  };

  const handleSpeechToTextModelChange = async (modelValue: string) => {
    setSelectedSpeechToTextModel(modelValue);
    try {
      if (modelValue) {
        const [provider, modelName] = modelValue.split('>');
        await speechToTextModelStore.setSpeechToTextModel({ provider, modelName });
      } else {
        await speechToTextModelStore.resetSpeechToTextModel();
      }
    } catch (error) {
      console.error('Error saving speech-to-text model:', error);
    }
  };

  const getSortedProviders = () => {
    return Object.entries(providers).sort((a, b) => {
      const aInStorage = providersFromStorage.has(a[0]);
      const bInStorage = providersFromStorage.has(b[0]);
      if (aInStorage && !bInStorage) return -1;
      if (!aInStorage && bInStorage) return 1;
      return 0;
    });
  };

  return {
    providers,
    modifiedProviders,
    providersFromStorage,
    selectedModels,
    modelParameters,
    reasoningEffort,
    newModelInputs,
    isProviderSelectorOpen,
    setIsProviderSelectorOpen,
    nameErrors,
    visibleApiKeys,
    availableModels,
    selectedSpeechToTextModel,
    handleApiKeyChange,
    handleRegionChange,
    handleSecretKeyChange,
    toggleApiKeyVisibility,
    handleNameChange,
    handleModelsChange,
    addModel,
    removeModel,
    getButtonProps,
    handleSave,
    handleDelete,
    handleProviderSelection,
    handleModelChange,
    handleReasoningEffortChange,
    handleParameterChange,
    handleSpeechToTextModelChange,
    getSortedProviders,
  };
};

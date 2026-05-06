import { AgentNameEnum } from '@extension/storage';
import { t } from '@extension/i18n';

export function isOpenAIReasoningModel(modelName: string): boolean {
  let modelNameWithoutProvider = modelName;
  if (modelName.includes('>')) {
    modelNameWithoutProvider = modelName.split('>')[1];
  }
  if (modelNameWithoutProvider.startsWith('openai/')) {
    modelNameWithoutProvider = modelNameWithoutProvider.substring(7);
  }
  return (
    modelNameWithoutProvider.startsWith('o') ||
    (modelNameWithoutProvider.startsWith('gpt-5') && !modelNameWithoutProvider.startsWith('gpt-5-chat'))
  );
}

export function isAnthropicModel(modelName: string): boolean {
  let modelNameWithoutProvider = modelName;
  if (modelName.includes('>')) {
    modelNameWithoutProvider = modelName.split('>')[1];
  }
  return modelNameWithoutProvider.startsWith('claude-');
}

export const getAgentDescription = (agentName: AgentNameEnum) => {
  switch (agentName) {
    case AgentNameEnum.Navigator:
      return t('options_models_agents_navigator');
    case AgentNameEnum.Planner:
      return t('options_models_agents_planner');
    default:
      return '';
  }
};

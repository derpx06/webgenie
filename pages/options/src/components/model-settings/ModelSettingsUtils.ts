import { AgentNameEnum } from '@extension/storage';
import { t } from '@extension/i18n';

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

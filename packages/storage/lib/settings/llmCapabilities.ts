import { ProviderTypeEnum } from './types';

export type ReasoningControl = 'none' | 'openai_effort' | 'gemini_budget';
export type ReasoningEffortLevel = 'minimal' | 'low' | 'medium' | 'high';

/** What the agent may rely on for a provider/model, verified against the installed LangChain adapters. */
export interface LlmCapabilities {
  /** Native tool calling through LangChain bindTools. */
  nativeTools: boolean;
  /** Accepts a forced tool choice (LangChain tool_choice "any"). */
  forceToolChoice: boolean;
  /** How ModelConfig.reasoningEffort maps onto the provider. */
  reasoning: ReasoningControl;
  /** Accepts audio input parts (speech-to-text). */
  audioInput: boolean;
}

// ChatBedrockConverse rejects tool_choice "any" for other models.
const BEDROCK_FORCED_TOOL_MODELS = /claude-3|claude-4|opus-4|sonnet-4|mistral-large/i;

export function isOpenAIReasoningModel(modelName: string): boolean {
  let name = modelName.includes('>') ? modelName.split('>')[1] : modelName;
  if (name.startsWith('openai/')) name = name.substring(7);
  return name.startsWith('o') || (name.startsWith('gpt-5') && !name.startsWith('gpt-5-chat'));
}

export function getLlmCapabilities(providerType: string | undefined, modelName: string): LlmCapabilities {
  const tools = (nativeTools: boolean, forceToolChoice = nativeTools): LlmCapabilities => ({
    nativeTools,
    forceToolChoice,
    reasoning: 'none',
    audioInput: false,
  });

  switch (providerType) {
    case ProviderTypeEnum.OpenAI:
    case ProviderTypeEnum.AzureOpenAI:
    case ProviderTypeEnum.OpenRouter:
    case ProviderTypeEnum.CustomOpenAI:
      return { ...tools(true), reasoning: isOpenAIReasoningModel(modelName) ? 'openai_effort' : 'none' };
    case ProviderTypeEnum.Gemini:
    case ProviderTypeEnum.VertexAI:
      return { ...tools(true), reasoning: /gemini-(2\.5|[3-9])/.test(modelName) ? 'gemini_budget' : 'none', audioInput: true };
    case ProviderTypeEnum.DeepSeek:
      return tools(!(modelName === 'deepseek-reasoner' || modelName.includes('deepseek-r1')));
    case ProviderTypeEnum.Ollama:
      return tools(true, false); // ChatOllama throws on any tool_choice
    case ProviderTypeEnum.Bedrock:
      return tools(true, BEDROCK_FORCED_TOOL_MODELS.test(modelName));
    case ProviderTypeEnum.Llama:
      return tools(false); // ChatLlama drops tool calls when rewriting responses
    default:
      // Anthropic, Grok, Groq, Cerebras and unknown OpenAI-compatible providers.
      return tools(true);
  }
}

/** Gemini 2.5 thinking budget for a reasoning effort level. Pro cannot turn thinking off (minimum 128). */
export function geminiThinkingBudget(effort: ReasoningEffortLevel | undefined, modelName: string): number {
  switch (effort) {
    case 'minimal':
      return modelName.includes('pro') ? 128 : 0;
    case 'medium':
      return 4096;
    case 'high':
      return 8192;
    default:
      return 1024;
  }
}

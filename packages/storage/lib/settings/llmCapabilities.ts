import { ProviderTypeEnum } from './types';

export type ReasoningControl = 'none' | 'openai_effort' | 'gemini_budget';
export type ReasoningEffortLevel = 'minimal' | 'low' | 'medium' | 'high';

/** What a provider tells a refused caller: rate-limit headers, a hint inside the error body, or nothing at all. */
export type RateLimitSignals = 'headers' | 'body-hint' | 'none';

/**
 * How a provider caches a prompt prefix that does not change between calls:
 * - `none`: it does not, so only the request size matters.
 * - `implicit`: automatic on a matching prefix (Gemini).
 * - `implicit-key`: automatic, and a stable key steers the request to the machine that holds the prefix (OpenAI).
 * - `top-level-marker`: nothing is cached until the request marks the prefix (Anthropic's `cache_control`).
 * - `resource`: the prefix is uploaded once and referred to by id (Gemini's `cachedContents`).
 */
export type PromptCacheKind = 'none' | 'implicit' | 'implicit-key' | 'top-level-marker' | 'resource';

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
  /** Reads image parts (screenshots). */
  vision: boolean;
  /** Ceiling for one model call; the agent shortens it to what this model is measured to need. A retry gets 1.5 × more. */
  callTimeoutMs: number;
  /** What a 429 from this provider carries, so backoff follows the server rather than a guess. */
  rateLimitSignals: RateLimitSignals;
  /**
   * The endpoints this model can be served from, the configured one first. With more than one, a call refused or
   * timed out on the first retries on the next; with none or one there is nowhere else to go.
   */
  endpoints: string[];
  /** Whether a slow call may be duplicated. `off` for a server with a single queue, where the duplicate only waits. */
  hedge: 'off' | 'auto';
  /** How a stable prefix is cached here. */
  promptCache: PromptCacheKind;
  /** Tokens the prefix must reach before this provider caches it at all; 0 when it does not cache. */
  minCacheTokens: number;
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
    vision: true,
    callTimeoutMs: 30_000,
    rateLimitSignals: 'none',
    endpoints: [],
    hedge: 'auto',
    promptCache: 'none',
    minCacheTokens: 0,
  });
  // Models that think at length before answering need far longer than fast chat models.
  const slowThinker = /\bpro\b|-pro|reasoner|deepseek-r1|opus/i.test(modelName) || isOpenAIReasoningModel(modelName);

  switch (providerType) {
    case ProviderTypeEnum.OpenAI:
    case ProviderTypeEnum.AzureOpenAI:
    case ProviderTypeEnum.OpenRouter:
    case ProviderTypeEnum.CustomOpenAI:
      return {
        ...tools(true),
        reasoning: isOpenAIReasoningModel(modelName) ? 'openai_effort' : 'none',
        callTimeoutMs: slowThinker ? 90_000 : 30_000,
        // `Retry-After` and `x-ratelimit-*` on every refusal; caching is automatic from 1,024 tokens and a stable
        // key keeps a task's calls on the machine that holds its prefix.
        rateLimitSignals: 'headers',
        promptCache: 'implicit-key',
        minCacheTokens: 1024,
      };
    case ProviderTypeEnum.Gemini:
    case ProviderTypeEnum.VertexAI:
      return {
        ...tools(true),
        reasoning: /gemini-(2\.5|[3-9])/.test(modelName) ? 'gemini_budget' : 'none',
        audioInput: true,
        callTimeoutMs: slowThinker ? 60_000 : 25_000,
        // The API puts a retryDelay in the error body; Vertex sends nothing at all (0 of 3,064 refusals in run r3).
        rateLimitSignals: providerType === ProviderTypeEnum.Gemini ? 'body-hint' : 'none',
        // Implicit caching is on by default, from 2,048 tokens (4,096 on the Gemini 3 family).
        promptCache: 'implicit',
        minCacheTokens: /gemini-[3-9]/.test(modelName) ? 4096 : 2048,
      };
    case ProviderTypeEnum.DeepSeek:
      return { ...tools(!(modelName === 'deepseek-reasoner' || modelName.includes('deepseek-r1'))), vision: false, callTimeoutMs: slowThinker ? 90_000 : 30_000 };
    case ProviderTypeEnum.Ollama:
      // ChatOllama throws on any tool_choice; local models run slowly and most read no images.
      // One model runs one request at a time (OLLAMA_NUM_PARALLEL=1), so a duplicate would only queue behind the first.
      return { ...tools(true, false), vision: false, callTimeoutMs: 90_000, hedge: 'off' };
    case ProviderTypeEnum.Bedrock:
      return { ...tools(true, BEDROCK_FORCED_TOOL_MODELS.test(modelName)), vision: /claude|nova-(pro|lite)|llama3-2-(11|90)b/i.test(modelName) };
    case ProviderTypeEnum.Llama:
      return { ...tools(false), vision: false }; // ChatLlama drops tool calls when rewriting responses
    case ProviderTypeEnum.Anthropic:
      return {
        ...tools(true),
        callTimeoutMs: slowThinker ? 90_000 : 30_000,
        // `retry-after` and `anthropic-ratelimit-*` on a refusal; nothing is cached unless the request marks the prefix.
        rateLimitSignals: 'headers',
        promptCache: 'top-level-marker',
        minCacheTokens: 1024,
      };
    default:
      // Grok, Groq, Cerebras and unknown OpenAI-compatible providers; none of them is known to read images.
      return { ...tools(true), vision: false };
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

import { describe, expect, it } from 'vitest';
import { geminiThinkingBudget, getLlmCapabilities, isOpenAIReasoningModel, ProviderTypeEnum } from '@extension/storage';

describe('LLM capability table', () => {
  it('has an entry for every provider type', () => {
    for (const type of Object.values(ProviderTypeEnum)) {
      const caps = getLlmCapabilities(type, 'some-model');
      expect(typeof caps.nativeTools).toBe('boolean');
      expect(typeof caps.forceToolChoice).toBe('boolean');
      if (!caps.nativeTools) expect(caps.forceToolChoice).toBe(false);
    }
  });

  it('routes models without usable tool calling to the prompt fallback', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.Llama, 'Llama-4-Maverick').nativeTools).toBe(false);
    expect(getLlmCapabilities(ProviderTypeEnum.DeepSeek, 'deepseek-reasoner').nativeTools).toBe(false);
    expect(getLlmCapabilities(ProviderTypeEnum.DeepSeek, 'deepseek-chat').nativeTools).toBe(true);
  });

  it('only forces tool choice where the adapter accepts it', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.Ollama, 'qwen3:8b')).toMatchObject({ nativeTools: true, forceToolChoice: false });
    expect(getLlmCapabilities(ProviderTypeEnum.Bedrock, 'us.anthropic.claude-sonnet-4-20250514-v1:0').forceToolChoice).toBe(true);
    expect(getLlmCapabilities(ProviderTypeEnum.Bedrock, 'amazon.titan-text-express-v1').forceToolChoice).toBe(false);
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-flash').forceToolChoice).toBe(true);
  });

  it('maps reasoning controls per provider family', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-flash')).toMatchObject({ reasoning: 'gemini_budget', audioInput: true });
    expect(getLlmCapabilities(ProviderTypeEnum.Gemini, 'gemini-2.0-flash').reasoning).toBe('none');
    expect(getLlmCapabilities(ProviderTypeEnum.OpenAI, 'o3').reasoning).toBe('openai_effort');
    expect(getLlmCapabilities(ProviderTypeEnum.OpenAI, 'gpt-4.1').reasoning).toBe('none');
    expect(getLlmCapabilities(ProviderTypeEnum.Anthropic, 'claude-sonnet-4-5').reasoning).toBe('none');
    expect(isOpenAIReasoningModel('openai>gpt-5-mini')).toBe(true);
    expect(isOpenAIReasoningModel('openai/gpt-5-chat')).toBe(false);
  });

  it('sends screenshots only to models that read images', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-flash').vision).toBe(true);
    expect(getLlmCapabilities(ProviderTypeEnum.Anthropic, 'claude-sonnet-4-5').vision).toBe(true);
    expect(getLlmCapabilities(ProviderTypeEnum.DeepSeek, 'deepseek-chat').vision).toBe(false);
    expect(getLlmCapabilities(ProviderTypeEnum.Groq, 'llama-3.3-70b-versatile').vision).toBe(false);
    expect(getLlmCapabilities(ProviderTypeEnum.Bedrock, 'amazon.titan-text-express-v1').vision).toBe(false);
  });

  it('gives models that think at length a longer call limit than fast chat models', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-flash').callTimeoutMs).toBe(25_000);
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-pro').callTimeoutMs).toBe(60_000);
    expect(getLlmCapabilities(ProviderTypeEnum.OpenAI, 'gpt-5').callTimeoutMs).toBe(90_000);
    expect(getLlmCapabilities(ProviderTypeEnum.OpenAI, 'gpt-4o').callTimeoutMs).toBe(30_000);
    expect(getLlmCapabilities(ProviderTypeEnum.Ollama, 'qwen3:8b').callTimeoutMs).toBe(90_000);
  });

  /**
   * Backoff, hedging, failover and caching read these fields instead of asking which provider they are talking to
   * (D5): every provider declares what it sends on a refusal, where else it can be called, and how it caches a prefix.
   */
  it('declares what every provider sends back and how it caches, for every provider type', () => {
    for (const type of Object.values(ProviderTypeEnum)) {
      const caps = getLlmCapabilities(type, 'some-model');
      expect(['headers', 'body-hint', 'none']).toContain(caps.rateLimitSignals);
      expect(['off', 'auto']).toContain(caps.hedge);
      expect(['none', 'implicit', 'implicit-key', 'top-level-marker', 'resource']).toContain(caps.promptCache);
      expect(Array.isArray(caps.endpoints)).toBe(true);
      expect(caps.minCacheTokens).toBeGreaterThanOrEqual(0);
      // A provider that caches nothing has no minimum, and one that caches has one to clear.
      expect(caps.minCacheTokens > 0).toBe(caps.promptCache !== 'none');
      // The traces name the provider as well as the model: a score belongs to what it ran on (D5).
      expect(caps.provider).toBe(type);
    }
  });

  it('knows which providers hint at a wait, and which say nothing', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.OpenAI, 'gpt-4o').rateLimitSignals).toBe('headers');
    expect(getLlmCapabilities(ProviderTypeEnum.Anthropic, 'claude-sonnet-4-5').rateLimitSignals).toBe('headers');
    expect(getLlmCapabilities(ProviderTypeEnum.Gemini, 'gemini-2.5-flash').rateLimitSignals).toBe('body-hint');
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-flash').rateLimitSignals).toBe('none');
    expect(getLlmCapabilities(ProviderTypeEnum.Ollama, 'qwen3:8b').rateLimitSignals).toBe('none');
  });

  it('never duplicates a slow call on a server that runs one request at a time', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.Ollama, 'qwen3:8b').hedge).toBe('off');
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-flash').hedge).toBe('auto');
  });

  it('says how each provider caches a prefix and how long it must be', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.Anthropic, 'claude-sonnet-4-5')).toMatchObject({ promptCache: 'top-level-marker', minCacheTokens: 1024 });
    expect(getLlmCapabilities(ProviderTypeEnum.OpenAI, 'gpt-4o')).toMatchObject({ promptCache: 'implicit-key', minCacheTokens: 1024 });
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-flash')).toMatchObject({ promptCache: 'implicit', minCacheTokens: 2048 });
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-3-pro').minCacheTokens).toBe(4096);
    expect(getLlmCapabilities(ProviderTypeEnum.Ollama, 'qwen3:8b').promptCache).toBe('none');
  });

  it('maps Gemini thinking budgets, never turning pro thinking fully off', () => {
    expect(geminiThinkingBudget(undefined, 'gemini-2.5-flash')).toBe(1024);
    expect(geminiThinkingBudget('minimal', 'gemini-2.5-flash')).toBe(0);
    expect(geminiThinkingBudget('minimal', 'gemini-2.5-pro')).toBe(128);
    expect(geminiThinkingBudget('high', 'gemini-2.5-flash')).toBe(8192);
  });
});

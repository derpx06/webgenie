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

  it('gives models that think at length a longer call limit than fast chat models', () => {
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-flash').callTimeoutMs).toBe(25_000);
    expect(getLlmCapabilities(ProviderTypeEnum.VertexAI, 'gemini-2.5-pro').callTimeoutMs).toBe(60_000);
    expect(getLlmCapabilities(ProviderTypeEnum.OpenAI, 'gpt-5').callTimeoutMs).toBe(90_000);
    expect(getLlmCapabilities(ProviderTypeEnum.OpenAI, 'gpt-4o').callTimeoutMs).toBe(30_000);
    expect(getLlmCapabilities(ProviderTypeEnum.Ollama, 'qwen3:8b').callTimeoutMs).toBe(90_000);
  });

  it('maps Gemini thinking budgets, never turning pro thinking fully off', () => {
    expect(geminiThinkingBudget(undefined, 'gemini-2.5-flash')).toBe(1024);
    expect(geminiThinkingBudget('minimal', 'gemini-2.5-flash')).toBe(0);
    expect(geminiThinkingBudget('minimal', 'gemini-2.5-pro')).toBe(128);
    expect(geminiThinkingBudget('high', 'gemini-2.5-flash')).toBe(8192);
  });
});

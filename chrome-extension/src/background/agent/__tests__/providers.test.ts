import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));
// The Bedrock adapter drags the AWS SDK in, which does not resolve outside the extension bundle.
vi.mock('@langchain/aws', () => ({ ChatBedrockConverse: class {} }));

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import { ProviderTypeEnum, llmProviderModelNames, getLlmCapabilities } from '@extension/storage';
import { createChatModel } from '../helper';

/**
 * Every provider the options page offers has to become a working chat model, and the OpenAI-compatible ones have to talk
 * to their own host and hand back a parsed tool call. The wire is faked, so this runs without a key; the live runs in
 * `e2e/` cover the providers a key exists for.
 */
const tool = {
  type: 'function' as const,
  function: { name: 'click_element', description: 'Click an element', parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] } },
};

const completion = {
  id: 'x',
  object: 'chat.completion',
  created: 1,
  model: 'm',
  choices: [
    {
      index: 0,
      finish_reason: 'tool_calls',
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'click_element', arguments: '{"index":3}' } }] },
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
};

/**
 * Providers that speak the OpenAI wire format through the OpenAI SDK, with the host their saved configuration calls
 * (the options page stores each provider's base URL when it is saved). Groq, Cerebras, Ollama, Anthropic, Gemini,
 * Vertex and Bedrock use their own SDK clients, which bypass `fetch`, so they are covered by the build test above.
 */
const OPENAI_COMPATIBLE: [ProviderTypeEnum, string, string, string?][] = [
  [ProviderTypeEnum.OpenAI, 'gpt-5-mini', 'api.openai.com'],
  [ProviderTypeEnum.DeepSeek, 'deepseek-chat', 'api.deepseek.com'],
  [ProviderTypeEnum.Grok, 'grok-4', 'api.x.ai'],
  [ProviderTypeEnum.OpenRouter, 'openai/gpt-5-mini', 'openrouter.ai', 'https://openrouter.ai/api/v1'],
  [ProviderTypeEnum.CustomOpenAI, 'my-model', 'llm.example.test', 'https://llm.example.test/v1'],
  [ProviderTypeEnum.Llama, 'Llama-4-Maverick', 'llm.example.test', 'https://llm.example.test/v1'],
];

describe('every provider becomes a chat model', () => {
  const dummy = (type: ProviderTypeEnum) => ({
    apiKey: 'test-key',
    type,
    name: type,
    baseUrl: type === ProviderTypeEnum.Ollama ? 'http://localhost:11434' : type === ProviderTypeEnum.CustomOpenAI || type === ProviderTypeEnum.Llama ? 'https://llm.example.test/v1' : undefined,
    azureDeploymentNames: ['dep'],
    azureApiVersion: '2025-04-01-preview',
  });

  for (const type of Object.values(ProviderTypeEnum)) {
    it(`${type}: builds a model that can bind tools, with declared capabilities`, () => {
      const modelName = llmProviderModelNames[type as keyof typeof llmProviderModelNames]?.[0] ?? 'some-model';
      const config = type === ProviderTypeEnum.AzureOpenAI ? { ...dummy(type), baseUrl: 'https://res.openai.azure.com' } : dummy(type);
      const model = createChatModel(config, { provider: type, modelName }) as BaseChatModel;
      // Bedrock's adapter is stubbed in this file (the AWS SDK does not resolve outside the bundle).
      if (type !== ProviderTypeEnum.Bedrock) {
        expect(typeof model.invoke).toBe('function');
        expect(typeof (model as { bindTools?: unknown }).bindTools).toBe('function');
      }
      expect(model).toBeDefined();
      const caps = getLlmCapabilities(type, modelName);
      expect(typeof caps.nativeTools).toBe('boolean');
    });
  }
});

describe('OpenAI-compatible providers call their own host and parse a tool call', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const [type, modelName, host, baseUrl] of OPENAI_COMPATIBLE) {
    it(type, async () => {
      const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.push({ url: String(input instanceof Request ? input.url : input), auth: headers.get('authorization'), body: JSON.parse(String(init?.body ?? '{}')) });
        return new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

      const model = createChatModel({ apiKey: 'test-key', type, name: type, ...(baseUrl ? { baseUrl } : {}) }, { provider: type, modelName }) as BaseChatModel;
      const reply = await (model as unknown as { bindTools: (t: unknown[]) => { invoke: (m: unknown[]) => Promise<{ tool_calls?: { name: string; args: { index: number } }[] }> } })
        .bindTools([tool])
        .invoke([new HumanMessage('click the button')]);

      expect(seen).toHaveLength(1);
      expect(new URL(seen[0].url).hostname).toBe(host);
      expect(seen[0].url).toMatch(/chat\/completions$/);
      expect(seen[0].body.model).toBe(modelName);
      expect(reply.tool_calls?.[0]).toMatchObject({ name: 'click_element', args: { index: 3 } });
    });
  }
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));
// The Bedrock adapter drags the AWS SDK in, which does not resolve outside the extension bundle; nothing here calls it.
vi.mock('@langchain/aws', () => ({ ChatBedrockConverse: class {} }));

import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ProviderTypeEnum } from '@extension/storage';
import { createChatModel } from '../helper';
import { invokeLLM, promptCacheOptions } from '../agents/base';

/**
 * The prefix of every call of a task — the system prompt and the tool block — is the same bytes on every call, which
 * is the whole point of fixing the tool list. What a provider needs to reuse it differs, so the capability decides and
 * these tests pin the request shape: a marker for Anthropic, which caches nothing without one, and a stable key for
 * OpenAI, which caches automatically but routes on the key.
 */
describe('prompt caching, per provider', () => {
  it('marks the prefix for a provider that caches nothing unless the request says so', () => {
    const model = createChatModel(
      { apiKey: 'test-key', type: ProviderTypeEnum.Anthropic, name: 'Anthropic' },
      { provider: ProviderTypeEnum.Anthropic, modelName: 'claude-sonnet-4-5' },
    ) as unknown as { invocationKwargs?: Record<string, unknown> };

    expect(model.invocationKwargs).toEqual({ cache_control: { type: 'ephemeral' } });
  });

  it('sends no marker to a provider that caches on the prefix alone', () => {
    const model = createChatModel(
      { apiKey: 'test-key', type: ProviderTypeEnum.Gemini, name: 'Gemini' },
      { provider: ProviderTypeEnum.Gemini, modelName: 'gemini-2.5-flash' },
    ) as unknown as { invocationKwargs?: Record<string, unknown> };

    expect(model.invocationKwargs).toBeUndefined();
  });

  it('gives each task and role one stable cache key, and other providers none', () => {
    const openai = { nativeTools: true, forceToolChoice: true, promptCache: 'implicit-key' as const };
    expect(promptCacheOptions(openai, 'task-1', 'navigator')).toEqual({ promptCacheKey: 'webgenie-task-1-navigator' });
    // The same task and role always ask for the same machine; a different role or task does not share the prefix.
    expect(promptCacheOptions(openai, 'task-1', 'navigator')).toEqual(promptCacheOptions(openai, 'task-1', 'navigator'));
    expect(promptCacheOptions(openai, 'task-1', 'planner').promptCacheKey).not.toBe(
      promptCacheOptions(openai, 'task-1', 'navigator').promptCacheKey,
    );
    expect(promptCacheOptions({ ...openai, promptCache: 'implicit' }, 'task-1', 'navigator')).toEqual({});
    expect(promptCacheOptions({ nativeTools: true, forceToolChoice: true }, 'task-1', 'navigator')).toEqual({});
  });

  it('passes the key through to the request', async () => {
    const invoke = vi.fn(async () => new AIMessage({ content: 'ok' }));
    const model = { invoke } as unknown as BaseChatModel;

    await invokeLLM(model, [new HumanMessage('do the task')], {
      component: 'test',
      callOptions: promptCacheOptions({ nativeTools: true, forceToolChoice: true, promptCache: 'implicit-key' }, 'task-9', 'planner'),
    });

    expect(invoke.mock.calls[0][1]).toMatchObject({ promptCacheKey: 'webgenie-task-9-planner' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseAgent } from '../base';
import type { AgentContext, AgentOutput } from '../../types';
import type { BasePrompt } from '../../prompts/base';
import type { ToolDefinition } from '../../actions/builder';

const validators = { done: z.object({ text: z.string() }) };
const tools: ToolDefinition[] = [
  { type: 'function', function: { name: 'done', description: 'finish', parameters: { type: 'object', properties: {} } } },
];

class TestAgent extends BaseAgent<string> {
  async execute(): Promise<AgentOutput<string>> {
    const { calls } = await this.invokeWithTools([new HumanMessage('finish')], tools, validators);
    return { id: this.id, result: String(calls[0].args.text) };
  }
}

function createContext() {
  const recordTokenUsage = vi.fn();
  const context = {
    controller: new AbortController(),
    traceCallbacks: [],
    messageManager: { recordTokenUsage },
  } as unknown as AgentContext;
  return { context, recordTokenUsage };
}

describe('BaseAgent tool calling', () => {
  it('records token usage for every model call', async () => {
    const bound = {
      invoke: vi.fn(async () =>
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'a', name: 'done', args: { text: 'ok' }, type: 'tool_call' }],
          usage_metadata: { input_tokens: 50, output_tokens: 5, total_tokens: 55 },
        }),
      ),
    };
    const chatLLM = { model: 'test-model', bindTools: vi.fn(() => bound), invoke: vi.fn() } as unknown as BaseChatModel;
    const { context, recordTokenUsage } = createContext();
    const agent = new TestAgent({ chatLLM, context, prompt: {} as BasePrompt }, { id: 'test' });

    expect((await agent.execute()).result).toBe('ok');
    expect(recordTokenUsage).toHaveBeenCalledWith(50, 5);
  });

  it('switches to prompt-rendered tools for the rest of the task when the provider rejects tools', async () => {
    const rejected = Object.assign(new Error('400 "tool_choice" is not supported by this model'), { name: 'BadRequestError' });
    const bindTools = vi.fn(() => ({ invoke: vi.fn(async () => Promise.reject(rejected)) }));
    const chatLLM = {
      model: 'custom-model',
      bindTools,
      invoke: vi.fn(async () => new AIMessage({ content: '{"tool_calls":[{"name":"done","args":{"text":"fallback"}}]}' })),
    } as unknown as BaseChatModel;
    const agent = new TestAgent({ chatLLM, context: createContext().context, prompt: {} as BasePrompt }, { id: 'test' });

    expect((await agent.execute()).result).toBe('fallback');
    expect((await agent.execute()).result).toBe('fallback');
    expect(bindTools).toHaveBeenCalledTimes(1);
  });

  it('does not downgrade on bad requests unrelated to tools', async () => {
    const rejected = Object.assign(new Error('400 invalid temperature'), { name: 'BadRequestError' });
    const chatLLM = {
      model: 'test-model',
      bindTools: vi.fn(() => ({ invoke: vi.fn(async () => Promise.reject(rejected)) })),
      invoke: vi.fn(),
    } as unknown as BaseChatModel;
    const agent = new TestAgent({ chatLLM, context: createContext().context, prompt: {} as BasePrompt }, { id: 'test' });

    await expect(agent.execute()).rejects.toBe(rejected);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseAgent } from '../base';
import type { AgentContext, AgentOutput } from '../../types';
import type { BasePrompt } from '../../prompts/base';

const outputSchema = z.object({
  answer: z.string(),
});

type TestOutput = z.infer<typeof outputSchema>;

class TestAgent extends BaseAgent<typeof outputSchema, TestOutput> {
  constructor(
    chatLLM: BaseChatModel,
    context: AgentContext,
    provider = 'test-provider',
    useProviderStructuredOutput?: boolean,
  ) {
    super(
      outputSchema,
      {
        chatLLM,
        context,
        prompt: {} as BasePrompt,
        provider,
        ...(useProviderStructuredOutput === undefined ? {} : { useProviderStructuredOutput }),
      },
      { id: 'test' },
    );
  }

  async execute(): Promise<AgentOutput<TestOutput>> {
    return { id: 'test' };
  }
}

function createContext(): AgentContext {
  return {
    controller: new AbortController(),
    traceCallbacks: [],
    messageManager: {
      recordTokenUsage: vi.fn(),
    },
  } as unknown as AgentContext;
}

function createChatModel(responses: string[]): {
  chatLLM: BaseChatModel;
  invoke: ReturnType<typeof vi.fn>;
  withStructuredOutput: ReturnType<typeof vi.fn>;
} {
  const pending = [...responses];
  const invoke = vi.fn(async () => new AIMessage({ content: pending.shift() ?? '{}' }));
  const withStructuredOutput = vi.fn();
  const chatLLM = {
    modelName: 'test-model',
    invoke,
    withStructuredOutput,
  } as unknown as BaseChatModel;

  return { chatLLM, invoke, withStructuredOutput };
}

function createStructuredChatModel(params: {
  structuredResponse?: unknown;
  structuredError?: Error;
  manualResponses?: string[];
}): {
  chatLLM: BaseChatModel;
  invoke: ReturnType<typeof vi.fn>;
  structuredInvoke: ReturnType<typeof vi.fn>;
  withStructuredOutput: ReturnType<typeof vi.fn>;
} {
  const pendingManual = [...(params.manualResponses ?? [])];
  const invoke = vi.fn(async () => new AIMessage({ content: pendingManual.shift() ?? '{"answer":"manual"}' }));
  const structuredInvoke = vi.fn(async () => {
    if (params.structuredError) throw params.structuredError;
    return params.structuredResponse ?? { answer: 'structured' };
  });
  const withStructuredOutput = vi.fn(() => ({ invoke: structuredInvoke }));
  const chatLLM = {
    modelName: 'gpt-4.1',
    invoke,
    withStructuredOutput,
  } as unknown as BaseChatModel;

  return { chatLLM, invoke, structuredInvoke, withStructuredOutput };
}

describe('BaseAgent manual JSON invocation', () => {
  it('does not call provider structured output and still validates JSON with Zod', async () => {
    const { chatLLM, invoke, withStructuredOutput } = createChatModel(['{"answer":"ok"}']);
    const agent = new TestAgent(chatLLM, createContext());

    const result = await agent.invoke([new HumanMessage({ content: 'answer now' })]);

    expect(result).toEqual({ answer: 'ok' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(withStructuredOutput).not.toHaveBeenCalled();
  });

  it('retries once with a strict JSON repair instruction when raw output is malformed', async () => {
    const { chatLLM, invoke, withStructuredOutput } = createChatModel(['not json', '{"answer":"fixed"}']);
    const agent = new TestAgent(chatLLM, createContext());

    const result = await agent.invoke([new HumanMessage({ content: 'answer now' })]);

    expect(result).toEqual({ answer: 'fixed' });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(withStructuredOutput).not.toHaveBeenCalled();

    const retryMessages = invoke.mock.calls[1]?.[0] as BaseMessage[];
    const retryInstruction = retryMessages[retryMessages.length - 1];
    expect(retryInstruction.content).toContain('previous response was not valid JSON');
  });

  it('uses provider structured output for small supported schemas', async () => {
    const { chatLLM, invoke, structuredInvoke, withStructuredOutput } = createStructuredChatModel({
      structuredResponse: { answer: 'structured' },
    });
    const agent = new TestAgent(chatLLM, createContext(), 'openai');

    const result = await agent.invoke([new HumanMessage({ content: 'answer now' })]);

    expect(result).toEqual({ answer: 'structured' });
    expect(withStructuredOutput).toHaveBeenCalledTimes(1);
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('can opt out of provider structured output for small supported schemas', async () => {
    const { chatLLM, invoke, structuredInvoke, withStructuredOutput } = createStructuredChatModel({
      manualResponses: ['{"answer":"manual"}'],
    });
    const agent = new TestAgent(chatLLM, createContext(), 'openai', false);

    const result = await agent.invoke([new HumanMessage({ content: 'answer now' })]);

    expect(result).toEqual({ answer: 'manual' });
    expect(withStructuredOutput).not.toHaveBeenCalled();
    expect(structuredInvoke).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('downgrades provider schema payload errors to manual JSON extraction', async () => {
    const { chatLLM, invoke, structuredInvoke, withStructuredOutput } = createStructuredChatModel({
      structuredError: new Error('Invalid JSON payload received. Unknown name "$ref" at generation_config.response_schema'),
      manualResponses: ['{"answer":"manual"}'],
    });
    const agent = new TestAgent(chatLLM, createContext(), 'openai');

    const result = await agent.invoke([new HumanMessage({ content: 'answer now' })]);

    expect(result).toEqual({ answer: 'manual' });
    expect(withStructuredOutput).toHaveBeenCalledTimes(1);
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

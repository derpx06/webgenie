import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeLLM, invokeTools, isToolsUnsupportedError, readFinish } from '../base';
import { isAbortedError, ResponseParseError } from '../errors';
import type { ToolDefinition } from '../../actions/builder';

type Reply = AIMessage | ((signal?: AbortSignal) => Promise<AIMessage>);

function stubModel(replies: Reply[]) {
  const seen: BaseMessage[][] = [];
  const model = {
    bindTools: vi.fn(() => model),
    invoke: vi.fn(async (messages: BaseMessage[], options?: { signal?: AbortSignal }) => {
      seen.push(messages);
      const next = replies.shift();
      if (!next) throw new Error('no reply queued');
      return typeof next === 'function' ? next(options?.signal) : next;
    }),
  };
  return { chatModel: model as unknown as BaseChatModel, stub: model, seen };
}

const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, args, type: 'tool_call' as const });

const validators = {
  click_element: z.object({ index: z.number().int(), memory: z.string() }),
  done: z.object({ text: z.string(), success: z.boolean(), memory: z.string() }),
};
const tools: ToolDefinition[] = Object.keys(validators).map(name => ({
  type: 'function',
  function: { name, description: name, parameters: { type: 'object', properties: {} } },
}));
const packet = [new HumanMessage('do the task')];
const base = { component: 'test', tools, validators, messages: packet, native: true, forceToolChoice: true };

describe('invokeTools', () => {
  it('returns valid parallel calls from one request and forces a tool choice', async () => {
    const { chatModel, stub } = stubModel([
      new AIMessage({ content: '', tool_calls: [call('a', 'click_element', { index: 1, memory: 'm' }), call('b', 'done', { text: 't', success: true, memory: 'm' })] }),
    ]);
    const result = await invokeTools({ ...base, chatModel });
    expect(result.calls.map(c => c.name)).toEqual(['click_element', 'done']);
    expect(result.attempts).toBe(1);
    expect(stub.bindTools).toHaveBeenCalledWith(tools, { tool_choice: 'any' });
  });

  it('omits tool_choice when the provider cannot force one', async () => {
    const { chatModel, stub } = stubModel([new AIMessage({ content: '', tool_calls: [call('a', 'click_element', { index: 1, memory: 'm' })] })]);
    await invokeTools({ ...base, chatModel, forceToolChoice: false });
    expect(stub.bindTools).toHaveBeenCalledWith(tools, {});
  });

  it('answers a single invalid call with a ToolMessage carrying the Zod issues, then accepts the corrected call', async () => {
    const bad = new AIMessage({ content: '', tool_calls: [call('a', 'click_element', { element_index: 1, memory: 'm' })] });
    const { chatModel, seen } = stubModel([bad, new AIMessage({ content: '', tool_calls: [call('c', 'click_element', { index: 1, memory: 'm' })] })]);
    const result = await invokeTools({ ...base, chatModel });

    expect(result.attempts).toBe(2);
    expect(seen[1][1]).toBe(bad);
    const toolMessages = seen[1].filter((m): m is ToolMessage => m instanceof ToolMessage);
    expect(toolMessages.map(m => m.tool_call_id)).toEqual(['a']);
    expect(String(toolMessages[0].content)).toContain('index');
  });

  it('gives text feedback when a reply with several calls is invalid', async () => {
    const bad = new AIMessage({ content: '', tool_calls: [call('a', 'click_element', { element_index: 1, memory: 'm' }), call('b', 'done', { text: 't', success: true, memory: 'm' })] });
    const { chatModel, seen } = stubModel([bad, new AIMessage({ content: '', tool_calls: [call('c', 'click_element', { index: 1, memory: 'm' })] })]);
    const result = await invokeTools({ ...base, chatModel });

    expect(result.attempts).toBe(2);
    expect(seen[1].some(m => m instanceof ToolMessage || m === bad)).toBe(false);
    expect(String(seen[1].at(-1)?.content)).toContain('index');
  });

  it('rejects unknown tools and invalid_tool_calls with feedback', async () => {
    const { chatModel, seen } = stubModel([
      new AIMessage({
        content: '',
        tool_calls: [call('a', 'teleport', { memory: 'm' })],
        invalid_tool_calls: [{ id: 'b', name: 'click_element', args: '{index:', error: 'Unexpected token', type: 'invalid_tool_call' }],
      }),
      new AIMessage({ content: '', tool_calls: [call('c', 'click_element', { index: 2, memory: 'm' })] }),
    ]);
    await invokeTools({ ...base, chatModel });
    const feedback = String(seen[1].at(-1)?.content);
    expect(seen[1].some(m => m instanceof ToolMessage)).toBe(false);
    expect(feedback).toContain('unknown tool "teleport"');
    expect(feedback).toContain('not valid JSON');
  });

  it('re-asks when the reply was truncated or malformed and has no calls', async () => {
    const { chatModel, seen } = stubModel([
      new AIMessage({ content: '', response_metadata: { finish_reason: 'MAX_TOKENS' } }),
      new AIMessage({ content: '', response_metadata: { finish_reason: 'MALFORMED_FUNCTION_CALL' } }),
      new AIMessage({ content: '', tool_calls: [call('a', 'click_element', { index: 1, memory: 'm' })] }),
    ]);
    const result = await invokeTools({ ...base, chatModel });
    expect(result.attempts).toBe(3);
    expect(String(seen[1].at(-1)?.content)).toContain('cut off');
    expect(String(seen[2].at(-1)?.content)).toContain('malformed');
  });

  it('accepts array content with reasoning parts alongside tool calls', async () => {
    const { chatModel } = stubModel([
      new AIMessage({
        content: [{ type: 'reasoning', reasoning: 'thinking' }, { type: 'text', text: '' }],
        tool_calls: [call('a', 'done', { text: 'answer', success: true, memory: 'm' })],
      }),
    ]);
    const result = await invokeTools({ ...base, chatModel });
    expect(result.calls[0].args).toEqual({ text: 'answer', success: true, memory: 'm' });
  });

  it('throws ResponseParseError after the re-asks are exhausted', async () => {
    const wrong = () => new AIMessage({ content: '', tool_calls: [call('a', 'done', { result: 'x', success: true, memory: 'm' })] });
    const { chatModel, stub } = stubModel([wrong(), wrong(), wrong()]);
    await expect(invokeTools({ ...base, chatModel })).rejects.toBeInstanceOf(ResponseParseError);
    expect(stub.invoke).toHaveBeenCalledTimes(3);
  });

  it('parses fenced JSON in fallback mode through the same validation', async () => {
    const { chatModel, stub, seen } = stubModel([
      new AIMessage({ content: '```json\n{"tool_calls":[{"name":"click_element","args":{"index":4,"memory":"m"}}]}\n```' }),
    ]);
    const result = await invokeTools({ ...base, chatModel, native: false });
    expect(stub.bindTools).not.toHaveBeenCalled();
    expect(result.calls).toEqual([{ id: 'fb_0', name: 'click_element', args: { index: 4, memory: 'm' } }]);
    expect(String(seen[0].at(-1)?.content)).toContain('"tool_calls"');
  });

  it('reports usage for every attempt, including rejected ones', async () => {
    const usage = { input_tokens: 100, output_tokens: 10, total_tokens: 110 };
    const { chatModel } = stubModel([
      new AIMessage({ content: '', tool_calls: [call('a', 'click_element', { memory: 'm' })], usage_metadata: usage }),
      new AIMessage({ content: '', tool_calls: [call('b', 'click_element', { index: 1, memory: 'm' })], usage_metadata: usage }),
    ]);
    const onUsage = vi.fn();
    await invokeTools({ ...base, chatModel, onUsage });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, reasoningTokens: 0 });
  });

  it('rejects calls outside the plan’s allowed actions', async () => {
    const { chatModel, seen } = stubModel([
      new AIMessage({ content: '', tool_calls: [call('a', 'click_element', { index: 1, memory: 'm' })] }),
      new AIMessage({ content: '', tool_calls: [call('b', 'done', { text: 't', success: true, memory: 'm' })] }),
    ]);
    const result = await invokeTools({ ...base, chatModel, allowedActions: ['done'] });
    expect(result.calls[0].name).toBe('done');
    expect(String((seen[1].find(m => m instanceof ToolMessage) as ToolMessage).content)).toContain('not allowed');
  });
});

describe('invokeLLM', () => {
  it('waits and retries when the provider rate-limits, then returns the reply', async () => {
    const { chatModel, stub } = stubModel([() => Promise.reject(new Error('429 Resource exhausted')), new AIMessage({ content: 'ok' })]);

    const reply = await invokeLLM(chatModel, packet, { component: 'test', rateLimitDelaysMs: [1] });

    expect(reply.text).toBe('ok');
    expect(stub.invoke).toHaveBeenCalledTimes(2);
  });

  it('gives up with the rate-limit error after the configured waits', async () => {
    const limited = () => Promise.reject(new Error('429 Resource exhausted'));
    const { chatModel, stub } = stubModel([limited, limited, limited]);

    await expect(invokeLLM(chatModel, packet, { component: 'test', rateLimitDelaysMs: [1, 1] })).rejects.toThrow('429');
    expect(stub.invoke).toHaveBeenCalledTimes(3);
  });

  it('turns a timeout into a plain error, not a user cancel', async () => {
    const { chatModel } = stubModel([
      signal => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Aborted')))),
    ]);
    const error = await invokeLLM(chatModel, packet, { component: 'test', timeoutMs: 20 }).catch(e => e);
    expect(String(error.message)).toMatch(/timed out/);
    expect(isAbortedError(error)).toBe(false);
  });

  it('keeps a user abort as an abort', async () => {
    const controller = new AbortController();
    const { chatModel } = stubModel([
      signal => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Aborted')))),
    ]);
    const pending = invokeLLM(chatModel, packet, { component: 'test', signal: controller.signal, timeoutMs: 5_000 }).catch(e => e);
    controller.abort();
    expect(isAbortedError(await pending)).toBe(true);
  });
});

describe('provider-neutral readers', () => {
  it('reads truncation and malformed calls under every provider key', () => {
    expect(readFinish({ finish_reason: 'length' }).truncated).toBe(true);
    expect(readFinish({ stop_reason: 'max_tokens' }).truncated).toBe(true);
    expect(readFinish({ finish_reason: 'MAX_TOKENS' }).truncated).toBe(true);
    expect(readFinish({ finishReason: 'MALFORMED_FUNCTION_CALL' }).malformed).toBe(true);
    expect(readFinish({ stopReason: 'end_turn' })).toEqual({ reason: 'end_turn', truncated: false, malformed: false });
    expect(readFinish(undefined).reason).toBe('');
  });

  it('recognises a server that rejects tools', () => {
    const badRequest = (message: string) => Object.assign(new Error(message), { name: 'BadRequestError' });
    expect(isToolsUnsupportedError(badRequest('400 "tool_choice" is not supported by this model'))).toBe(true);
    expect(isToolsUnsupportedError(new Error('Google request failed with status code 400: Function calling is not enabled'))).toBe(true);
    expect(isToolsUnsupportedError(badRequest('400 invalid temperature'))).toBe(false);
    expect(isToolsUnsupportedError(new Error('401 invalid api key'))).toBe(false);
  });
});

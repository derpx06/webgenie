import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeLLM, invokeTools, isToolsUnsupportedError, rateLimitDelayMs, readFinish, retryDelayHint } from '../base';
import { isAbortedError, isQuotaExhaustedError, isRateLimitError, ResponseParseError } from '../errors';
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

});

describe('slow calls', () => {
  const hang = (signal?: AbortSignal) =>
    new Promise<AIMessage>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Aborted'))));

  it('sends a duplicate of a slow call and returns the first answer, long before the time limit', async () => {
    const { chatModel, stub } = stubModel([hang, new AIMessage({ content: 'from the duplicate' })]);
    const startedAt = Date.now();

    const reply = await invokeLLM(chatModel, packet, { component: 'test', timeoutMs: 5_000, hedgeAfterMs: 30 });

    expect(reply.text).toBe('from the duplicate');
    expect(stub.invoke).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('fails at once, without a duplicate, when a call fails before it is slow', async () => {
    const { chatModel, stub } = stubModel([() => Promise.reject(new Error('400 Bad Request')), new AIMessage({ content: 'never' })]);
    await expect(invokeLLM(chatModel, packet, { component: 'test', timeoutMs: 5_000, hedgeAfterMs: 2_000 })).rejects.toThrow('400');
    expect(stub.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('rate limits and quotas', () => {
  it("waits as long as the provider asks, capped at 30 s, and otherwise backs off with jitter", () => {
    expect(retryDelayHint(new Error('429 {"error":{"details":[{"retryDelay":"12s"}]}}'))).toBe(12_000);
    expect(retryDelayHint(new Error('429 Too Many Requests; Retry-After: 7'))).toBe(7_000);
    expect(retryDelayHint(new Error('429 Resource exhausted'))).toBeNull();
    expect(rateLimitDelayMs(new Error('429 {"retryDelay":"90s"}'), 0)).toBe(30_000);
    expect(rateLimitDelayMs(new Error('429'), 0, () => 0)).toBe(1_000);
    expect(rateLimitDelayMs(new Error('429'), 0, () => 1)).toBe(2_000);
    expect(rateLimitDelayMs(new Error('429'), 3, () => 0)).toBe(15_000);
    expect(rateLimitDelayMs(new Error('429'), 5, () => 1)).toBe(30_000);
  });

  it('treats a spent billing or daily quota as final, and a per-minute limit as a rate limit', async () => {
    const spent = new Error('429 You exceeded your current quota, please check your plan and billing details.');
    expect(isQuotaExhaustedError(spent)).toBe(true);
    expect(isRateLimitError(spent)).toBe(false);
    expect(isRateLimitError(new Error('Google request failed with status code 429: RESOURCE_EXHAUSTED'))).toBe(true);

    const { chatModel, stub } = stubModel([() => Promise.reject(spent), new AIMessage({ content: 'never' })]);
    await expect(invokeLLM(chatModel, packet, { component: 'test', rateLimitDelaysMs: [1, 1] })).rejects.toThrow('quota');
    expect(stub.invoke).toHaveBeenCalledTimes(1);
  });

  it('holds other calls to the same model until a rate limit has cooled down', async () => {
    const first = stubModel([() => Promise.reject(new Error('429 Resource exhausted')), new AIMessage({ content: 'first' })]);
    const second = stubModel([new AIMessage({ content: 'second' })]);
    const options = { component: 'test', model: 'shared-model', rateLimitDelaysMs: [80] };

    const firstCall = invokeLLM(first.chatModel, packet, options);
    await new Promise(resolve => setTimeout(resolve, 10));
    const startedAt = Date.now();
    const secondCall = invokeLLM(second.chatModel, packet, options);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(second.stub.invoke).not.toHaveBeenCalled();

    expect((await secondCall).text).toBe('second');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
    expect((await firstCall).text).toBe('first');
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

  it('turns a repeated timeout into a plain error, not a user cancel', async () => {
    const hang = (signal?: AbortSignal) => new Promise<AIMessage>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Aborted'))));
    const { chatModel } = stubModel([hang, hang]);
    const error = await invokeLLM(chatModel, packet, { component: 'test', timeoutMs: 20 }).catch(e => e);
    expect(String(error.message)).toMatch(/timed out/);
    expect(isAbortedError(error)).toBe(false);
  });

  it('retries once after a transient provider failure or a slow response', async () => {
    const reply = new AIMessage({ content: 'ok' });
    const unavailable = stubModel([() => Promise.reject(new Error('Google request failed with status code 503: UNAVAILABLE')), reply]);
    expect((await invokeLLM(unavailable.chatModel, packet, { component: 'test' })).content).toBe('ok');

    const slow = stubModel([
      signal => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Aborted')))),
      reply,
    ]);
    expect((await invokeLLM(slow.chatModel, packet, { component: 'test', timeoutMs: 20 })).content).toBe('ok');

    const badRequest = stubModel([() => Promise.reject(new Error('400 INVALID_ARGUMENT: bad schema')), reply]);
    await expect(invokeLLM(badRequest.chatModel, packet, { component: 'test' })).rejects.toThrow(/INVALID_ARGUMENT/);
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

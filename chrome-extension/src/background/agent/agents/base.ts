import type { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { LlmCapabilities } from '@extension/storage';
import type { AgentContext, AgentOutput } from '../types';
import type { BasePrompt } from '../prompts/base';
import { record } from '@src/background/trace';
import type { ToolDefinition } from '../actions/builder';
import {
  convertMessagesForNonFunctionCallingModels,
  extractJsonFromModelOutput,
  mergeSuccessiveMessages,
  removeThinkTags,
} from '../messages/utils';
import { isBadRequestError, isNetworkError, isRateLimitError, ResponseParseError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallOptions = Record<string, any>;

export type ToolMode = Pick<LlmCapabilities, 'nativeTools' | 'forceToolChoice'> & Partial<Pick<LlmCapabilities, 'callTimeoutMs'>>;

export interface BaseAgentOptions {
  chatLLM: BaseChatModel;
  context: AgentContext;
  prompt: BasePrompt;
  /** From the capability table; defaults to native, forced tool calling. */
  toolMode?: ToolMode;
}
export interface ExtraAgentOptions {
  id?: string;
  callOptions?: CallOptions;
}

/**
 * Base class for all agents
 * @param M - The type of the result field of the agent output
 */
export abstract class BaseAgent<M = unknown> {
  protected id: string;
  protected chatLLM: BaseChatModel;
  protected prompt: BasePrompt;
  protected context: AgentContext;
  protected modelName: string;
  protected toolMode: ToolMode;
  protected callOptions?: CallOptions;

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    this.chatLLM = options.chatLLM;
    this.prompt = options.prompt;
    this.context = options.context;
    this.toolMode = options.toolMode ?? { nativeTools: true, forceToolChoice: true };
    this.id = extraOptions?.id || 'agent';
    this.callOptions = extraOptions?.callOptions;
    const model = this.chatLLM as unknown as Record<string, unknown>;
    this.modelName = String(model.modelName ?? model.model_name ?? model.model ?? 'Unknown');
  }

  public getChatLLM(): BaseChatModel {
    return this.chatLLM;
  }

  /** One validated round of tool calls. A provider that rejects the tools payload moves this agent to the prompt fallback. */
  protected async invokeWithTools(
    messages: BaseMessage[],
    tools: ToolDefinition[],
    validators: Record<string, z.AnyZodObject>,
  ): Promise<{ message: AIMessage; calls: ToolCallRequest[]; attempts: number }> {
    const run = () =>
      invokeTools({
        chatModel: this.chatLLM,
        messages,
        tools,
        validators,
        native: this.toolMode.nativeTools && typeof this.chatLLM.bindTools === 'function',
        forceToolChoice: this.toolMode.forceToolChoice,
        timeoutMs: this.toolMode.callTimeoutMs,
        component: this.id,
        model: this.modelName,
        signal: this.context.controller.signal,
        callbacks: this.context.traceCallbacks,
        callOptions: this.callOptions,
        onUsage: usage => this.context.messageManager.recordTokenUsage(usage.inputTokens, usage.outputTokens),
      });
    try {
      return await run();
    } catch (error) {
      if (!this.toolMode.nativeTools || !isToolsUnsupportedError(error)) throw error;
      record({
        level: 'warning',
        kind: 'llm',
        component: this.id,
        msg: 'provider rejected tools; using prompt-rendered tools for this task',
        data: { model: this.modelName, error },
      });
      this.toolMode = { nativeTools: false, forceToolChoice: false };
      return run();
    }
  }

  abstract execute(state: HumanMessage): Promise<AgentOutput<M>>;
}

// ── Provider-neutral LLM calls ───────────────────────────────────────────────
// Everything below consumes LangChain's normalized AIMessage (tool_calls, usage_metadata,
// response_metadata), so it behaves the same for every chat model adapter.

/** Limit for each attempt without a per-model limit: a response this slow is usually a one-off, so the retry starts fresh. */
export const LLM_CALL_TIMEOUTS_MS = [25_000, 37_500];
/**
 * A call still running after this long gets a duplicate request, and the first answer wins. Provider latency has a
 * long tail unrelated to the request (flash: median 2-3 s, yet some calls take 25-36 s for 70 output tokens), and a
 * second request usually escapes it. Roughly the p95 of successful calls, so few calls are duplicated.
 */
export const HEDGE_AFTER_MS = 10_000;
const SUPERSEDED = 'superseded by a faster duplicate request';
/**
 * Longest total wait for one call across rate-limit retries; after that the error goes up and the task pauses, saved.
 * A per-minute quota recovers in 20-60 s (run A: 38 of 63 rate-limited calls needed three or four retries, up to
 * about a minute), so a shorter budget paused long unattended tasks that would have gone on (B5).
 */
export const RATE_LIMIT_BUDGET_MS = 180_000;
/** When a model may be called again after a rate limit, shared by every caller in this worker (planner, navigator, checks). */
const cooldownUntil = new Map<string, number>();

/** A wait the provider asked for: Google's retryDelay ("30s") or a Retry-After value in seconds. */
export function retryDelayHint(error: unknown): number | null {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify((error as { cause?: unknown }).cause ?? '')}` : String(error);
  const google = /retryDelay\\?"?\s*:\s*\\?"(\d+(?:\.\d+)?)s/.exec(text);
  if (google) return Math.round(Number(google[1]) * 1000);
  const header = /retry-after\\?"?\s*[:=]\s*\\?"?(\d+)/i.exec(text);
  return header ? Number(header[1]) * 1000 : null;
}

/** The wait before rate-limit retry `attempt` (0-based): the provider's hint, else exponential backoff with jitter. */
export function rateLimitDelayMs(error: unknown, attempt: number, random: () => number = Math.random): number {
  const hint = retryDelayHint(error);
  if (hint !== null) return Math.min(hint, 30_000);
  const ceiling = Math.min(30_000, 2_000 * 3 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
const DEFAULT_MAX_REASKS = 2;

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export interface InvokeLLMOptions {
  component: string;
  model?: string;
  signal?: AbortSignal;
  callbacks?: CallOptions['callbacks'];
  callOptions?: CallOptions;
  timeoutMs?: number;
  onUsage?: (usage: LLMUsage) => void;
  /** Fixed waits before each retry of a rate-limited call (tests); by default the provider's hint or jittered backoff. */
  rateLimitDelaysMs?: number[];
  /** When to send a duplicate of a slow call (defaults to HEDGE_AFTER_MS); 0 never duplicates. */
  hedgeAfterMs?: number;
}

export interface InvokeToolsOptions extends InvokeLLMOptions {
  chatModel: BaseChatModel;
  messages: BaseMessage[];
  tools: ToolDefinition[];
  validators: Record<string, z.AnyZodObject>;
  /** Use native tool calling (bindTools); otherwise tools are rendered into the prompt and parsed from text. */
  native: boolean;
  /** Force the model to call a tool (LangChain tool_choice "any"). Ignored in fallback mode. */
  forceToolChoice?: boolean;
  maxReasks?: number;
}

interface InvokableModel {
  invoke(messages: BaseMessage[], options?: CallOptions): Promise<unknown>;
}

/** Reads the finish reason under any provider's key name. */
export function readFinish(meta: Record<string, unknown> | undefined): {
  reason: string;
  truncated: boolean;
  malformed: boolean;
} {
  const m = meta ?? {};
  const reason = String(m.finish_reason ?? m.finishReason ?? m.stop_reason ?? m.stopReason ?? m.done_reason ?? '');
  return {
    reason,
    truncated: /^(length|max_tokens)$/i.test(reason),
    malformed: /MALFORMED_FUNCTION_CALL/i.test(reason),
  };
}

export function readUsage(message: AIMessage): LLMUsage | null {
  const usage = message.usage_metadata as
    | {
        input_tokens?: number;
        output_tokens?: number;
        input_token_details?: { cache_read?: number };
        output_token_details?: { reasoning?: number };
      }
    | undefined;
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.input_token_details?.cache_read ?? 0,
    reasoningTokens: usage.output_token_details?.reasoning ?? 0,
  };
}

export function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/** A provider or OpenAI-compatible server that rejected the tools/tool_choice payload itself. */
export function isToolsUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return isBadRequestError(error) && /tool|function/i.test(message);
}

/** Instruction used when the model cannot call tools natively. */
export function renderToolsForPrompt(tools: ToolDefinition[]): string {
  return [
    'Respond with ONLY a JSON object of this exact shape and nothing else:',
    '{"tool_calls":[{"name":"<tool name>","args":{...}}]}',
    'Available tools, with JSON Schema for args:',
    JSON.stringify(
      tools.map(tool => ({ name: tool.function.name, description: tool.function.description, args: tool.function.parameters })),
    ),
  ].join('\n');
}

/** Tool calls from a reply: native tool_calls, or JSON parsed from the text in fallback mode. */
export function collectCalls(
  message: AIMessage,
  native: boolean,
): { calls: ToolCallRequest[]; parseErrors: Array<{ id: string; name: string; error: string }> } {
  if (native) {
    return {
      calls: (message.tool_calls ?? []).map((call, i) => ({
        id: call.id ?? `call_${i}`,
        name: call.name,
        args: (call.args ?? {}) as Record<string, unknown>,
      })),
      parseErrors: (message.invalid_tool_calls ?? []).map((call, i) => ({
        id: call.id ?? `invalid_${i}`,
        name: call.name ?? 'unknown',
        error: `arguments are not valid JSON (${call.error ?? 'parse error'})`,
      })),
    };
  }
  const text = removeThinkTags(message.text ?? '');
  if (!text.trim()) return { calls: [], parseErrors: [] };
  try {
    const json = extractJsonFromModelOutput(text);
    const raw = Array.isArray(json.tool_calls) ? json.tool_calls : 'name' in json ? [json] : [];
    const calls = raw
      .filter((c): c is { name: string; args?: unknown } => !!c && typeof c === 'object' && typeof c.name === 'string')
      .map((c, i) => ({
        id: `fb_${i}`,
        name: c.name,
        args: c.args && typeof c.args === 'object' ? (c.args as Record<string, unknown>) : {},
      }));
    return { calls, parseErrors: [] };
  } catch (error) {
    return {
      calls: [],
      parseErrors: [
        { id: 'fb_0', name: 'unknown', error: `reply is not valid JSON (${error instanceof Error ? error.message : String(error)})` },
      ],
    };
  }
}

/** Fallback transcripts carry no tool roles and never two same-role messages in a row (DeepSeek R1 rejects both). */
function asPlainTranscript(messages: BaseMessage[]): BaseMessage[] {
  const plain = convertMessagesForNonFunctionCallingModels(messages);
  return mergeSuccessiveMessages(mergeSuccessiveMessages(plain, HumanMessage), AIMessage);
}

function waitUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** A failure worth one immediate retry: a timeout, a 5xx or an interrupted connection. */
export function isTransientLLMError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /timed out|\b(500|502|503|504)\b|UNAVAILABLE|\bINTERNAL\b|ECONNRESET|ETIMEDOUT|fetch failed|network ?error|socket hang up/i.test(text);
}

/** The single path for every LLM request: timeout, abort, retries, trace record and usage accounting. */
export async function invokeLLM(
  model: InvokableModel,
  messages: BaseMessage[],
  options: InvokeLLMOptions,
): Promise<AIMessage> {
  const timeouts = options.timeoutMs ? [options.timeoutMs, Math.round(options.timeoutMs * 1.5)] : LLM_CALL_TIMEOUTS_MS;
  const cooldownKey = options.model ?? 'default';
  let rateLimitRetries = 0;
  let rateLimitWaitedMs = 0;
  let transientRetries = 0;
  for (;;) {
    // Another call to this model was just rate limited: wait it out instead of spending a request on another 429.
    const cooling = (cooldownUntil.get(cooldownKey) ?? 0) - Date.now();
    if (cooling > 0) await waitUnlessAborted(cooling, options.signal);
    try {
      return await invokeHedged(model, messages, { ...options, timeoutMs: timeouts[transientRetries] });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A lost connection waits like a rate limit: an outage of a minute or two should not end the task (run C).
      const offline = isNetworkError(error);
      if (isRateLimitError(error) || offline) {
        const fixed = options.rateLimitDelaysMs;
        const delay = fixed ? fixed[rateLimitRetries] : rateLimitDelayMs(error, rateLimitRetries);
        if (delay === undefined || (!fixed && rateLimitWaitedMs + delay > RATE_LIMIT_BUDGET_MS)) throw error;
        rateLimitRetries++;
        rateLimitWaitedMs += delay;
        cooldownUntil.set(cooldownKey, Math.max(cooldownUntil.get(cooldownKey) ?? 0, Date.now() + delay));
        record({
          level: 'warning',
          kind: 'llm',
          component: options.component,
          msg: `${offline ? 'provider unreachable' : 'rate limited'}; retrying in ${(delay / 1000).toFixed(1)}s`,
          data: { model: options.model, attempt: rateLimitRetries, hinted: retryDelayHint(error) !== null },
        });
        await waitUnlessAborted(delay, options.signal);
        continue;
      }
      if (transientRetries + 1 >= timeouts.length || !isTransientLLMError(error)) throw error;
      transientRetries++;
      record({
        level: 'warning',
        kind: 'llm',
        component: options.component,
        msg: 'transient failure; retrying once',
        data: { model: options.model, error },
      });
    }
  }
}

/**
 * One call within its time limit, duplicated once if it is still running after hedgeAfterMs; the first answer wins and
 * the other request is cancelled. A call that fails before it is slow fails at once (a rate limit, a bad request).
 */
function invokeHedged(model: InvokableModel, messages: BaseMessage[], options: InvokeLLMOptions): Promise<AIMessage> {
  const timeoutMs = options.timeoutMs ?? LLM_CALL_TIMEOUTS_MS[0];
  const hedgeAfterMs = options.hedgeAfterMs ?? HEDGE_AFTER_MS;
  if (hedgeAfterMs <= 0 || hedgeAfterMs >= timeoutMs) return invokeOnce(model, messages, options);

  const startedAt = Date.now();
  const controllers: AbortController[] = [];
  return new Promise<AIMessage>((resolve, reject) => {
    let running = 0;
    let finished = false;
    const finish = (settle: () => void) => {
      finished = true;
      clearTimeout(hedgeTimer);
      for (const controller of controllers) controller.abort(SUPERSEDED);
      settle();
    };
    const launch = (budgetMs: number) => {
      const controller = new AbortController();
      controllers.push(controller);
      const forward = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) controller.abort(options.signal.reason);
      else options.signal?.addEventListener('abort', forward, { once: true });
      running++;
      invokeOnce(model, messages, { ...options, timeoutMs: budgetMs, signal: controller.signal })
        .then(
          reply => {
            if (!finished) finish(() => resolve(reply));
          },
          error => {
            running--;
            if (!finished && running === 0) finish(() => reject(error));
          },
        )
        .finally(() => options.signal?.removeEventListener('abort', forward));
    };
    const hedgeTimer = setTimeout(() => {
      if (finished) return;
      record({
        level: 'warning',
        kind: 'llm',
        component: options.component,
        msg: 'slow call; sending a duplicate request',
        data: { model: options.model, afterMs: hedgeAfterMs },
      });
      launch(Math.max(1_000, timeoutMs - (Date.now() - startedAt)));
    }, hedgeAfterMs);
    launch(timeoutMs);
  });
}

async function invokeOnce(
  model: InvokableModel,
  messages: BaseMessage[],
  options: InvokeLLMOptions,
): Promise<AIMessage> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? LLM_CALL_TIMEOUTS_MS[0];
  const promptChars = messages.reduce(
    (total, message) =>
      total + (typeof message.content === 'string' ? message.content.length : JSON.stringify(message.content).length),
    0,
  );
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = (await model.invoke(messages, {
      ...options.callOptions,
      signal: controller.signal,
      callbacks: options.callbacks,
    })) as AIMessage;
    const usage = readUsage(response);
    if (usage) options.onUsage?.(usage);
    record({
      level: 'info',
      kind: 'llm',
      component: options.component,
      msg: `llm call ${options.model ?? ''}`.trim(),
      durationMs: Date.now() - startedAt,
      data: {
        model: options.model,
        messages: messages.length,
        promptChars,
        finishReason: readFinish(response.response_metadata).reason || undefined,
        usage,
        toolCalls: response.tool_calls?.length ?? 0,
        invalidToolCalls: response.invalid_tool_calls?.length ?? 0,
        textChars: response.text?.length ?? 0,
      },
    });
    return response;
  } catch (error) {
    const finalError = timedOut && !options.signal?.aborted ? new Error(`LLM call timed out after ${timeoutMs}ms`) : error;
    // The duplicate of this call answered first: not a failure.
    const superseded = options.signal?.reason === SUPERSEDED;
    record({
      level: superseded ? 'info' : 'error',
      kind: 'llm',
      component: options.component,
      msg: superseded ? `llm call ${options.model ?? ''} superseded`.replace('  ', ' ') : `llm call ${options.model ?? ''} failed`.replace('  ', ' '),
      durationMs: Date.now() - startedAt,
      data: { model: options.model, messages: messages.length, promptChars, error: finalError },
    });
    throw finalError;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Ask the model for tool calls and validate them. Invalid calls are sent back with their
 * validation issues (one ToolMessage per call id when native), up to `maxReasks` times.
 */
export async function invokeTools(
  options: InvokeToolsOptions,
): Promise<{ message: AIMessage; calls: ToolCallRequest[]; attempts: number }> {
  const maxReasks = options.maxReasks ?? DEFAULT_MAX_REASKS;
  let model: InvokableModel = options.chatModel;
  if (options.native) {
    if (typeof options.chatModel.bindTools !== 'function') {
      throw new Error(`${options.model ?? 'model'} does not support tool calling`);
    }
    model = options.chatModel.bindTools(options.tools, options.forceToolChoice ? { tool_choice: 'any' } : {});
  }
  const base = options.native ? options.messages : [...options.messages, new HumanMessage(renderToolsForPrompt(options.tools))];
  let messages = base;
  let lastProblem = '';

  for (let attempt = 0; attempt <= maxReasks; attempt++) {
    const message = await invokeLLM(model, options.native ? messages : asPlainTranscript(messages), options);
    const { calls, parseErrors } = collectCalls(message, options.native);

    if (calls.length === 0 && parseErrors.length === 0) {
      const finish = readFinish(message.response_metadata);
      lastProblem = finish.truncated
        ? 'the reply was cut off at the output token limit'
        : finish.malformed
          ? 'the function call was malformed'
          : 'the reply contained no tool call';
      const previous = message.text?.trim() ? ` Previous reply: ${message.text.trim().slice(0, 300)}` : '';
      messages = [
        ...base,
        new HumanMessage(`You must respond by calling one of the provided tools (${lastProblem}). Keep arguments short.${previous}`),
      ];
      continue;
    }

    const problems = new Map<string, string>(parseErrors.map(error => [error.id, error.error]));
    for (const call of calls) {
      const validator = options.validators[call.name];
      if (!validator) {
        problems.set(call.id, `unknown tool "${call.name}"; use one of: ${Object.keys(options.validators).join(', ')}`);
        continue;
      }
      const parsed = validator.safeParse(call.args);
      if (!parsed.success) {
        problems.set(call.id, `invalid arguments: ${formatIssues(parsed.error.issues)}`);
        continue;
      }
      call.args = parsed.data;
    }
    if (problems.size === 0) return { message, calls, attempts: attempt + 1 };

    lastProblem = [...problems.values()].join(' | ');
    record({
      level: 'warning',
      kind: 'llm',
      component: options.component,
      msg: 'tool call validation failed',
      data: { attempt, issues: Object.fromEntries(problems), calls, text: message.text?.slice(0, 500) },
    });
    const ids = [...calls.map(call => call.id), ...parseErrors.map(error => error.id)];
    // ToolMessage feedback only for a single call: adapters pair parallel results inconsistently, and a result
    // for an invalid_tool_call has no call to answer (OpenAI rejects it).
    const canPair = options.native && parseErrors.length === 0 && calls.length === 1 && !!message.tool_calls?.[0]?.id;
    messages = canPair
      ? [
          ...base,
          message,
          ...ids.map(
            id =>
              new ToolMessage({
                tool_call_id: id,
                content: problems.has(id)
                  ? `Error: ${problems.get(id)}. Call the tool again with valid arguments.`
                  : 'Not executed: another call in this turn was invalid; resend all calls.',
              }),
          ),
        ]
      : [
          ...base,
          new HumanMessage(`Your previous tool calls were invalid: ${lastProblem}. Call the tools again with valid arguments.`),
        ];
  }

  record({
    level: 'error',
    kind: 'llm',
    component: options.component,
    msg: 'no valid tool call after re-asks',
    data: { attempts: maxReasks + 1, lastProblem },
  });
  throw new ResponseParseError(`No valid tool call after ${maxReasks + 1} attempts: ${lastProblem}`);
}

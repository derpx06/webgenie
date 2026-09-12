import type { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentContext, AgentOutput } from '../types';
import type { BasePrompt } from '../prompts/base';
import { HumanMessage, ToolMessage, type AIMessage, type BaseMessage } from '@langchain/core/messages';
import { createLogger } from '@src/background/log';
import { record } from '@src/background/trace';
import {
  buildProviderSafeJsonSchema,
  isProviderSchemaPayloadError,
  shouldBypassStructuredOutput,
} from '@src/background/utils';
import type { Action, ToolDefinition } from '../actions/builder';
import { convertInputMessages, extractJsonFromModelOutput, removeThinkTags } from '../messages/utils';
import { isBadRequestError, ResponseParseError } from './errors';

const logger = createLogger('agent');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallOptions = Record<string, any>;
interface TokenUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface RawResponseWithUsage {
  usage_metadata?: TokenUsageLike;
  additional_kwargs?: {
    tokenUsage?: TokenUsageLike;
  };
}

const MANUAL_JSON_OUTPUT_INSTRUCTION =
  'Return ONLY one valid JSON object matching the requested response format. Do not include markdown, code fences, prose, comments, or any text before or after the JSON.';

const MANUAL_JSON_RETRY_INSTRUCTION =
  'Your previous response was not valid JSON for the required schema. Retry now with ONLY one valid JSON object. No markdown, no explanation, no code fence.';
const STRUCTURED_OUTPUT_SCHEMA_BYTE_LIMIT = 12000;

// Update options to use Zod schema
export interface BaseAgentOptions {
  chatLLM: BaseChatModel;
  context: AgentContext;
  prompt: BasePrompt;
  provider?: string;
  useProviderStructuredOutput?: boolean;
}
export interface ExtraAgentOptions {
  id?: string;
  toolCallingMethod?: string;
  callOptions?: CallOptions;
}

/**
 * Base class for all agents
 * @param T - The Zod schema for the model output
 * @param M - The type of the result field of the agent output
 */
export abstract class BaseAgent<T extends z.ZodType, M = unknown> {
  protected id: string;
  protected chatLLM: BaseChatModel;
  protected prompt: BasePrompt;
  protected context: AgentContext;
  protected actions: Record<string, Action> = {};
  protected modelOutputSchema: T;
  protected toolCallingMethod: string | null;
  protected chatModelLibrary: string;
  protected modelName: string;
  protected provider: string;
  protected useProviderStructuredOutput: boolean;
  protected withStructuredOutput: boolean;
  protected callOptions?: CallOptions;
  protected modelOutputToolName: string;
  private providerSafeSchema: Record<string, unknown> | null = null;
  declare ModelOutput: z.infer<T>;

  constructor(modelOutputSchema: T, options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    // base options
    this.modelOutputSchema = modelOutputSchema;
    this.chatLLM = options.chatLLM;
    this.prompt = options.prompt;
    this.context = options.context;
    this.provider = options.provider || '';
    this.useProviderStructuredOutput = options.useProviderStructuredOutput ?? true;
    // TODO: fix this, the name is not correct in production environment
    this.chatModelLibrary = this.chatLLM.constructor.name;
    this.modelName = this.getModelName();
    // extra options
    this.id = extraOptions?.id || 'agent';
    this.toolCallingMethod = this.setToolCallingMethod(extraOptions?.toolCallingMethod);
    this.callOptions = extraOptions?.callOptions;
    this.modelOutputToolName = `${this.id}_output`;
    this.withStructuredOutput = this.setWithStructuredOutput();
  }

  public getChatLLM(): BaseChatModel {
    return this.chatLLM;
  }

  // Set the model name
  private getModelName(): string {
    if ('modelName' in this.chatLLM) {
      return this.chatLLM.modelName as string;
    }
    if ('model_name' in this.chatLLM) {
      return this.chatLLM.model_name as string;
    }
    if ('model' in this.chatLLM) {
      return this.chatLLM.model as string;
    }
    return 'Unknown';
  }

  // Set the tool calling method
  private setToolCallingMethod(toolCallingMethod?: string): string | null {
    if (toolCallingMethod === 'auto') {
      switch (this.chatModelLibrary) {
        case 'ChatGoogleGenerativeAI':
          return null;
        case 'ChatOpenAI':
        case 'AzureChatOpenAI':
        case 'ChatGroq':
        case 'ChatXAI':
          return 'function_calling';
        default:
          return null;
      }
    }
    return toolCallingMethod || null;
  }

  // Provider structured output is only used for small, fixed schemas. Browser
  // navigator action schemas are often too large or provider-dialect-sensitive,
  // so those calls automatically stay in manual JSON mode.
  private setWithStructuredOutput(): boolean {
    if (!this.useProviderStructuredOutput) {
      logger.debug(`[${this.modelName}] Structured output disabled for ${this.id}`);
      return false;
    }
    if (shouldBypassStructuredOutput(this.provider, this.chatModelLibrary, this.modelName)) {
      logger.debug(`[${this.modelName}] Structured output bypassed for provider/model`);
      return false;
    }
    if (!this.chatLLM || typeof (this.chatLLM as { withStructuredOutput?: unknown }).withStructuredOutput !== 'function') {
      logger.debug(`[${this.modelName}] Structured output unavailable on chat model`);
      return false;
    }

    try {
      const schema = buildProviderSafeJsonSchema(this.modelOutputSchema, this.modelOutputToolName, true);
      const schemaBytes = JSON.stringify(schema).length;
      if (schemaBytes > STRUCTURED_OUTPUT_SCHEMA_BYTE_LIMIT) {
        logger.info(`[${this.modelName}] Structured output bypassed because schema is too large`, {
          schemaBytes,
          limit: STRUCTURED_OUTPUT_SCHEMA_BYTE_LIMIT,
          toolName: this.modelOutputToolName,
        });
        return false;
      }
      this.providerSafeSchema = schema;
      logger.debug(`[${this.modelName}] Structured output enabled`, {
        schemaBytes,
        toolName: this.modelOutputToolName,
      });
      return true;
    } catch (error) {
      logger.warning(`[${this.modelName}] Structured output schema build failed; using manual JSON`, error);
      return false;
    }
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    if (this.withStructuredOutput) {
      return this.invokeWithStructuredOutput(inputMessages);
    }
    return this.invokeWithoutStructuredOutput(inputMessages);
  }

  private async invokeWithStructuredOutput(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    const convertedInputMessages = convertInputMessages(inputMessages, this.modelName);
    try {
      const structuredModel = (this.chatLLM as unknown as {
        withStructuredOutput: (schema: unknown, options?: Record<string, unknown>) => {
          invoke: (messages: BaseMessage[], options?: CallOptions) => Promise<unknown>;
        };
      }).withStructuredOutput(this.providerSafeSchema ?? this.modelOutputSchema, {
        name: this.modelOutputToolName,
        method: this.toolCallingMethod ?? undefined,
      });
      const response = await structuredModel.invoke(convertedInputMessages, {
        signal: this.context.controller.signal,
        callbacks: this.context.traceCallbacks || [],
        ...this.callOptions,
      });
      return this.validateModelOutput(response);
    } catch (error) {
      if (isProviderSchemaPayloadError(error)) {
        logger.warning(`[${this.modelName}] Provider structured output rejected schema; downgrading to manual JSON`, {
          provider: this.provider,
          chatModelLibrary: this.chatModelLibrary,
          modelName: this.modelName,
          schemaBytes: this.providerSafeSchema ? JSON.stringify(this.providerSafeSchema).length : 0,
          error: error instanceof Error ? error.message : String(error),
        });
        this.withStructuredOutput = false;
        return this.invokeWithoutStructuredOutput(inputMessages);
      }
      logger.error(`[${this.modelName}] LLM call failed in structured output mode:`, error);
      throw error;
    }
  }

  protected async invokeWithoutStructuredOutput(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    // Fallback: Without structured output support, need to extract JSON from model output manually
    logger.debug(`[${this.modelName}] Using manual JSON extraction fallback method`);
    const convertedInputMessages = this.buildManualJsonMessages(inputMessages);

    try {
      const response = await this.invokeRawModel(convertedInputMessages);

      const parsed = this.parseRawResponseContent(response);
      if (parsed) {
        return parsed;
      }

      logger.warning(`[${this.modelName}] Manual JSON extraction failed; retrying once with stricter JSON instruction`);
      const retryResponse = await this.invokeRawModel([
        ...convertedInputMessages,
        new HumanMessage({ content: this.getManualJsonRetryInstruction() }),
      ]);
      const retryParsed = this.parseRawResponseContent(retryResponse);
      if (retryParsed) {
        return retryParsed;
      }
    } catch (error) {
      logger.error(`[${this.modelName}] LLM call failed in manual extraction mode:`, error);
      throw error;
    }
    const errorMessage = `Failed to parse response from ${this.modelName}`;
    logger.error(errorMessage);
    throw new ResponseParseError('Could not parse response');
  }

  private buildManualJsonMessages(inputMessages: BaseMessage[]): BaseMessage[] {
    return [
      ...convertInputMessages(inputMessages, this.modelName),
      new HumanMessage({ content: this.getManualJsonOutputInstruction() }),
    ];
  }

  protected getManualJsonOutputInstruction(): string {
    return MANUAL_JSON_OUTPUT_INSTRUCTION;
  }

  protected getManualJsonRetryInstruction(): string {
    return MANUAL_JSON_RETRY_INSTRUCTION;
  }

  private async invokeRawModel(inputMessages: BaseMessage[]): Promise<unknown> {
    const startedAt = Date.now();
    const promptChars = inputMessages.reduce(
      (total, message) => total + (typeof message.content === 'string' ? message.content.length : JSON.stringify(message.content).length),
      0,
    );
    try {
      const response = await this.chatLLM.invoke(inputMessages, {
        signal: this.context.controller.signal,
        callbacks: this.context.traceCallbacks || [],
        ...this.callOptions,
      });
      const { content, response_metadata: meta = {}, usage_metadata: usage } = response as {
        content?: unknown;
        response_metadata?: Record<string, unknown>;
        usage_metadata?: unknown;
      };
      record({
        level: 'info',
        kind: 'llm',
        component: this.id,
        msg: `llm call ${this.modelName}`,
        durationMs: Date.now() - startedAt,
        data: {
          model: this.modelName,
          messages: inputMessages.length,
          promptChars,
          finishReason: meta.finish_reason ?? meta.stop_reason ?? meta.finishReason,
          usage,
          contentChars: typeof content === 'string' ? content.length : undefined,
        },
      });
      return response;
    } catch (error) {
      record({
        level: 'error',
        kind: 'llm',
        component: this.id,
        msg: `llm call ${this.modelName} failed`,
        durationMs: Date.now() - startedAt,
        data: { model: this.modelName, messages: inputMessages.length, promptChars, error },
      });
      throw error;
    }
  }

  private parseRawResponseContent(response: unknown): this['ModelOutput'] | undefined {
    if (response && typeof response === 'object' && 'content' in response) {
      const content = (response as { content?: unknown }).content;
      if (typeof content === 'string') {
        const parsed = this.manuallyParseResponse(content);
        if (parsed) {
          // Record token usage for fallback response
          const typedResponse = response as RawResponseWithUsage;
          if (typedResponse.usage_metadata) {
            this.context.messageManager.recordTokenUsage(
              typedResponse.usage_metadata.input_tokens || 0,
              typedResponse.usage_metadata.output_tokens || 0
            );
          }
          return parsed;
        }
      }
    }
    return undefined;
  }

  // Execute the agent and return the result
  abstract execute(): Promise<AgentOutput<M>>;

  // Helper method to validate metadata
  protected validateModelOutput(data: unknown): this['ModelOutput'] | undefined {
    if (!this.modelOutputSchema || !data) return undefined;
    try {
      return this.modelOutputSchema.parse(data);
    } catch (error) {
      logger.error('validateModelOutput', error);
      throw new ResponseParseError('Could not validate model output');
    }
  }

  // Helper method to manually parse the response content
  protected manuallyParseResponse(content: string): this['ModelOutput'] | undefined {
    const cleanedContent = removeThinkTags(content);
    try {
      const extractedJson = extractJsonFromModelOutput(cleanedContent);
      const parsed = this.modelOutputSchema.safeParse(extractedJson);
      if (parsed.success) {
        return parsed.data;
      }
      logger.warning(`[${this.modelName}] Manual JSON output failed schema validation; retrying if possible`, {
        issues: parsed.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
        preview: JSON.stringify(extractedJson).slice(0, 1000),
        content: cleanedContent,
      });
      return undefined;
    } catch (error) {
      logger.warning(`[${this.modelName}] Manual JSON extraction failed; retrying if possible`, { content: cleanedContent, error });
      return undefined;
    }
  }
}

// ── Provider-neutral LLM calls ───────────────────────────────────────────────
// Everything below consumes LangChain's normalized AIMessage (tool_calls, usage_metadata,
// response_metadata), so it behaves the same for every chat model adapter.

export const LLM_CALL_TIMEOUT_MS = 60_000;
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
  /** Tool names allowed by the current plan; empty or undefined means no restriction. */
  allowedActions?: string[];
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

/** The single path for every LLM request: timeout, abort, trace record and usage accounting. */
export async function invokeLLM(
  model: InvokableModel,
  messages: BaseMessage[],
  options: InvokeLLMOptions,
): Promise<AIMessage> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? LLM_CALL_TIMEOUT_MS;
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
    record({
      level: 'error',
      kind: 'llm',
      component: options.component,
      msg: `llm call ${options.model ?? ''} failed`.replace('  ', ' '),
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
    const message = await invokeLLM(model, messages, options);
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
      if (options.allowedActions?.length && !options.allowedActions.includes(call.name)) {
        problems.set(call.id, `"${call.name}" is not allowed by the current plan; allowed: ${options.allowedActions.join(', ')}`);
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
    const canPair = options.native && (message.tool_calls ?? []).every(call => !!call.id);
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

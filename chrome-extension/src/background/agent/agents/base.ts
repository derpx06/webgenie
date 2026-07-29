import type { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentContext, AgentOutput } from '../types';
import type { BasePrompt } from '../prompts/base';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { createLogger } from '@src/background/log';
import {
  buildProviderSafeJsonSchema,
  isProviderSchemaPayloadError,
  shouldBypassStructuredOutput,
} from '@src/background/utils';
import type { Action } from '../actions/builder';
import { convertInputMessages, extractJsonFromModelOutput, removeThinkTags } from '../messages/utils';
import { ResponseParseError } from './errors';

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
    return this.chatLLM.invoke(inputMessages, {
        signal: this.context.controller.signal,
        callbacks: this.context.traceCallbacks || [],
        ...this.callOptions,
      });
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
      });
      return undefined;
    } catch (error) {
      logger.warning(`[${this.modelName}] Manual JSON extraction failed; retrying if possible`);
      return undefined;
    }
  }
}

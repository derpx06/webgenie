import { type BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage, type MessageContent } from '@langchain/core/messages';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
  type?: 'tool_call';
}

export enum PyramidLevel {
  INIT = 'init',
  LIVE = 'live',
  TRACE = 'trace',
  MILESTONE = 'milestone',
}

export class MessageMetadata {
  tokens: number;
  message_type: string | null = null;
  level?: PyramidLevel;

  constructor(tokens: number, message_type?: string | null, level?: PyramidLevel) {
    this.tokens = tokens;
    this.message_type = message_type ?? null;
    this.level = level;
  }
}

export class ManagedMessage {
  message: BaseMessage;
  metadata: MessageMetadata;

  constructor(message: BaseMessage, metadata: MessageMetadata) {
    this.message = message;
    this.metadata = metadata;
  }
}

export class MessageHistory {
  messages: ManagedMessage[] = [];
  totalTokens = 0;
  cumulativeInputTokens = 0;
  cumulativeOutputTokens = 0;

  updateCumulativeTokens(input: number, output: number): void {
    this.cumulativeInputTokens += input;
    this.cumulativeOutputTokens += output;
  }

  addMessage(message: BaseMessage, metadata: MessageMetadata, position?: number): void {
    const managedMessage: ManagedMessage = {
      message,
      metadata,
    };

    if (position === undefined) {
      this.messages.push(managedMessage);
    } else {
      this.messages.splice(position, 0, managedMessage);
    }
    this.totalTokens += metadata.tokens;
  }

  removeMessage(index = -1): void {
    if (this.messages.length > 0) {
      const msg = this.messages.splice(index, 1)[0];
      this.totalTokens -= msg.metadata.tokens;
    }
  }

  /**
   * Removes the last message from the history if it is a human message.
   * This is used to remove the state message from the history.
   */
  removeLastStateMessage(): void {
    if (this.messages.length > 0 && this.messages[this.messages.length - 1].metadata.message_type === 'page_state') {
      const msg = this.messages.pop();
      if (msg) {
        this.totalTokens -= msg.metadata.tokens;
      }
    }
  }

  /**
   * Get all messages
   */
  getMessages(): BaseMessage[] {
    return this.messages.map(m => m.message);
  }

  /**
   * Get total tokens in history
   */
  getTotalTokens(): number {
    return this.totalTokens;
  }

  /**
   * Remove oldest non-system message
   */
  removeOldestMessage(): void {
    for (let i = 0; i < this.messages.length; i++) {
      if (!(this.messages[i].message instanceof SystemMessage)) {
        const msg = this.messages.splice(i, 1)[0];
        this.totalTokens -= msg.metadata.tokens;
        break;
      }
    }
  }
}

export interface SerializedMessage {
  type: string;
  content: MessageContent;
  id?: string;
  name?: string;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
  tool_calls?: unknown[];
  tool_call_id?: string;
  _type?: string;
}

export interface SerializedManagedMessage {
  message: SerializedMessage;
  metadata: {
    tokens: number;
    message_type: string | null;
    level?: string;
  };
}

export interface SerializedHistoryData {
  messages: SerializedManagedMessage[];
  totalTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
}

export function serializeHistory(history: MessageHistory): SerializedHistoryData {
  return {
    messages: history.messages.map(m => {
      const message = m.message;
      const serializedMessage: SerializedMessage = {
        type: message._getType(),
        content: message.content,
        id: message.id,
        name: message.name,
        additional_kwargs: message.additional_kwargs as Record<string, unknown> | undefined,
        response_metadata: message.response_metadata as Record<string, unknown> | undefined,
      };

      if (message instanceof AIMessage) {
        serializedMessage.tool_calls = message.tool_calls;
      } else if (message instanceof ToolMessage) {
        serializedMessage.tool_call_id = message.tool_call_id;
      }

      return {
        message: serializedMessage,
        metadata: {
          tokens: m.metadata.tokens,
          message_type: m.metadata.message_type,
          level: m.metadata.level,
        },
      };
    }),
    totalTokens: history.totalTokens,
    cumulativeInputTokens: history.cumulativeInputTokens,
    cumulativeOutputTokens: history.cumulativeOutputTokens,
  };
}

export function deserializeHistory(data: unknown): MessageHistory {
  const history = new MessageHistory();
  if (!data || typeof data !== 'object') return history;

  const dataObj = data as Record<string, unknown>;

  history.totalTokens = (dataObj.totalTokens as number) || 0;
  history.cumulativeInputTokens = (dataObj.cumulativeInputTokens as number) || 0;
  history.cumulativeOutputTokens = (dataObj.cumulativeOutputTokens as number) || 0;

  if (Array.isArray(dataObj.messages)) {
    history.messages = dataObj.messages.map((mObj: unknown) => {
      const m = mObj as SerializedManagedMessage;
      const msgData = m.message || {};
      const type = msgData.type || msgData._type;
      
      const content: MessageContent = typeof msgData.content === 'string'
        ? msgData.content
        : Array.isArray(msgData.content)
          ? msgData.content as MessageContent
          : '';

      const kwargs = {
        id: msgData.id,
        name: msgData.name,
        additional_kwargs: msgData.additional_kwargs,
        response_metadata: msgData.response_metadata,
      };

      let message: BaseMessage;
      switch (type) {
        case 'human':
          message = new HumanMessage({ content, ...kwargs });
          break;
        case 'ai':
          message = new AIMessage({
            content,
            tool_calls: msgData.tool_calls as ToolCall[] | undefined,
            ...kwargs,
          });
          break;
        case 'system':
          message = new SystemMessage({ content, ...kwargs });
          break;
        case 'tool':
          message = new ToolMessage({
            content,
            tool_call_id: msgData.tool_call_id || '',
            ...kwargs,
          });
          break;
        default:
          message = new HumanMessage({ content, ...kwargs });
      }

      const metadata = new MessageMetadata(
        m.metadata?.tokens || 0,
        m.metadata?.message_type,
        m.metadata?.level as PyramidLevel | undefined
      );
      return new ManagedMessage(message, metadata);
    });
  }

  return history;
}

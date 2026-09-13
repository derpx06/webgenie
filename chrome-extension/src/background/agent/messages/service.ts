import { type BaseMessage, AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { MessageHistory, MessageMetadata, serializeHistory, deserializeHistory } from '@src/background/agent/messages/views';
import { createLogger } from '@src/background/log';
import { redactSecrets } from '@src/background/trace';
import {
  defangTags,
  filterExternalContent,
  wrapUserRequest,
  splitUserTextAndAttachments,
  wrapAttachments,
  UNTRUSTED_CONTENT_TAG_END,
  UNTRUSTED_CONTENT_TAG_START,
} from '@src/background/agent/messages/utils';
import { analyticsSettingsStore, chatHistoryStore } from '@extension/storage';
import type { ActionResult } from '../types';

const logger = createLogger('MessageManager');

/** Result text kept per tool call; the full result is shown once, in the next step's page state. */
const MAX_TOOL_RESULT_CHARS = 1000;
const MAX_WORKING_MEMORY_CHARS = 2000;

/**
 * Transcript entry kinds read by the context builder. Entries with any other type
 * (written by older versions) stay in storage but are never sent to a model.
 */
export type TranscriptType = 'task' | 'human_answer' | 'turn_ai' | 'turn_tool';

export interface TranscriptEntry {
  message: BaseMessage;
  type: string | null;
}

export interface ToolTurnCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export class MessageManagerSettings {
  estimatedCharactersPerToken = 3;
  imageTokens = 800;
  sensitiveData?: Record<string, string>;

  constructor(
    options: { estimatedCharactersPerToken?: number; imageTokens?: number; sensitiveData?: Record<string, string> } = {},
  ) {
    if (options.estimatedCharactersPerToken !== undefined)
      this.estimatedCharactersPerToken = options.estimatedCharactersPerToken;
    if (options.imageTokens !== undefined) this.imageTokens = options.imageTokens;
    if (options.sensitiveData !== undefined) this.sensitiveData = options.sensitiveData;
  }
}

function describeResult(result: ActionResult | undefined): string {
  if (!result) return 'Not executed: an earlier action in this step stopped the sequence.';
  const parts: string[] = [];
  if (result.error) parts.push(`Error: ${result.error.split('\n').pop()}`);
  else if (result.validated === 'failed' && result.failureReason) parts.push(`Failed: ${result.failureReason}`);
  if (result.extractedContent) parts.push(result.extractedContent);
  if (parts.length === 0) {
    parts.push(result.validated === 'unknown' ? 'Done; the effect could not be confirmed on the page.' : 'Done.');
  }
  const text = parts.join('\n');
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  const clipped = text.slice(0, MAX_TOOL_RESULT_CHARS);
  // Never leave an untrusted-content block open.
  const unclosed = clipped.lastIndexOf(UNTRUSTED_CONTENT_TAG_START) > clipped.lastIndexOf(UNTRUSTED_CONTENT_TAG_END);
  return `${clipped}${unclosed ? `\n${UNTRUSTED_CONTENT_TAG_END}` : ''}\n[result truncated]`;
}

export default class MessageManager {
  private history = new MessageHistory();
  private pendingInputTokens = 0;
  private pendingOutputTokens = 0;
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  /** The navigator's working memory, stored under `${sessionId}:wm` so it survives service-worker restarts. */
  private workingMemory = '';

  constructor(
    private readonly settings: MessageManagerSettings = new MessageManagerSettings(),
    private readonly sessionId: string | null = null,
    private readonly flushIntervalMs = 2000,
  ) {}

  /** Restores the transcript after a service-worker restart. An executor that already holds messages keeps its own. */
  public async loadFromSession(): Promise<void> {
    if (!this.sessionId || this.history.messages.length > 0) return;
    try {
      const data = await chrome.storage.session.get(this.sessionId);
      if (data?.[this.sessionId]) {
        this.history = deserializeHistory(data[this.sessionId]);
        logger.info(`Loaded message history from session storage for key: ${this.sessionId}`);
      }
    } catch (err) {
      logger.error(`Failed to load history from session storage:`, err);
    }
  }

  public async saveToSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await chrome.storage.session.set({ [this.sessionId]: serializeHistory(this.history) });
    } catch (err) {
      logger.error(`Failed to save history to session storage:`, err);
    }
  }

  // ── Working memory ────────────────────────────────────────────────────────

  public async setWorkingMemory(memory: string): Promise<void> {
    // The model may copy a password it read or typed into its memory; memory is saved to session storage, so a secret
    // registered this task is redacted first (final run C34: the typed password sat under `:wm`).
    this.workingMemory = redactSecrets(memory).slice(0, MAX_WORKING_MEMORY_CHARS);
    if (!this.sessionId) return;
    try {
      await chrome.storage.session.set({ [`${this.sessionId}:wm`]: this.workingMemory });
    } catch (err) {
      logger.error('Failed to persist working memory:', err);
    }
  }

  public getWorkingMemory(): string {
    return this.workingMemory;
  }

  public async loadWorkingMemory(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const key = `${this.sessionId}:wm`;
      const data = await chrome.storage.session.get(key);
      if (data?.[key]) {
        this.workingMemory = String(data[key]).slice(0, MAX_WORKING_MEMORY_CHARS);
      }
    } catch (err) {
      logger.error('Failed to load working memory:', err);
    }
  }

  // ── Transcript ────────────────────────────────────────────────────────────

  get cumulativeInputTokens(): number {
    return this.history.cumulativeInputTokens;
  }

  get cumulativeOutputTokens(): number {
    return this.history.cumulativeOutputTokens;
  }

  /** The user's latest task, as given. */
  public latestTask(): string {
    return this.history.messages.filter(m => m.metadata.message_type === 'task').at(-1)?.metadata.task ?? '';
  }

  /** Adds a user task, unless it is already the latest task (e.g. the executor resumed after a restart). */
  public addTask(task: string): void {
    const tasks = this.history.messages.filter(m => m.metadata.message_type === 'task');
    if (tasks.length > 0 && tasks[tasks.length - 1].metadata.task === task) return;

    const { userText, attachmentsInner } = splitUserTextAndAttachments(task);
    // Non-strict filtering keeps task details such as emails, names and URLs intact.
    const cleanedTask = filterExternalContent(userText, false);
    const intro = tasks.length > 0 ? 'Follow-up task (use the earlier conversation where relevant)' : 'Task';
    let content = wrapUserRequest(`${intro}: ${cleanedTask}`, false);
    if (attachmentsInner) {
      content += `\n\n${wrapAttachments(attachmentsInner)}`;
    }
    this.addMessage(new HumanMessage(content), 'task', task);
    void this.saveToSession();
  }

  /**
   * Adds the user's answer. Each secret (a password the user typed) is replaced by a placeholder such as {{secret_1}},
   * so no model ever sees it; the returned map (placeholder → value) lets the navigator type the real value.
   */
  public addHumanAnswer(answer: string, secrets: string[] = []): Map<string, string> {
    const placeholders = new Map<string, string>();
    let text = answer;
    let used = this.history.messages.reduce((n, m) => n + (String(m.message?.content ?? '').match(/\{\{secret_\d+\}\}/g)?.length ?? 0), 0);
    for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) {
      if (!text.includes(secret)) continue;
      const placeholder = `{{secret_${++used}}}`;
      text = text.split(secret).join(placeholder);
      placeholders.set(placeholder, secret);
    }
    // Files attached to an answer arrive like a task's: listed apart from the user's words, as data.
    const { userText, attachmentsInner } = splitUserTextAndAttachments(text);
    let content = wrapUserRequest(`Answer from the user: ${filterExternalContent(userText, false)}`, false);
    if (attachmentsInner) content += `\n\n${wrapAttachments(attachmentsInner)}`;
    this.addMessage(new HumanMessage(content), 'human_answer');
    void this.saveToSession();
    return placeholders;
  }

  /**
   * Records one navigator step. Each call is stored as its own call/result pair because adapters pair
   * parallel results inconsistently (Gemini names every result after the first call of the turn).
   * The message text stays empty so the model's reasoning is not replayed.
   */
  public addToolTurn(calls: ToolTurnCall[], results: ActionResult[]): void {
    calls.forEach((call, i) => {
      const toolCall = { id: call.id, name: call.name, args: call.args, type: 'tool_call' as const };
      this.addMessage(new AIMessage({ content: '', tool_calls: [toolCall] }), 'turn_ai');
      this.addMessage(new ToolMessage({ tool_call_id: call.id, content: defangTags(describeResult(results[i])) }), 'turn_tool');
    });
    if (calls.length > 0) void this.saveToSession();
  }

  public getTranscript(): TranscriptEntry[] {
    return this.history.messages
      .filter(m => m.message)
      .map(m => ({ message: m.message, type: m.metadata.message_type }));
  }

  public length(): number {
    return this.history.messages.length;
  }

  private addMessage(message: BaseMessage, messageType: TranscriptType, task?: string): void {
    const filteredMessage = this.settings.sensitiveData ? this.filterSensitiveData(message) : message;
    this.history.addMessage(
      filteredMessage,
      new MessageMetadata(this.countTokens(filteredMessage), messageType, undefined, task),
    );
  }

  private filterSensitiveData(message: BaseMessage): BaseMessage {
    const replaceSensitive = (value: string): string => {
      let filteredValue = value;
      for (const [key, val] of Object.entries(this.settings.sensitiveData ?? {})) {
        if (!val) continue;
        filteredValue = filteredValue.replace(val, `<secret>${key}</secret>`);
      }
      return filteredValue;
    };

    if (typeof message.content === 'string') {
      message.content = replaceSensitive(message.content);
    } else if (Array.isArray(message.content)) {
      message.content = message.content.map(item =>
        typeof item === 'object' && item !== null && 'text' in item ? { ...item, text: replaceSensitive(item.text) } : item,
      );
    }
    return message;
  }

  /** Rough estimate; no tokenizer is available in the service worker. */
  private countTokens(message: BaseMessage): number {
    const perToken = this.settings.estimatedCharactersPerToken;
    if (Array.isArray(message.content)) {
      return message.content.reduce((tokens, item) => {
        if ('image_url' in item) return tokens + this.settings.imageTokens;
        if (typeof item === 'object' && 'text' in item) return tokens + Math.floor(item.text.length / perToken);
        return tokens;
      }, 0);
    }
    const toolCalls = message instanceof AIMessage && message.tool_calls?.length ? JSON.stringify(message.tool_calls) : '';
    return Math.floor((message.content.length + toolCalls.length) / perToken);
  }

  // ── Token usage ───────────────────────────────────────────────────────────

  /** Records the actual token usage reported by the LLM. */
  public recordTokenUsage(input: number, output: number): void {
    this.history.updateCumulativeTokens(input, output);
    void this.saveToSession();

    // Accumulate for batching to prevent Chrome Storage I/O stalls
    this.pendingInputTokens += input;
    this.pendingOutputTokens += output;

    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flushTokenUsage(), this.flushIntervalMs);
    }
  }

  /** Flushes batched token usage to Chrome Storage. */
  public flushTokenUsage(): void {
    if (this.pendingInputTokens === 0 && this.pendingOutputTokens === 0) return;

    const input = this.pendingInputTokens;
    const output = this.pendingOutputTokens;
    this.pendingInputTokens = 0;
    this.pendingOutputTokens = 0;
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    analyticsSettingsStore.incrementTokens(input, output).catch(err => {
      logger.error('Failed to persist global token usage:', err);
    });

    if (this.sessionId) {
      chatHistoryStore.incrementTokens(this.sessionId, input, output).catch(err => {
        logger.error(`Failed to persist token usage for session ${this.sessionId}:`, err);
      });
    }
  }
}

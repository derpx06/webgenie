import { type BaseMessage, AIMessage, HumanMessage, type SystemMessage, ToolMessage } from '@langchain/core/messages';
import { MessageHistory, MessageMetadata, PyramidLevel, serializeHistory, deserializeHistory } from '@src/background/agent/messages/views';
import { createLogger } from '@src/background/log';
import {
  filterExternalContent,
  wrapUserRequest,
  splitUserTextAndAttachments,
  wrapAttachments,
} from '@src/background/agent/messages/utils';
import { analyticsSettingsStore, chatHistoryStore } from '@extension/storage';

const logger = createLogger('MessageManager');

export class MessageManagerSettings {
  maxInputTokens = 128000;
  estimatedCharactersPerToken = 3;
  imageTokens = 800;
  includeAttributes: string[] = [];
  messageContext?: string;
  sensitiveData?: Record<string, string>;
  availableFilePaths?: string[];

  constructor(
    options: {
      maxInputTokens?: number;
      estimatedCharactersPerToken?: number;
      imageTokens?: number;
      includeAttributes?: string[];
      messageContext?: string;
      sensitiveData?: Record<string, string>;
      availableFilePaths?: string[];
    } = {},
  ) {
    if (options.maxInputTokens !== undefined) this.maxInputTokens = options.maxInputTokens;
    if (options.estimatedCharactersPerToken !== undefined)
      this.estimatedCharactersPerToken = options.estimatedCharactersPerToken;
    if (options.imageTokens !== undefined) this.imageTokens = options.imageTokens;
    if (options.includeAttributes !== undefined) this.includeAttributes = options.includeAttributes;
    if (options.messageContext !== undefined) this.messageContext = options.messageContext;
    if (options.sensitiveData !== undefined) this.sensitiveData = options.sensitiveData;
    if (options.availableFilePaths !== undefined) this.availableFilePaths = options.availableFilePaths;
  }
}

export default class MessageManager {
  private history: MessageHistory;
  private toolId: number;
  private settings: MessageManagerSettings;
  private sessionId: string | null;
  private pendingInputTokens = 0;
  private pendingOutputTokens = 0;
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private flushIntervalMs = 2000;
  /**
   * Durable working memory scratchpad — the agent's mutable "brain notes".
   *
   * Stored SEPARATELY from the message history under `${sessionId}:wm` so it:
   * - Survives Chrome service worker restarts (session storage is process-scoped)
   * - Is NEVER compacted, pruned, or summarized away
   * - Can be appended to incrementally without re-writing the whole string
   *
   * Research ref: browser-use `AgentBrain.memory` field, browser_agent_research_pt2.md §Working Memory.
   */
  private workingMemory = '';

  constructor(settings: MessageManagerSettings = new MessageManagerSettings(), sessionId: string | null = null, flushIntervalMs = 2000) {
    this.settings = settings;
    this.history = new MessageHistory();
    this.toolId = 1;
    this.sessionId = sessionId;
    this.flushIntervalMs = flushIntervalMs;
  }

  /**
   * Loads history from chrome.storage.session for this sessionId/taskId.
   */
  public async loadFromSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const data = await chrome.storage.session.get(this.sessionId);
      if (data && data[this.sessionId]) {
        logger.info(`Loaded message history from session storage for key: ${this.sessionId}`);
        this.history = deserializeHistory(data[this.sessionId]);
        this.trimPinnedExtractions();
        
        // Restore toolId count based on existing messages
        let maxId = 0;
        for (const m of this.history.messages) {
          if (m.message instanceof AIMessage && m.message.tool_calls) {
            for (const call of m.message.tool_calls) {
              const num = call.id ? parseInt(call.id, 10) : NaN;
              if (!isNaN(num) && num > maxId) {
                maxId = num;
              }
            }
          } else if (m.message instanceof ToolMessage && m.message.tool_call_id) {
            const num = parseInt(m.message.tool_call_id, 10);
            if (!isNaN(num) && num > maxId) {
              maxId = num;
            }
          }
        }
        this.toolId = maxId + 1;
      }
    } catch (err) {
      logger.error(`Failed to load history from session storage:`, err);
    }
  }

  /**
   * Saves history to chrome.storage.session for this sessionId/taskId.
   */
  public async saveToSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const serialized = serializeHistory(this.history);
      await chrome.storage.session.set({ [this.sessionId]: serialized });
      logger.debug(`Saved message history to session storage for key: ${this.sessionId}`);
    } catch (err) {
      logger.error(`Failed to save history to session storage:`, err);
    }
  }

  // ── Working Memory Scratchpad ─────────────────────────────────────────────

  /**
   * Overwrites the working memory scratchpad and persists to session storage.
   * Called by navigator after each step with the agent's updated `memory` field.
   */
  public async setWorkingMemory(memory: string): Promise<void> {
    this.workingMemory = memory.slice(0, 2000); // cap at 2000 chars
    await this._persistWorkingMemory();
  }

  /**
   * Returns the current working memory scratchpad.
   * Used by base.ts to inject into the reflection prefix.
   */
  public getWorkingMemory(): string {
    return this.workingMemory;
  }

  /**
   * Appends a note to the working memory without overwriting.
   * Useful for pinning extracted data or key discoveries.
   */
  public async appendWorkingMemory(note: string): Promise<void> {
    const combined = this.workingMemory
      ? `${this.workingMemory}\n${note}`
      : note;
    this.workingMemory = combined.slice(0, 2000);
    await this._persistWorkingMemory();
  }

  /**
   * Loads working memory from session storage (called at task resume).
   */
  public async loadWorkingMemory(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const key = `${this.sessionId}:wm`;
      const data = await chrome.storage.session.get(key);
      if (data?.[key]) {
        this.workingMemory = String(data[key]).slice(0, 2000);
        logger.info(`Loaded working memory (${this.workingMemory.length} chars) from session`);
      }
    } catch (err) {
      logger.error('Failed to load working memory:', err);
    }
  }

  private async _persistWorkingMemory(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await chrome.storage.session.set({ [`${this.sessionId}:wm`]: this.workingMemory });
    } catch (err) {
      logger.error('Failed to persist working memory:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  get cumulativeInputTokens(): number {
    return this.history.cumulativeInputTokens;
  }

  get cumulativeOutputTokens(): number {
    return this.history.cumulativeOutputTokens;
  }

  public initTaskMessages(systemMessage: SystemMessage, task: string, messageContext?: string): void {
    // Add system message
    this.addMessageWithTokens(systemMessage, PyramidLevel.INIT);

    // Add context message if provided
    if (messageContext && messageContext.length > 0) {
      const contextMessage = new HumanMessage({
        content: `Context for the task: ${messageContext}`,
      });
      this.addMessageWithTokens(contextMessage, PyramidLevel.INIT);
    }

    // Add task instructions
    const taskMessage = MessageManager.taskInstructions(task);
    this.addMessageWithTokens(taskMessage, PyramidLevel.INIT);

    // Add sensitive data info if sensitive data is provided
    if (this.settings.sensitiveData) {
      const info = `Here are placeholders for sensitive data: ${Object.keys(this.settings.sensitiveData)}`;
      const infoMessage = new HumanMessage({
        content: `${info}\nTo use them, write <secret>the placeholder name</secret>`,
      });
      this.addMessageWithTokens(infoMessage, PyramidLevel.INIT);
    }

    // Add example output
    const placeholderMessage = new HumanMessage({
      content: 'Example output:',
    });
    this.addMessageWithTokens(placeholderMessage, PyramidLevel.INIT);

    const toolCallId = this.nextToolId();
    const toolCalls = [
      {
        name: 'AgentOutput',
        args: {
          current_state: {
            evaluation_previous_goal:
              `Success - I successfully clicked on the 'Apple' link from the Google Search results page, 
              which directed me to the 'Apple' company homepage. This is a good start toward finding 
              the best place to buy a new iPhone as the Apple website often list iPhones for sale.`.trim(),
            memory: `I searched for 'iPhone retailers' on Google. From the Google Search results page, 
              I used the 'click_element' tool to click on a element labelled 'Best Buy' but calling 
              the tool did not direct me to a new page. I then used the 'click_element' tool to click 
              on a element labelled 'Apple' which redirected me to the 'Apple' company homepage. 
              Currently at step 3/15.`.trim(),
            next_goal: `Looking at reported structure of the current page, I can see the item '[127]<h3 iPhone/>' 
              in the content. I think this button will lead to more information and potentially prices 
              for iPhones. I'll click on the link to 'iPhone' at index [127] using the 'click_element' 
              tool and hope to see prices on the next page.`.trim(),
          },
          action: [{ click_element: { index: 127 } }],
        },
        id: String(toolCallId),
        type: 'tool_call' as const,
      },
    ];

    const exampleToolCall = new AIMessage({
      content: '',
      tool_calls: toolCalls,
    });
    this.addMessageWithTokens(exampleToolCall, PyramidLevel.INIT);
    this.addToolMessage('Browser started', toolCallId, PyramidLevel.INIT);

    // Add history start marker
    const historyStartMessage = new HumanMessage({
      content: '[Your task history memory starts here]',
    });
    this.addMessageWithTokens(historyStartMessage, PyramidLevel.INIT);

    // Add available file paths if provided
    if (this.settings.availableFilePaths && this.settings.availableFilePaths.length > 0) {
      const filepathsMsg = new HumanMessage({
        content: `Here are file paths you can use: ${this.settings.availableFilePaths}`,
      });
      this.addMessageWithTokens(filepathsMsg, PyramidLevel.INIT);
    }
  }

  public nextToolId(): number {
    const id = this.toolId;
    this.toolId += 1;
    return id;
  }

  /**
   * Createthe task instructions
   * @param task - The raw description of the task
   * @returns A HumanMessage object containing the task instructions
   */
  private static taskInstructions(task: string): HumanMessage {
    const { userText, attachmentsInner } = splitUserTextAndAttachments(task);

    // Filter and wrap user text
    // Use non-strict filtering so user-provided task details like emails, names, and URLs remain intact.
    const cleanedTask = filterExternalContent(userText, false);
    const content = `Your ultimate task is: """${cleanedTask}""". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`;
    const wrappedUser = wrapUserRequest(content, false);

    // Filter and wrap attachments as untrusted content
    if (attachmentsInner && attachmentsInner.length > 0) {
      const wrappedFiles = wrapAttachments(attachmentsInner);
      return new HumanMessage({ content: `${wrappedUser}\n\n${wrappedFiles}` });
    }

    return new HumanMessage({ content: wrappedUser });
  }

  /**
   * Returns the number of messages in the history
   * @returns The number of messages in the history
   */
  public length(): number {
    return this.history.messages.length;
  }

  /**
   * Adds a new task to execute, it will be executed based on the history
   * @param newTask - The raw description of the new task
   */
  public addNewTask(newTask: string): void {
    const { userText, attachmentsInner } = splitUserTextAndAttachments(newTask);

    // Filter and wrap user text
    // Use non-strict filtering so user-provided task details like emails, names, and URLs remain intact.
    const cleanedTask = filterExternalContent(userText, false);
    const content = `Your new ultimate task is: """${cleanedTask}""". This is a follow-up of the previous tasks. Make sure to take all of the previous context into account and finish your new ultimate task.`;
    const wrappedUser = wrapUserRequest(content, false);

    // Filter and wrap attachments as untrusted content
    let finalContent = wrappedUser;
    if (attachmentsInner && attachmentsInner.length > 0) {
      const wrappedFiles = wrapAttachments(attachmentsInner);
      finalContent = `${wrappedUser}\n\n${wrappedFiles}`;
    }

    const msg = new HumanMessage({ content: finalContent });
    this.addMessageWithTokens(msg, PyramidLevel.INIT);
  }

  /**
   * Adds a plan message to the history
   * @param plan - The raw description of the plan
   * @param position - The position to add the plan
   */
  public addPlan(plan?: string, position?: number): void {
    if (plan) {
      const cleanedPlan = filterExternalContent(plan, false);
      const msg = new AIMessage({ content: `<plan>${cleanedPlan}</plan>` });
      this.addMessageWithTokens(msg, PyramidLevel.MILESTONE, null, position);
    }
  }

  /**
   * Adds a state message to the history
   * @param stateMessage - The HumanMessage object containing the state
   */
  public addStateMessage(stateMessage: HumanMessage): void {
    this.addMessageWithTokens(stateMessage, PyramidLevel.LIVE, 'page_state');
  }

  /**
   * Adds a model output message to the history
   * @param modelOutput - The model output
   */
  public addModelOutput(modelOutput: Record<string, unknown>): void {
    const toolCallId = this.nextToolId();
    const toolCalls = [
      {
        name: 'AgentOutput',
        args: modelOutput,
        id: String(toolCallId),
        type: 'tool_call' as const,
      },
    ];

    const msg = new AIMessage({
      content: 'tool call',
      tool_calls: toolCalls,
    });
    this.addMessageWithTokens(msg, PyramidLevel.TRACE);

    // Need a placeholder for the tool response here to avoid errors sometimes
    // NOTE: in browser-use, it uses an empty string
    this.addToolMessage('tool call response', toolCallId, PyramidLevel.TRACE);
  }

  /**
   * Removes the last state message from the history
   */
  public removeLastStateMessage(): void {
    this.history.removeLastStateMessage();
    void this.saveToSession();
  }

  public getMessages(): BaseMessage[] {
    const messages = this.history.messages
      .filter(m => {
        if (!m.message) {
          console.error(`[MessageManager] Filtering out message with undefined message property:`, m);
          return false;
        }
        return true;
      })
      .map(m => m.message);

    let totalInputTokens = 0;
    logger.debug(`Messages in history: ${this.history.messages.length}:`);

    for (const m of this.history.messages) {
      totalInputTokens += m.metadata.tokens;
      if (m.message) {
        logger.debug(`${m.message.constructor.name} - Token count: ${m.metadata.tokens}`);
      } else {
        console.error(`[MessageManager] Found message with undefined message property:`, m);
        logger.debug(`Message with undefined message property - Token count: ${m.metadata.tokens}`);
      }
    }

    logger.debug(`Total input tokens: ${totalInputTokens}`);
    return messages;
  }

  /**
   * Adds a message to the history with the token count metadata
   * @param message - The BaseMessage object to add
   * @param level - The pyramid level of the message
   * @param messageType - The type of the message (optional)
   * @param position - The optional position to add the message
   */
  public addMessageWithTokens(
    message: BaseMessage,
    level: PyramidLevel = PyramidLevel.LIVE,
    messageType?: string | null,
    position?: number,
  ): void {
    let filteredMessage = message;
    // filter out sensitive data if provided
    if (this.settings.sensitiveData) {
      filteredMessage = this._filterSensitiveData(message);
    }

    const tokenCount = this._countTokens(filteredMessage);
    const metadata: MessageMetadata = new MessageMetadata(tokenCount, messageType, level);
    this.history.addMessage(filteredMessage, metadata, position);
    void this.saveToSession();
  }

  /**
   * Filters out sensitive data from the message
   * @param message - The BaseMessage object to filter
   * @returns The filtered BaseMessage object
   */
  private _filterSensitiveData(message: BaseMessage): BaseMessage {
    const replaceSensitive = (value: string): string => {
      let filteredValue = value;
      if (!this.settings.sensitiveData) return filteredValue;

      for (const [key, val] of Object.entries(this.settings.sensitiveData)) {
        // Skip empty values to match Python behavior
        if (!val) continue;
        filteredValue = filteredValue.replace(val, `<secret>${key}</secret>`);
      }
      return filteredValue;
    };

    if (typeof message.content === 'string') {
      message.content = replaceSensitive(message.content);
    } else if (Array.isArray(message.content)) {
      message.content = message.content.map(item => {
        // Add null check to match Python's isinstance() behavior
        if (typeof item === 'object' && item !== null && 'text' in item) {
          return { ...item, text: replaceSensitive(item.text) };
        }
        return item;
      });
    }

    return message;
  }

  /**
   * Counts the tokens in the message
   * @param message - The BaseMessage object to count the tokens
   * @returns The number of tokens in the message
   */
  private _countTokens(message: BaseMessage): number {
    let tokens = 0;

    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if ('image_url' in item) {
          tokens += this.settings.imageTokens;
        } else if (typeof item === 'object' && 'text' in item) {
          tokens += this._countTextTokens(item.text);
        }
      }
    } else {
      let msg = message.content;
      // Check if it's an AIMessage with tool_calls
      if ('tool_calls' in message) {
        msg += JSON.stringify(message.tool_calls);
      }
      tokens += this._countTextTokens(msg);
    }

    return tokens;
  }

  /**
   * Counts the tokens in the text
   * Rough estimate, no tokenizer provided for now
   * @param text - The text to count the tokens
   * @returns The number of tokens in the text
   */
  private _countTextTokens(text: string): number {
    return Math.floor(text.length / this.settings.estimatedCharactersPerToken);
  }

  /**
   * Cuts the last message if the total tokens exceed the max input tokens
   *
   * Get current message list, potentially trimmed to max tokens
   */
  /**
   * Cuts oldest messages from trace and milestone levels when history total tokens exceed budget.
   * Never touches INIT or LIVE levels to prevent JSON/DOM corruption.
   */
  public cutMessages(): void {
    let diff = this.history.totalTokens - this.settings.maxInputTokens;
    if (diff <= 0) return;

    logger.info(`Total tokens (${this.history.totalTokens}) exceed limit (${this.settings.maxInputTokens}). Cutting history...`);

    // 1. Drop oldest TRACE messages first
    for (let i = 0; i < this.history.messages.length; i++) {
      const m = this.history.messages[i];
      if (m.metadata.level === PyramidLevel.TRACE) {
        const tokens = m.metadata.tokens;
        this.history.messages.splice(i, 1);
        this.history.totalTokens -= tokens;
        diff -= tokens;
        i--; // Adjust index
        if (diff <= 0) {
          void this.saveToSession();
          return;
        }
      }
    }

    // 2. Drop oldest MILESTONE messages next
    for (let i = 0; i < this.history.messages.length; i++) {
      const m = this.history.messages[i];
      if (m.metadata.level === PyramidLevel.MILESTONE) {
        const tokens = m.metadata.tokens;
        this.history.messages.splice(i, 1);
        this.history.totalTokens -= tokens;
        diff -= tokens;
        i--; // Adjust index
        if (diff <= 0) {
          void this.saveToSession();
          return;
        }
      }
    }

    // Fallback: If still exceeding, log warning
    if (diff > 0) {
      logger.warning(`Unable to free enough tokens by dropping traces/milestones. Remaining diff: ${diff}`);
    }
    void this.saveToSession();
  }

  private trimPinnedExtractions(maxPins = 20): void {
    const pinnedIndices = this.history.messages
      .map((message, index) => message.metadata.message_type === 'pinned_extraction' ? index : -1)
      .filter(index => index >= 0);

    while (pinnedIndices.length > maxPins) {
      const oldestIndex = pinnedIndices.shift();
      if (oldestIndex === undefined) break;
      const [removed] = this.history.messages.splice(oldestIndex, 1);
      if (removed) this.history.totalTokens -= removed.metadata.tokens;
      for (let i = 0; i < pinnedIndices.length; i++) {
        if (pinnedIndices[i] > oldestIndex) pinnedIndices[i]--;
      }
      logger.info(`Pinned extraction cap (${maxPins}) exceeded — evicted oldest extraction`);
    }
  }

  /**
   * Compacts the TRACE history messages when they exceed the budget.
   * Finds the oldest TRACE messages (AIMessage tool calls & ToolMessages),
   * summarizes them programmatically, replaces them with a MILESTONE human message,
   * and preserves any important verification/extracted results.
   */
  public compactHistory(traceBudget = 1500): void {
    // Prune all stale action results/errors first
    for (let i = 0; i < this.history.messages.length; i++) {
      const m = this.history.messages[i];
      if (
        m.metadata.level === PyramidLevel.TRACE &&
        (m.metadata.message_type === 'action_result' || m.metadata.message_type === 'action_error')
      ) {
        const tokens = m.metadata.tokens;
        this.history.messages.splice(i, 1);
        this.history.totalTokens -= tokens;
        i--;
      }
    }

    // Calculate current tokens in PyramidLevel.TRACE
    let traceTokens = 0;
    for (const m of this.history.messages) {
      if (m.metadata.level === PyramidLevel.TRACE) {
        traceTokens += m.metadata.tokens;
      }
    }

    if (traceTokens <= traceBudget) {
      void this.saveToSession();
      return;
    }

    logger.info(`Trace tokens (${traceTokens}) exceed budget (${traceBudget}). Compacting history...`);

    // Collect TRACE message indices
    const traceIndices: number[] = [];
    for (let i = 0; i < this.history.messages.length; i++) {
      if (this.history.messages[i].metadata.level === PyramidLevel.TRACE) {
        traceIndices.push(i);
      }
    }

    // Process oldest TRACE pairs (AIMessage + ToolMessage) until under budget.
    while (traceTokens > traceBudget && traceIndices.length >= 2) {
      const aiIdx  = traceIndices.shift()!;
      const toolIdx = traceIndices.shift()!;

      const aiMsg  = this.history.messages[aiIdx];
      const toolMsg = this.history.messages[toolIdx];

      if (!aiMsg || !toolMsg) continue;

      // ── CRITICAL: Pin extracted content BEFORE compaction removes it ────────
      // Any ToolMessage that contains meaningful extracted data (scraped values,
      // auth tokens, product IDs, etc.) must be preserved as a protected INIT
      // message so the agent can reference it for the rest of the task.
      // Research ref: goated_memory_architecture.md §Risk 3.
      const resultStr = String(toolMsg.message.content);
      const isExtractedData = resultStr.length > 20 &&
        !resultStr.startsWith('tool call') &&
        !resultStr.startsWith('Browser started') &&
        !resultStr.startsWith('Action result: ') &&
        !resultStr.startsWith('Action error: ');

      if (isExtractedData) {
        // Pin as INIT-level so it survives all future compaction and cutMessages
        const pinnedContent = `[Pinned extracted data from step]: ${resultStr.slice(0, 300)}`;
        const pinMsg = new HumanMessage({ content: pinnedContent });
        const pinMeta = new MessageMetadata(
          this._countTokens(pinMsg),
          'pinned_extraction',
          PyramidLevel.INIT,
        );
        // Insert right after the last INIT message (before any TRACE/LIVE)
        const lastInitIdx = this.history.messages.reduce(
          (acc, m, i) => m.metadata.level === PyramidLevel.INIT ? i : acc, -1,
        );
        this.history.addMessage(pinMsg, pinMeta, lastInitIdx + 1);
        logger.info(`Pinned extracted data from tool message (${resultStr.length} chars) as INIT`);
      }
      // ────────────────────────────────────────────────────────────────────────

      // Build the action string from the AI tool call
      let actionStr = '';
      if (aiMsg.message instanceof AIMessage && aiMsg.message.tool_calls) {
        actionStr = aiMsg.message.tool_calls
          .map(tc => {
            if (tc.name === 'AgentOutput') {
              const args = tc.args as Record<string, unknown>;
              return JSON.stringify((args as Record<string, unknown>)?.['action'] || tc.args);
            }
            return tc.name;
          })
          .join(', ');
      } else {
        actionStr = String(aiMsg.message.content).slice(0, 80);
      }

      const resultSummary = resultStr.slice(0, 80);
      const summary =
        `[Milestone] Action: ${actionStr} → Result: ${resultSummary}`;

      // Remove the two old TRACE messages
      const removedTokens = aiMsg.metadata.tokens + toolMsg.metadata.tokens;
      // Adjust indices for any insertion done above (pinning shifts indices by 1)
      const actualAiIdx  = this.history.messages.indexOf(aiMsg);
      const actualToolIdx = this.history.messages.indexOf(toolMsg);
      this.history.messages = this.history.messages.filter(
        (_, i) => i !== actualAiIdx && i !== actualToolIdx,
      );
      this.history.totalTokens -= removedTokens;
      traceTokens -= removedTokens;

      // Insert milestone at position of the old AI message
      const insertAt = Math.min(actualAiIdx, this.history.messages.length);
      const milestoneMsg = new HumanMessage({ content: summary });
      const milestoneMeta = new MessageMetadata(
        this._countTokens(milestoneMsg),
        null,
        PyramidLevel.MILESTONE,
      );
      this.history.addMessage(milestoneMsg, milestoneMeta, insertAt);
      logger.info(`Compacted TRACE pair → milestone: "${summary.slice(0, 80)}"`);

      // ── Milestone cap: max 5 milestones (200-token budget per research spec) ─
      // If we now have > 5 milestones, drop the oldest one.
      const milestoneIndices: number[] = [];
      for (let i = 0; i < this.history.messages.length; i++) {
        if (this.history.messages[i].metadata.level === PyramidLevel.MILESTONE) {
          milestoneIndices.push(i);
        }
      }
      if (milestoneIndices.length > 5) {
        const oldestIdx = milestoneIndices[0];
        const oldestTokens = this.history.messages[oldestIdx].metadata.tokens;
        this.history.messages.splice(oldestIdx, 1);
        this.history.totalTokens -= oldestTokens;
        logger.info('Milestone cap (5) exceeded — evicted oldest milestone');
      }
      // ────────────────────────────────────────────────────────────────────────

      // Re-index remaining TRACE messages after structural changes
      traceIndices.length = 0;
      for (let i = 0; i < this.history.messages.length; i++) {
        if (this.history.messages[i].metadata.level === PyramidLevel.TRACE) {
          traceIndices.push(i);
        }
      }
    }

    this.trimPinnedExtractions();

    void this.saveToSession();
  }

  /**
   * Adds a tool message to the history
   * @param content - The content of the tool message
   * @param toolCallId - The tool call id of the tool message
   * @param level - The pyramid level
   * @param messageType - The type of the tool message
   */
  public addToolMessage(
    content: string,
    toolCallId?: number,
    level: PyramidLevel = PyramidLevel.LIVE,
    messageType?: string | null,
  ): void {
    const id = toolCallId ?? this.nextToolId();
    const msg = new ToolMessage({ content, tool_call_id: String(id) });
    this.addMessageWithTokens(msg, level, messageType);
  }

  /**
   * Records the actual token usage from the LLM
   */
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

  /**
   * Flushes batched token usage to Chrome Storage
   */
  public flushTokenUsage(): void {
    if (this.pendingInputTokens === 0 && this.pendingOutputTokens === 0) return;

    const input = this.pendingInputTokens;
    const output = this.pendingOutputTokens;
    
    // Reset counters
    this.pendingInputTokens = 0;
    this.pendingOutputTokens = 0;
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    // Persist usage globally
    analyticsSettingsStore.incrementTokens(input, output).catch(err => {
      logger.error('Failed to persist global token usage:', err);
    });

    // Persist usage per session if available
    if (this.sessionId) {
      chatHistoryStore.incrementTokens(this.sessionId, input, output).catch(err => {
        logger.error(`Failed to persist token usage for session ${this.sessionId}:`, err);
      });
    }
  }
}

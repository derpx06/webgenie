/**
 * Fakes for driving the real agent loop (executor, planner, navigator, action handlers, validation) in unit tests.
 * Only the model and the browser are scripted. The test file must mock `webextension-polyfill` and `@extension/i18n`
 * (vi.mock is hoisted per file) and install fake timers; see executor.test.ts.
 */
import { vi } from 'vitest';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type BrowserContext from '../../browser/context';
import type Page from '../../browser/page';
import type { FormCommitInfo } from '../../browser/page';
import { DEFAULT_BROWSER_CONTEXT_CONFIG, type BrowserContextConfig, type BrowserState, type PageDialog, type TabInfo } from '../../browser/views';
import { DOMElementNode, DOMTextNode } from '../../browser/dom/views';
import type { CoordinateSet } from '../../browser/dom/history/view';
import type { ScreenshotOptions } from '../../browser/page';
import type { ToolDefinition } from '../actions/builder';
import { TaskCheckpointStore } from '../contracts';
import type { PlannerLLMOutput } from '../contracts';
import { Executor, type ExecutorExtraArgs } from '../executor';
import type { AgentEvent, ExecutionState } from '../event/types';

// ── Model ────────────────────────────────────────────────────────────────────

export type AgentName = 'planner' | 'navigator';
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}
/** One model reply: tool calls, plain text (no tool call, which triggers a re-ask), or a thrown error. */
export type Reply = ToolCall | ToolCall[] | { text: string } | Error;
/** A reply, or a function of the request (may be async, e.g. to block until the test releases it). */
export type Script = Reply | ((request: LLMRequest) => Reply | Promise<Reply>);

export interface LLMRequest {
  agent: AgentName;
  messages: BaseMessage[];
  tools: ToolDefinition[];
  toolChoice: unknown;
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function abortable<T>(value: T | Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    Promise.resolve(value).then(resolve, reject);
  });
}

/**
 * A native-tool-calling chat model with one reply queue per agent. The agent is told apart by its tools: the planner
 * binds exactly the `plan` tool. Every request is recorded. Navigator calls get `memory: ''` unless they set `memory`.
 */
export class FakeChatModel {
  readonly model = 'fake-model';
  readonly requests: LLMRequest[] = [];
  /** usage_metadata of every reply, in the shape LangChain's Vertex/Gemini adapter reports. */
  usage = {
    input_tokens: 1000,
    output_tokens: 20,
    total_tokens: 1020,
    input_token_details: { cache_read: 0 },
    output_token_details: { reasoning: 0 },
  };
  private readonly queues: Record<AgentName, Script[]>;

  constructor(script: Partial<Record<AgentName, Script[]>> = {}) {
    this.queues = { planner: [...(script.planner ?? [])], navigator: [...(script.navigator ?? [])] };
  }

  push(agent: AgentName, ...scripts: Script[]): void {
    this.queues[agent].push(...scripts);
  }

  remaining(agent?: AgentName): number {
    return agent ? this.queues[agent].length : this.queues.planner.length + this.queues.navigator.length;
  }

  requestsFor(agent: AgentName): LLMRequest[] {
    return this.requests.filter(request => request.agent === agent);
  }

  bindTools(tools: ToolDefinition[], kwargs: { tool_choice?: unknown } = {}) {
    const agent: AgentName = tools.some(tool => tool.function.name === 'plan') ? 'planner' : 'navigator';
    return {
      invoke: (messages: BaseMessage[], options: { signal?: AbortSignal } = {}) =>
        this.reply({ agent, messages, tools, toolChoice: kwargs.tool_choice }, options.signal),
    };
  }

  /** Only reached with a prompt-rendered-tools toolMode, which this fake does not script. */
  invoke(): never {
    throw new Error('FakeChatModel scripts native tool calls only; do not pass nativeTools: false');
  }

  asChatModel(): BaseChatModel {
    return this as unknown as BaseChatModel;
  }

  private async reply(request: LLMRequest, signal?: AbortSignal): Promise<AIMessage> {
    this.requests.push(request);
    const next = this.queues[request.agent].shift();
    if (next === undefined) {
      throw new Error(`FakeChatModel: no scripted ${request.agent} reply left (request ${this.requests.length})`);
    }
    const reply = await abortable(typeof next === 'function' ? next(request) : next, signal);
    if (reply instanceof Error) throw reply;
    const text = 'text' in reply ? reply.text : '';
    const calls = 'text' in reply ? [] : Array.isArray(reply) ? reply : [reply];
    return new AIMessage({
      content: text,
      tool_calls: calls.map((call, i) => ({
        id: `call_${this.requests.length}_${i}`,
        name: call.name,
        type: 'tool_call' as const,
        args: request.agent === 'navigator' && !('memory' in call.args) ? { memory: '', ...call.args } : call.args,
      })),
      usage_metadata: structuredClone(this.usage),
      response_metadata: { finish_reason: 'STOP' },
    });
  }
}

export const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ name, args });
export const plan = (fields: Partial<PlannerLLMOutput> = {}): ToolCall =>
  call('plan', { done: false, macro_objective: 'EXPLORE_PAGE', next_goal: 'Continue the task', final_phase: false, requirements: [], ...fields });
/** The planner confirms completion; without an answer the navigator's done text is the final answer. */
export const planDone = (finalAnswer?: string): ToolCall =>
  plan({ done: true, macro_objective: 'VERIFY_STATE', next_goal: 'Report the result', ...(finalAnswer ? { final_answer: finalAnswer } : {}) });
export const done = (text: string, success = true): ToolCall => call('done', { text, success });
export const click = (index: number, commits = 'none'): ToolCall => call('click_element', { index, commits });
export const typeText = (index: number, text: string): ToolCall => call('input_text', { index, text });
export const askHuman = (question: string, extra: Record<string, unknown> = {}): ToolCall =>
  call('ask_human', { question, ...extra });

/** All text content of messages, for asserting on the context a model received. */
export function textOf(messages: BaseMessage | BaseMessage[]): string {
  return [messages]
    .flat()
    .map(message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
    .join('\n');
}

// ── Browser ──────────────────────────────────────────────────────────────────

export interface ElementSpec {
  /** Defaults to button. */
  tag?: string;
  text?: string;
  attributes?: Record<string, string>;
}

/** A page read. Element i gets index i and backendNodeId 100 + i, so the same position is the same element across pages. */
export interface PageSpec {
  url: string;
  title?: string;
  /** Static text lines shown before the elements. */
  text?: string[];
  /** Text lines in the page read but outside the viewport. */
  offscreenText?: string[];
  /** What get_complete_page_content returns; defaults to every text line. */
  content?: string;
  elements?: ElementSpec[];
  dialog?: PageDialog;
}

export interface BrowserAction {
  type:
    | 'click'
    | 'double_click'
    | 'hover'
    | 'right_click'
    | 'drag'
    | 'input'
    | 'send_keys'
    | 'navigate'
    | 'go_back'
    | 'go_forward'
    | 'open_tab'
    | 'close_tab'
    | 'switch_tab'
    | 'upload'
    | 'scroll_to_text';
  index?: number;
  /** The element's text, as the model saw it. */
  label?: string;
  text?: string;
  url?: string;
  /** The tab a tab action acts on, and the element a drag is dropped on. */
  tabId?: number;
  target?: number;
}

/** The box of element `index`: 200x30 at x=20, stacked every 40 pixels down the page. */
function boxAt(index: number): CoordinateSet {
  const [x, y, width, height] = [20, 10 + index * 40, 200, 30];
  return {
    topLeft: { x, y },
    topRight: { x: x + width, y },
    bottomLeft: { x, y: y + height },
    bottomRight: { x: x + width, y: y + height },
    center: { x: x + width / 2, y: y + height / 2 },
    width,
    height,
  };
}

function buildDom(spec: PageSpec): Pick<BrowserState, 'elementTree' | 'selectorMap'> {
  const body = new DOMElementNode({
    tagName: 'body',
    xpath: '/body',
    attributes: {},
    children: [],
    isVisible: true,
    isTopElement: true,
    isInViewport: true,
  });
  const selectorMap = new Map<number, DOMElementNode>();
  for (const line of spec.text ?? []) body.children.push(new DOMTextNode(line, true, body));
  if (spec.offscreenText?.length) {
    const below = new DOMElementNode({ tagName: 'div', xpath: '/body/div', attributes: {}, children: [], isVisible: true, isInViewport: false, parent: body });
    for (const line of spec.offscreenText) below.children.push(new DOMTextNode(line, true, below));
    body.children.push(below);
  }
  (spec.elements ?? []).forEach((element, index) => {
    const tag = element.tag ?? 'button';
    const node = new DOMElementNode({
      tagName: tag,
      xpath: `/body/${tag}[${index + 1}]`,
      attributes: element.attributes ?? {},
      children: [],
      isVisible: true,
      isInteractive: true,
      isTopElement: true,
      isInViewport: true,
      highlightIndex: index,
      backendNodeId: 100 + index,
      parent: body,
      // A measured box per element, so a screenshot narrowed to one has something to frame: 200x30 stacked 40 apart.
      viewportCoordinates: boxAt(index),
      pageCoordinates: boxAt(index),
    });
    if (element.text) node.children.push(new DOMTextNode(element.text, true, node));
    body.children.push(node);
    selectorMap.set(index, node);
  });
  return { elementTree: body, selectorMap };
}

/**
 * Serves `pages` in order, one tab: every page action (click, typing, navigation, keys) is recorded and moves to the
 * next page; the last page stays. `show()` switches the page at any time.
 */
export class FakeBrowserContext {
  readonly actions: BrowserAction[] = [];
  /** Page reads served (cached and fresh). */
  reads = 0;
  /** The window position a page read reports; a test that scrolls moves it. */
  scrollY = 0;
  /** What the next screenshot was asked to show (view_screenshot); null means the whole visible page, labelled. */
  screenshotOptions: ScreenshotOptions | null = null;
  config: BrowserContextConfig = {
    ...DEFAULT_BROWSER_CONTEXT_CONFIG,
    actionSettleTimeoutMs: 250,
    actionPollIntervalMs: 50,
    waitBetweenActions: 0,
  };
  /**
   * The tabs this fake browser has open, so a task spanning several of them can be driven with no browser at all.
   * `mine` mirrors the real context: the tab the agent attached to and every tab it opened or switched to.
   */
  tabs: TabInfo[] = [{ id: 1, url: '', title: '', mine: true }];
  currentTabId = 1;
  private nextTabId = 2;
  private readonly pages: PageSpec[];
  private index = 0;
  private readonly doms = new Map<PageSpec, Pick<BrowserState, 'elementTree' | 'selectorMap'>>();
  /** The form the commit gate reads around an element (or, without one, the focused element); none by default. */
  formFor: (node?: DOMElementNode) => FormCommitInfo | null = () => null;

  private readonly page = {
    tabId: 1,
    attached: true,
    url: () => this.current.url,
    title: async () => this.current.title ?? '',
    getCurrentState: async () => this.read(),
    getCachedState: async () => this.read(),
    getState: async () => this.read(),
    clickNode: async (node: DOMElementNode, clickCount = 1) =>
      this.pointer(clickCount === 2 ? 'double_click' : 'click', node),
    hoverNode: async (node: DOMElementNode) => this.pointer('hover', node),
    rightClickNode: async (node: DOMElementNode) => this.pointer('right_click', node),
    dragNode: async (node: DOMElementNode, target: DOMElementNode) =>
      this.act({ type: 'drag', index: node.highlightIndex ?? undefined, target: target.highlightIndex ?? undefined }),
    inputTextNode: async (node: DOMElementNode, text: string) => {
      this.act({ type: 'input', index: node.highlightIndex ?? undefined, text });
      return { matched: true, secret: false, actualLength: text.length, actual: text };
    },
    sendKeys: async (keys: string, node?: DOMElementNode) =>
      this.act({ type: 'send_keys', text: keys, index: node?.highlightIndex ?? undefined }),
    uploadFile: async (node: DOMElementNode, file: { name: string }) => {
      this.act({ type: 'upload', index: node.highlightIndex ?? undefined, text: file.name });
      return `; the file field now holds: ${file.name}`;
    },
    formCommitInfo: async (node?: DOMElementNode) => this.formFor(node),
    navigateTo: async (url: string) => this.act({ type: 'navigate', url }),
    getCompletePageContent: async () => this.current.content ?? [...(this.current.text ?? []), ...(this.current.offscreenText ?? [])].join('\n'),
    /** The read tools extract in the page; the fake has no DOM, so it returns the same text as markdown would be. */
    readPageMarkdown: async () => this.current.content ?? [...(this.current.text ?? []), ...(this.current.offscreenText ?? [])].join('\n\n'),
    nextPageHref: async () => '',
    /** Scrolling does not change the page served. */
    scrollToText: async (text: string) => {
      this.actions.push({ type: 'scroll_to_text', text });
      const content = this.current.content ?? [...(this.current.text ?? []), ...(this.current.offscreenText ?? [])].join('\n');
      return content.toLowerCase().includes(text.toLowerCase());
    },
    scrollByPages: async () => {},
    scrollToPercent: async () => {},
    /** [scrollY, viewport height, page height]: the page always fits the viewport. */
    getScrollInfo: async () => [0, 1000, 1000],
    goBack: async () => this.act({ type: 'go_back' }),
    goForward: async () => this.act({ type: 'go_forward' }),
    removeHighlight: async () => {},
    invalidateCache: () => {},
    setScreenshotOptions: (options: ScreenshotOptions | null) => {
      this.screenshotOptions = options;
    },
  };

  constructor(pages: PageSpec[]) {
    if (pages.length === 0) throw new Error('FakeBrowserContext needs at least one page');
    this.pages = [...pages];
  }

  get current(): PageSpec {
    return this.pages[this.index];
  }

  show(page: PageSpec): void {
    this.pages.push(page);
    this.index = this.pages.length - 1;
  }

  asBrowserContext(): BrowserContext {
    return this as unknown as BrowserContext;
  }

  // BrowserContext surface used by the agent.
  getConfig = () => this.config;
  getCurrentTabId = () => this.currentTabId;
  getCurrentPage = async () => this.page as unknown as Page;
  getCachedState = async (useVision = false) => ({ ...this.read(), screenshot: useVision ? 'c2NyZWVuc2hvdA==' : null });
  getState = async () => this.read();
  /** The current tab reports the page being served; the others keep whatever they were opened on. */
  /** What the real context reports in every page read: the current tab as served, the others as opened. */
  private tabInfos(): TabInfo[] {
    return this.tabs.map(tab =>
      tab.id === this.currentTabId ? { ...tab, url: this.current.url, title: this.current.title ?? tab.title } : tab,
    );
  }
  getTabInfos = async () => this.tabInfos();
  getAllTabIds = async () => new Set(this.tabs.map(tab => tab.id));
  navigateTo = async (url: string) => this.act({ type: 'navigate', url });
  openTab = async (url: string) => {
    const id = this.nextTabId++;
    this.tabs.push({ id, url, title: url, mine: true });
    this.currentTabId = id;
    this.act({ type: 'open_tab', url });
    return this.page as unknown as Page;
  };
  closeTab = async (tabId: number) => {
    this.tabs = this.tabs.filter(tab => tab.id !== tabId);
    if (this.currentTabId === tabId) this.currentTabId = this.tabs[0]?.id ?? 1;
    this.act({ type: 'close_tab', tabId });
  };
  switchTab = async (tabId: number) => {
    if (this.tabs.some(tab => tab.id === tabId)) this.currentTabId = tabId;
    this.act({ type: 'switch_tab', tabId });
  };
  removeHighlight = async () => {};
  invalidateCache = async () => {};
  waitForPageAndFramesLoad = async () => {};
  cleanup = async () => {};

  private read(): BrowserState {
    this.reads++;
    const spec = this.current;
    let dom = this.doms.get(spec);
    if (!dom) this.doms.set(spec, (dom = buildDom(spec)));
    const title = spec.title ?? '';
    return {
      ...dom,
      tabId: 1,
      url: spec.url,
      title,
      screenshot: null,
      scrollY: this.scrollY,
      scrollHeight: 1000,
      visualViewportHeight: 1000,
      dialog: spec.dialog,
      tabs: this.tabInfos(),
    };
  }

  private pointer(type: BrowserAction['type'], node: DOMElementNode) {
    this.act({ type, index: node.highlightIndex ?? undefined, label: node.getAllTextTillNextClickableElement() });
    return { fileChooser: false };
  }

  private act(action: BrowserAction): void {
    this.actions.push(action);
    this.index = Math.min(this.index + 1, this.pages.length - 1);
  }
}

// ── Storage and chrome ───────────────────────────────────────────────────────

/** In-memory stand-in for IndexedDBStorageProvider; share one instance between executors to test resuming. */
export class MemoryStorage {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return this.data.has(key) ? structuredClone(this.data.get(key) as T) : null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/** chrome.storage.local/session in memory and chrome.i18n; undo with vi.unstubAllGlobals(). */
export function stubChrome() {
  const area = () => {
    const data = new Map<string, unknown>();
    return {
      data,
      get: async (keys?: string | string[] | null) => {
        const wanted = keys == null ? [...data.keys()] : [keys].flat();
        return Object.fromEntries(wanted.filter(key => data.has(key)).map(key => [key, data.get(key)]));
      },
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) data.set(key, value);
      },
      remove: async (keys: string | string[]) => {
        for (const key of [keys].flat()) data.delete(key);
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    };
  };
  const chrome = {
    storage: { local: area(), session: area() },
    runtime: { id: 'test-extension' },
    i18n: { getMessage: (key: string) => key },
  };
  vi.stubGlobal('chrome', chrome);
  return chrome;
}

// ── Harness ──────────────────────────────────────────────────────────────────

/** Advances fake timers until `condition` holds (requires vi.useFakeTimers()). */
export async function until(condition: () => boolean, maxMs = 120_000, stepMs = 50): Promise<void> {
  for (let elapsed = 0; !condition(); elapsed += stepMs) {
    if (elapsed >= maxMs) throw new Error(`until: condition not met after ${maxMs} ms of fake time`);
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

/** Advances fake timers until the promise settles, then returns it. */
export async function settle<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await until(() => settled);
  return promise;
}

export interface HarnessOptions {
  task?: string;
  taskId?: string;
  pages?: PageSpec[];
  planner?: Script[];
  navigator?: Script[];
  /** Checkpoint storage; pass the same instance to a second harness to resume a task. */
  storage?: MemoryStorage;
  extraArgs?: Partial<ExecutorExtraArgs>;
}

/** A real Executor on a FakeChatModel (planner and navigator share it, as in production) and a FakeBrowserContext. */
export function createHarness(options: HarnessOptions = {}) {
  const llm = new FakeChatModel({ planner: options.planner, navigator: options.navigator });
  const browser = new FakeBrowserContext(options.pages ?? [{ url: 'https://example.test/', title: 'Example' }]);
  const storage = options.storage ?? new MemoryStorage();
  const executor = new Executor(
    options.task ?? 'Test task',
    options.taskId ?? 'task-1',
    browser.asBrowserContext(),
    llm.asChatModel(),
    options.extraArgs,
  );
  executor.getContext().checkpointStore = new TaskCheckpointStore(storage);
  const events: AgentEvent[] = [];
  executor.subscribeExecutionEvents(async event => {
    events.push(event);
  });
  return {
    llm,
    browser,
    storage,
    executor,
    events,
    states: () => events.map(event => event.state),
    has: (state: ExecutionState) => events.some(event => event.state === state),
    last: () => events[events.length - 1],
  };
}

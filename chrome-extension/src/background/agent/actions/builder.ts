import { ActionResult, type AgentContext } from '@src/background/agent/types';
import {
  clickElementActionSchema,
  doneActionSchema,
  goBackActionSchema,
  goForwardActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  openTabActionSchema,
  searchWebActionSchema,
  switchTabActionSchema,
  type ActionSchema,
  sendKeysActionSchema,
  scrollToTextActionSchema,
  saveFindingsActionSchema,
  selectDropdownOptionActionSchema,
  closeTabActionSchema,
  waitActionSchema,
  scrollActionSchema,
  hoverElementActionSchema,
  rightClickElementActionSchema,
  askHumanActionSchema,
  getCompletePageContentActionSchema,
  manageBookmarksActionSchema,
  manageReadingListActionSchema,
  manageHistoryActionSchema,
  manageDownloadsActionSchema,
  manageTabsActionSchema,
  manageWindowsActionSchema,
  managePrivacyActionSchema,
  manageExtensionsActionSchema,
  manageSystemActionSchema,
  manageSessionsActionSchema,
  dragElementActionSchema,
  handleDialogActionSchema,
} from './schemas';
import { z } from 'zod';
import { zodToToolParameters } from '@src/background/utils';
import { SystemHandler } from './handlers/system';
import { NavigationHandler } from './handlers/navigation';
import { InteractionHandler } from './handlers/interaction';
import { TabHandler } from './handlers/tabs';
import { ContentHandler } from './handlers/content';
import { KeyboardHandler } from './handlers/keyboard';
import { ManageBookmarksHandler } from './handlers/manage-bookmarks';
import { ManageReadingListHandler } from './handlers/manage-reading-list';
import { ManageHistoryHandler } from './handlers/manage-history';
import { ManageDownloadsHandler } from './handlers/manage-downloads';
import { ManageTabsHandler } from './handlers/manage-tabs';
import { ManageWindowsHandler } from './handlers/manage-windows';
import { ManagePrivacyHandler } from './handlers/manage-privacy';
import { ManageExtensionsHandler } from './handlers/manage-extensions';
import { ManageSystemHandler } from './handlers/manage-system';
import { ManageSessionsHandler } from './handlers/manage-sessions';

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * An action is a function that takes an input and returns an ActionResult
 */
export class Action {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public readonly handler: (input: any) => Promise<ActionResult>,
    public readonly schema: ActionSchema,
    // Whether this action has an index argument
    public readonly hasIndex: boolean = false,
  ) { }

  async call(input: unknown): Promise<ActionResult> {
    const schema = this.schema.schema;

    if (this.isEmptySchema(schema)) {
      const result = await this.handler({});
      return new ActionResult({ ...result, executed: true, executionStatus: 'executed' });
    }

    const parsedArgs = schema.safeParse(input);
    if (!parsedArgs.success) {
      throw new InvalidInputError(parsedArgs.error.message);
    }

    const result = await this.handler(parsedArgs.data);
    return new ActionResult({ ...result, executed: true, executionStatus: 'executed' });
  }

  private isEmptySchema(schema: z.ZodTypeAny): boolean {
    return (
      schema instanceof z.ZodObject &&
      Object.keys((schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {}).length === 0
    );
  }

  name(): string {
    return this.schema.name;
  }

  /**
   * The index argument of an action that has one; null when the action has none or this call omits it
   * (send_keys and scroll take an optional index).
   */
  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex || !input || typeof input !== 'object') {
      return null;
    }
    const index = (input as { index?: unknown }).index;
    return typeof index === 'number' ? index : null;
  }

  /**
   * Set the index argument in the input if this action has an index
   * @param input The input to update the index in
   * @param newIndex The new index value to set
   * @returns Whether the index was set successfully
   */
  setIndexArg(input: unknown, newIndex: number): boolean {
    if (!this.hasIndex) {
      return false;
    }
    if (input && typeof input === 'object') {
      (input as { index: number }).index = newIndex;
      return true;
    }
    return false;
  }
}

/** OpenAI-format tool definition; every LangChain chat adapter accepts this shape in bindTools. */
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** Extra field every navigator tool carries so the model's working memory rides along with each action. */
export const NAVIGATOR_TOOL_FIELDS = {
  memory: z.string().describe('Working memory for the next step, as described in the instructions.'),
};

/** Model-facing tool definitions, one per action. Deterministic, so the output is byte-stable for prompt caching. */
export function buildToolDefinitions(actions: ActionSchema[], extraFields: z.ZodRawShape = {}): ToolDefinition[] {
  return actions.map(action => ({
    type: 'function',
    function: {
      name: action.name,
      description: action.description,
      parameters: zodToToolParameters(action.schema.extend(extraFields)),
    },
  }));
}

/** Validators for tool-call arguments: the full internal schema plus the extra fields. */
export function buildToolValidators(
  actions: ActionSchema[],
  extraFields: z.ZodRawShape = {},
): Record<string, z.AnyZodObject> {
  return Object.fromEntries(actions.map(action => [action.name, action.schema.extend(extraFields)]));
}

export class ActionBuilder {
  private readonly systemHandler: SystemHandler;
  private readonly navigationHandler: NavigationHandler;
  private readonly interactionHandler: InteractionHandler;
  private readonly tabHandler: TabHandler;
  private readonly contentHandler: ContentHandler;
  private readonly keyboardHandler: KeyboardHandler;
  private readonly manageBookmarksHandler: ManageBookmarksHandler;
  private readonly manageReadingListHandler: ManageReadingListHandler;
  private readonly manageHistoryHandler: ManageHistoryHandler;
  private readonly manageDownloadsHandler: ManageDownloadsHandler;
  private readonly manageTabsHandler: ManageTabsHandler;
  private readonly manageWindowsHandler: ManageWindowsHandler;
  private readonly managePrivacyHandler: ManagePrivacyHandler;
  private readonly manageExtensionsHandler: ManageExtensionsHandler;
  private readonly manageSystemHandler: ManageSystemHandler;
  private readonly manageSessionsHandler: ManageSessionsHandler;

  constructor(private readonly context: AgentContext) {
    this.systemHandler = new SystemHandler(context);
    this.navigationHandler = new NavigationHandler(context);
    this.interactionHandler = new InteractionHandler(context);
    this.tabHandler = new TabHandler(context);
    this.contentHandler = new ContentHandler(context);
    this.keyboardHandler = new KeyboardHandler(context);
    this.manageBookmarksHandler = new ManageBookmarksHandler(context);
    this.manageReadingListHandler = new ManageReadingListHandler(context);
    this.manageHistoryHandler = new ManageHistoryHandler(context);
    this.manageDownloadsHandler = new ManageDownloadsHandler(context);
    this.manageTabsHandler = new ManageTabsHandler(context);
    this.manageWindowsHandler = new ManageWindowsHandler(context);
    this.managePrivacyHandler = new ManagePrivacyHandler(context);
    this.manageExtensionsHandler = new ManageExtensionsHandler(context);
    this.manageSystemHandler = new ManageSystemHandler(context);
    this.manageSessionsHandler = new ManageSessionsHandler(context);
  }

  buildDefaultActions(): Action[] {
    return [
      ...this.buildSystemActions(),
      ...this.buildNavigationActions(),
      ...this.buildInteractionActions(),
      ...this.buildTabActions(),
      ...this.buildContentActions(),
      ...this.buildKeyboardActions(),
      // They read or change the user's own browser data, which a page could try to talk the agent into: opt-in only.
      ...(this.context.options.enableBrowserDataTools ? this.buildChromeControlActions() : []),
    ];
  }

  // --- Category Builders ---

  private buildSystemActions(): Action[] {
    return [
      new Action((input) => this.systemHandler.handleDone(input), doneActionSchema),
      new Action((input) => this.systemHandler.handleAskHuman(input), askHumanActionSchema),
    ];
  }

  private buildNavigationActions(): Action[] {
    return [
      new Action((input) => this.navigationHandler.handleSearchWeb(input), searchWebActionSchema),
      new Action((input) => this.navigationHandler.handleGoToUrl(input), goToUrlActionSchema),
      new Action(() => this.navigationHandler.handleGoBack(), goBackActionSchema),
      new Action(() => this.navigationHandler.handleGoForward(), goForwardActionSchema),
      new Action((input) => this.navigationHandler.handleWait(input), waitActionSchema),
    ];
  }

  private buildInteractionActions(): Action[] {
    return [
      new Action((input) => this.interactionHandler.handleClickElement(input), clickElementActionSchema, true),
      new Action((input) => this.interactionHandler.handleHoverElement(input), hoverElementActionSchema, true),
      new Action((input) => this.interactionHandler.handleRightClickElement(input), rightClickElementActionSchema, true),
      new Action((input) => this.interactionHandler.handleInputText(input), inputTextActionSchema, true),
      new Action((input) => this.interactionHandler.handleDragElement(input), dragElementActionSchema, true),
      new Action((input) => this.interactionHandler.handleHandleDialog(input), handleDialogActionSchema),
      new Action(
        (input) => this.interactionHandler.handleSelectDropdownOption(input),
        selectDropdownOptionActionSchema,
        true,
      ),
    ];
  }

  private buildTabActions(): Action[] {
    return [
      new Action((input) => this.tabHandler.handleSwitchTab(input), switchTabActionSchema),
      new Action((input) => this.tabHandler.handleOpenTab(input), openTabActionSchema),
      new Action((input) => this.tabHandler.handleCloseTab(input), closeTabActionSchema),
    ];
  }

  private buildContentActions(): Action[] {
    return [
      new Action((input) => this.contentHandler.handleSaveFindings(input), saveFindingsActionSchema),
      new Action((input) => this.contentHandler.handleScroll(input), scrollActionSchema, true),
      new Action((input) => this.contentHandler.handleScrollToText(input), scrollToTextActionSchema),
      new Action((input) => this.contentHandler.handleGetCompletePageContent(input), getCompletePageContentActionSchema),
    ];
  }

  private buildKeyboardActions(): Action[] {
    return [new Action((input) => this.keyboardHandler.handleSendKeys(input), sendKeysActionSchema, true)];
  }

  private buildChromeControlActions(): Action[] {
    return [
      new Action((input) => this.manageBookmarksHandler.handleManageBookmarks(input), manageBookmarksActionSchema),
      new Action((input) => this.manageReadingListHandler.handleManageReadingList(input), manageReadingListActionSchema),
      new Action((input) => this.manageHistoryHandler.handleManageHistory(input), manageHistoryActionSchema),
      new Action((input) => this.manageDownloadsHandler.handleManageDownloads(input), manageDownloadsActionSchema),
      new Action((input) => this.manageTabsHandler.handleManageTabs(input), manageTabsActionSchema),
      new Action((input) => this.manageWindowsHandler.handleManageWindows(input), manageWindowsActionSchema),
      new Action((input) => this.managePrivacyHandler.handleManagePrivacy(input), managePrivacyActionSchema),
      new Action((input) => this.manageExtensionsHandler.handleManageExtensions(input), manageExtensionsActionSchema),
      new Action((input) => this.manageSystemHandler.handleManageSystem(input), manageSystemActionSchema),
      new Action((input) => this.manageSessionsHandler.handleManageSessions(input), manageSessionsActionSchema)
    ];
  }
}

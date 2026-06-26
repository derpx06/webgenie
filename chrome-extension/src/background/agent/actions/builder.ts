import { ActionResult, type AgentContext } from '@src/background/agent/types';
import {
  clickElementActionSchema,
  doneActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  openTabActionSchema,
  searchWebActionSchema,
  searchGoogleActionSchema,
  switchTabActionSchema,
  type ActionSchema,
  sendKeysActionSchema,
  scrollToTextActionSchema,
  cacheContentActionSchema,
  selectDropdownOptionActionSchema,
  getDropdownOptionsActionSchema,
  closeTabActionSchema,
  waitActionSchema,
  previousPageActionSchema,
  scrollToPercentActionSchema,
  nextPageActionSchema,
  scrollToTopActionSchema,
  scrollToBottomActionSchema,
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
  manageSessionsActionSchema
} from './schemas';
import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
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
   * Returns the prompt for the action
   * @returns {string} The prompt for the action
   */
  prompt(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaShape = (this.schema.schema as z.ZodObject<any>).shape || {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      const description = zodValue.description;
      const status = zodValue.isOptional() ? "'optional': true" : "'required': true";
      return `'${key}': {'type': '${description}', ${status}}`;
    });

    const schemaContent = schemaProperties.length > 0 ? `{${schemaProperties.join(', ')}}` : '{}';

    const schemaStr = `{${this.name()}: ${schemaContent}}`;

    return `${this.schema.description}:\n${schemaStr}`;
  }

  /**
   * Get the index argument from the input if this action has an index
   * @param input The input to extract the index from
   * @returns The index value if found, null otherwise
   */
  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex) {
      return null;
    }
    if (input && typeof input === 'object' && 'index' in input) {
      return (input as { index: number }).index;
    }
    return null;
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

// TODO: can not make every action optional, don't know why
export function buildDynamicActionSchema(actions: Action[]): z.ZodType {
  let schema = z.object({});
  for (const action of actions) {
    // create a schema for the action, it could be action.schema.schema or null
    // but don't use default: null as it causes issues with Google Generative AI
    const actionSchema = action.schema.schema;
    schema = schema.extend({
      [action.name()]: actionSchema.nullable().optional().describe(action.schema.description),
    });
  }
  return schema;
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

  constructor(context: AgentContext, extractorLLM: BaseChatModel) {
    this.systemHandler = new SystemHandler(context, extractorLLM);
    this.navigationHandler = new NavigationHandler(context, extractorLLM);
    this.interactionHandler = new InteractionHandler(context, extractorLLM);
    this.tabHandler = new TabHandler(context, extractorLLM);
    this.contentHandler = new ContentHandler(context, extractorLLM);
    this.keyboardHandler = new KeyboardHandler(context, extractorLLM);
    this.manageBookmarksHandler = new ManageBookmarksHandler(context, extractorLLM);
    this.manageReadingListHandler = new ManageReadingListHandler(context, extractorLLM);
    this.manageHistoryHandler = new ManageHistoryHandler(context, extractorLLM);
    this.manageDownloadsHandler = new ManageDownloadsHandler(context, extractorLLM);
    this.manageTabsHandler = new ManageTabsHandler(context, extractorLLM);
    this.manageWindowsHandler = new ManageWindowsHandler(context, extractorLLM);
    this.managePrivacyHandler = new ManagePrivacyHandler(context, extractorLLM);
    this.manageExtensionsHandler = new ManageExtensionsHandler(context, extractorLLM);
    this.manageSystemHandler = new ManageSystemHandler(context, extractorLLM);
    this.manageSessionsHandler = new ManageSessionsHandler(context, extractorLLM);
  }

  buildDefaultActions(): Action[] {
    return [
      ...this.buildSystemActions(),
      ...this.buildNavigationActions(),
      ...this.buildInteractionActions(),
      ...this.buildTabActions(),
      ...this.buildContentActions(),
      ...this.buildKeyboardActions(),
      ...this.buildChromeControlActions(),
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
      new Action((input) => this.navigationHandler.handleSearchGoogle(input), searchGoogleActionSchema),
      new Action((input) => this.navigationHandler.handleGoToUrl(input), goToUrlActionSchema),
      new Action((input) => this.navigationHandler.handleGoBack(input), goBackActionSchema),
      new Action((input) => this.navigationHandler.handleWait(input), waitActionSchema),
    ];
  }

  private buildInteractionActions(): Action[] {
    return [
      new Action((input) => this.interactionHandler.handleClickElement(input), clickElementActionSchema, true),
      new Action((input) => this.interactionHandler.handleHoverElement(input), hoverElementActionSchema, true),
      new Action((input) => this.interactionHandler.handleRightClickElement(input), rightClickElementActionSchema, true),
      new Action((input) => this.interactionHandler.handleInputText(input), inputTextActionSchema, true),
      new Action(
        (input) => this.interactionHandler.handleGetDropdownOptions(input),
        getDropdownOptionsActionSchema,
        true,
      ),
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
      new Action((input) => this.contentHandler.handleCacheContent(input), cacheContentActionSchema),
      new Action((input) => this.contentHandler.handleScrollToPercent(input), scrollToPercentActionSchema),
      new Action((input) => this.contentHandler.handleScrollToTop(input), scrollToTopActionSchema),
      new Action((input) => this.contentHandler.handleScrollToBottom(input), scrollToBottomActionSchema),
      new Action((input) => this.contentHandler.handlePreviousPage(input), previousPageActionSchema),
      new Action((input) => this.contentHandler.handleNextPage(input), nextPageActionSchema),
      new Action((input) => this.contentHandler.handleScrollToText(input), scrollToTextActionSchema),
      new Action((input) => this.contentHandler.handleGetCompletePageContent(input), getCompletePageContentActionSchema),
    ];
  }

  private buildKeyboardActions(): Action[] {
    return [new Action((input) => this.keyboardHandler.handleSendKeys(input), sendKeysActionSchema)];
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

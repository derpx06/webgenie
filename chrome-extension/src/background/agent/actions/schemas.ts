import { z } from 'zod';

export interface ActionSchema {
  name: string;
  description: string;
  schema: z.AnyZodObject;
}

const elementIndex = z.number().int().describe('index of the element in the interactive elements list');
const COMMIT_KINDS = ['none', 'order', 'payment', 'subscription', 'account_change'] as const;
const COMMITS_DESCRIPTION =
  "What this action commits, judged by what the control does in any language or icon: 'none' for everything that spends no money and changes no account (navigating, searching, adding to a cart, going to checkout, a form step, sending a message); 'order' when it places an order or completes a purchase; 'payment' when it pays; 'subscription' when it starts a subscription or trial; 'account_change' when it deletes, closes or changes an account or its security. For anything but 'none' the system asks the user first.";
const commitsField = z.enum(COMMIT_KINDS).optional().describe(COMMITS_DESCRIPTION);
/** Tools whose calls must say what they commit: the model decides on every click and key press. */
export const COMMIT_DECIDING_TOOLS = new Set(['click_element', 'send_keys']);
/** The model-facing form of `commits`: required, so a purchase in another language cannot slip through unmarked. */
export const REQUIRED_COMMITS_FIELD = { commits: z.enum(COMMIT_KINDS).describe(COMMITS_DESCRIPTION) };
const optionalElementIndex = z
  .number()
  .int()
  .nullable()
  .optional()
  .describe('index of a scrollable element; omit to scroll the whole page');

export const doneActionSchema: ActionSchema = {
  name: 'done',
  description:
    'Finish the task. Call it alone, not together with other actions, once the result is verified on the current page, or when the task cannot be completed.',
  schema: z.object({
    text: z
      .string()
      .describe(
        'The complete answer for the user, including every requested value. If success is false, say what is missing and why.',
      ),
    success: z.boolean().describe('true only if the whole user task is fully completed'),
  }),
};

// Basic Navigation Actions
export const searchWebActionSchema: ActionSchema = {
  name: 'search_web',
  description:
    'Search the web in one fast step using a search engine results page in the current tab. Prefer this over manually opening a search engine and typing.',
  schema: z.object({
    query: z.string().describe('search query in natural language'),
    engine: z.enum(['duckduckgo', 'google']).optional().describe('search engine to use; defaults to duckduckgo'),
  }),
};

export const goToUrlActionSchema: ActionSchema = {
  name: 'go_to_url',
  description: 'Navigate to URL in the current tab',
  schema: z.object({
    url: z.string().describe('absolute URL to open, including https://'),
  }),
};

export const goBackActionSchema: ActionSchema = {
  name: 'go_back',
  description: 'Go back to the previous page',
  schema: z.object({}),
};

export const goForwardActionSchema: ActionSchema = {
  name: 'go_forward',
  description: "Go forward to the next page in this tab's history (after go_back)",
  schema: z.object({}),
};

export const clickElementActionSchema: ActionSchema = {
  name: 'click_element',
  description: 'Click element by index. For a double-click, send one call with double: true; two separate clicks are not a double-click',
  schema: z.object({
    index: elementIndex,
    double: z.boolean().optional().describe('true to double-click instead of a single click (required whenever the task or the element asks for a double-click)'),
    commits: commitsField,
  }),
};

export const dragElementActionSchema: ActionSchema = {
  name: 'drag_element',
  description: 'Drag an element by index and drop it onto another element',
  schema: z.object({
    index: elementIndex,
    target_index: z.number().int().describe('index of the element to drop it on'),
  }),
};

export const handleDialogActionSchema: ActionSchema = {
  name: 'handle_dialog',
  description:
    'Answer the JavaScript dialog (alert, confirm, prompt) shown in the browser state. While a dialog is open no other page action works.',
  schema: z.object({
    accept: z.boolean().describe('true to press OK/accept, false to press Cancel/dismiss'),
    prompt_text: z.string().optional().describe('text to enter before accepting a prompt dialog'),
  }),
};

export const hoverElementActionSchema: ActionSchema = {
  name: 'hover_element',
  description: 'Hover mouse over an element by index to reveal hidden CSS menus or tooltips',
  schema: z.object({
    index: elementIndex,
  }),
};

export const rightClickElementActionSchema: ActionSchema = {
  name: 'right_click_element',
  description: 'Right click an element by index to open context menus',
  schema: z.object({
    index: elementIndex,
  }),
};

export const inputTextActionSchema: ActionSchema = {
  name: 'input_text',
  description:
    "Replace the field's content with text (inputs, textareas, editable elements, date and range inputs). Set submit to press Enter afterwards.",
  schema: z.object({
    index: elementIndex,
    text: z
      .string()
      .describe('text to input: only values from the task, the user\'s answers or the page. Never make up personal details (names, phone numbers, emails, addresses, payment details); ask_human for missing ones'),
    submit: z.boolean().optional().describe('true to press Enter in the field after typing (submits a search, chat message or form); defaults to false'),
    commits: z
      .enum(COMMIT_KINDS)
      .optional()
      .describe("with submit: what submitting commits, as for click_element's commits; omit otherwise"),
  }),
};

export const viewScreenshotActionSchema: ActionSchema = {
  name: 'view_screenshot',
  description:
    'See a screenshot of the visible part of the page with your next browser state, when the element list cannot tell you what you need: a chart, canvas, map or picture, colours, or where things are on the page. Call it alone; element indexes are drawn on the screenshot',
  schema: z.object({}),
};

export const uploadFileActionSchema: ActionSchema = {
  name: 'upload_file',
  description:
    'Upload a file the user attached: into a file field, an upload button or a drop zone by index. Only files the user attached; when none is, ask_human for it',
  schema: z.object({
    index: elementIndex,
    file: z.string().describe("the attached file's name, exactly as in the user's message"),
  }),
};

// Tab Management Actions
export const switchTabActionSchema: ActionSchema = {
  name: 'switch_tab',
  description: 'Switch to tab by tab id',
  schema: z.object({
    tab_id: z.number().int().describe('id of the tab to switch to'),
  }),
};

export const openTabActionSchema: ActionSchema = {
  name: 'open_tab',
  description: 'Open a web address in a new tab, which becomes the current tab. Not for chrome:// pages; to search, use search_web.',
  schema: z.object({
    url: z.string().describe('absolute URL to open, including https://'),
  }),
};

export const closeTabActionSchema: ActionSchema = {
  name: 'close_tab',
  description: 'Close tab by tab id',
  schema: z.object({
    tab_id: z.number().int().describe('id of the tab to close'),
  }),
};

export const saveFindingsActionSchema: ActionSchema = {
  name: 'save_findings',
  description:
    'Save findings for later steps (values, lists, partial results with where they came from). Saved findings are shown in every later step of this task; the newest are kept within about 1,500 characters.',
  schema: z.object({
    text: z.string().describe('the findings to keep, with exact values'),
  }),
};

export const scrollActionSchema: ActionSchema = {
  name: 'scroll',
  description:
    'Scroll the page, or the scrollable element at index: down or up by a number of screens, or to the top or bottom. It moves the view only; a next page of results behind a link or button needs a click.',
  schema: z.object({
    direction: z.enum(['down', 'up', 'top', 'bottom']).describe('down or up by pages, or to the top or bottom'),
    pages: z.number().optional().describe('screens to scroll down or up, 0.1-10 (for example 0.5 or 3); defaults to 1'),
    index: optionalElementIndex,
  }),
};

export const scrollToTextActionSchema: ActionSchema = {
  name: 'scroll_to_text',
  description: 'Scroll the nth visible match of a text (case-insensitive, all frames) into view; reports whether it was found.',
  schema: z.object({
    text: z.string().describe('text to scroll to'),
    nth: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('which occurrence of the text to scroll to, starting at 1; defaults to 1'),
  }),
};

export const sendKeysActionSchema: ActionSchema = {
  name: 'send_keys',
  description:
    'Press keys in the focused element, or in element index after focusing it: Enter, Escape, Tab, arrows, PageDown, Control+A... Not for typing text (input_text) or answering dialogs (handle_dialog).',
  schema: z.object({
    keys: z.string().describe('one key or shortcut, for example Enter, ArrowDown or Control+A'),
    index: z.number().int().optional().describe('index of the element to focus before pressing; omit to press in the focused element'),
    repeat: z.number().int().optional().describe('how many times to press, 1-50; defaults to 1'),
    commits: commitsField,
  }),
};

export const selectDropdownOptionActionSchema: ActionSchema = {
  name: 'select_dropdown_option',
  description:
    'Select an option of a native select, or an ARIA combobox or listbox, by its exact visible text; when no option matches, the result lists the available ones',
  schema: z.object({
    index: elementIndex,
    text: z.string().describe('exact visible text of the option to select'),
  }),
};

export const waitActionSchema: ActionSchema = {
  name: 'wait',
  description:
    'Wait for the page: until a text appears (text) or disappears (text_gone), returning as soon as it does, or for a number of seconds.',
  schema: z.object({
    seconds: z.number().int().optional().describe('longest wait in seconds, 1-10; defaults to 10 with text or text_gone, otherwise 3'),
    text: z.string().optional().describe('return once this text is on the page (case-insensitive)'),
    text_gone: z.string().optional().describe('return once this text is no longer on the page'),
  }),
};

export const askHumanActionSchema: ActionSchema = {
  name: 'ask_human',
  description:
    'Ask the user for a decision or information that is theirs: confirm sending, deleting or sharing something the task did not ask for, get information the task and page do not give (never invent it), or choose between items the task leaves open. Orders, payments, subscriptions and account changes are confirmed by the system when you act; do not ask for those.',
  schema: z.object({
    question: z.string().describe('the question or confirmation to show the user'),
    options: z.array(z.string()).optional().describe('choices shown as buttons'),
    fields: z
      .array(
        z.object({
          id: z.string().describe('unique field id'),
          label: z.string().describe('field label'),
          type: z
            .enum(['text', 'password', 'number', 'date', 'select'])
            .optional()
            .describe('input type; defaults to text; password for secrets'),
          required: z.boolean().optional().describe('defaults to true'),
          options: z.array(z.string()).optional().describe('choices of a select field'),
          placeholder: z.string().optional().describe('placeholder text'),
        }),
      )
      .optional()
      .describe('input fields for the user to fill'),
    type: z.enum(['question', 'confirmation']).optional().describe('defaults to question'),
    actionType: z
      .string()
      .optional()
      .describe('kind of action a confirmation is for (for example send_message), so the user can choose not to be asked again'),
  }),
};

export const getCompletePageContentActionSchema: ActionSchema = {
  name: 'get_complete_page_content',
  description:
    'Read the text of the whole page, frames included, up to 12,000 characters per call; find returns only the passages containing a text, start_char continues a longer read. Use it for articles, tables and long pages instead of scrolling.',
  schema: z.object({
    find: z.string().optional().describe('return only the passages containing this text (case-insensitive), with the text around them'),
    start_char: z.number().int().optional().describe('character offset to continue a truncated read from; defaults to 0'),
  }),
};

export const manageBookmarksActionSchema: ActionSchema = {
  name: 'manage_bookmarks',
  description: 'Manage Chrome bookmarks: get flat lists, search by title/url, get recent bookmarks, or create new ones.',
  schema: z.object({
    action: z.enum(['getFlat', 'search', 'create', 'getRecent']).describe('The action to perform on bookmarks'),
    query: z.string().optional().describe('Text query for searching bookmarks'),
    url: z.string().optional().describe('URL for bookmarking'),
    title: z.string().optional().describe('Title of the bookmark'),
    folderPath: z.string().optional().describe('Filter bookmarks by folder path name'),
    parentId: z.string().optional().describe('Parent folder ID to create a bookmark in (optional)'),
    count: z.number().int().optional().describe('Number of recent items to fetch (for getRecent)'),
  }),
};

export const manageReadingListActionSchema: ActionSchema = {
  name: 'manage_reading_list',
  description: 'Manage Chrome reading list: query items, get unread, add items, or mark as read.',
  schema: z.object({
    action: z.enum(['query', 'getUnread', 'add', 'markAsRead']).describe('The action to perform on the reading list'),
    url: z.string().optional().describe('URL for adding to or updating in reading list'),
    title: z.string().optional().describe('Title of the reading list item to add'),
  }),
};

export const manageHistoryActionSchema: ActionSchema = {
  name: 'manage_history',
  description: 'Manage Chrome history: get recent history items or find frequent domains.',
  schema: z.object({
    action: z.enum(['getRecent', 'getFrequentDomains']).describe('The action to perform on history'),
    query: z.string().optional().describe('Text query/search term for searching history'),
    daysAgo: z.number().int().optional().describe('Days ago filter for history and domain analysis'),
    maxResults: z.number().int().optional().describe('Max results to fetch for history items'),
    minVisitCount: z.number().int().optional().describe('Minimum visit count threshold for domain analysis'),
  }),
};

export const manageDownloadsActionSchema: ActionSchema = {
  name: 'manage_downloads',
  description: "Search Chrome's downloads (downloads during this task are already listed in the state).",
  schema: z.object({
    query: z.string().optional().describe('Text to search for in file names and addresses'),
  }),
};

export const manageTabsActionSchema: ActionSchema = {
  name: 'manage_tabs',
  description: 'Manage Chrome tab groups: group tabs, ungroup tabs, or update existing groups.',
  schema: z.object({
    action: z.enum(['groupTabs', 'ungroupTabs', 'updateGroup']).describe('The action to perform on tab groups'),
    tabIds: z.array(z.number().int()).optional().describe('Array of tab IDs to group or ungroup'),
    groupId: z.number().int().optional().describe('ID of the tab group to update'),
    windowId: z.number().int().optional().describe('Window ID to target or open groups in'),
    title: z.string().optional().describe('Title to set for the tab group'),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional()
      .describe('Color to set for a tab group'),
    collapsed: z.boolean().optional().describe('Whether to collapse or expand a tab group'),
  }),
};

export const manageWindowsActionSchema: ActionSchema = {
  name: 'manage_windows',
  description: 'Manage Chrome windows: get all windows or get the current window.',
  schema: z.object({
    action: z.enum(['getAllWindows', 'getCurrentWindow']).describe('The action to perform on windows'),
  }),
};

export const managePrivacyActionSchema: ActionSchema = {
  name: 'manage_privacy',
  description: 'Manage Chrome privacy data: clear browsing data like cookies, cache, or history.',
  schema: z.object({
    action: z.enum(['clearData']).describe('The action to perform for privacy'),
    clearTypes: z
      .array(
        z.enum([
          'appcache',
          'cache',
          'cacheStorage',
          'cookies',
          'downloads',
          'fileSystems',
          'formData',
          'history',
          'indexedDB',
          'localStorage',
          'passwords',
          'serviceWorkers',
          'webSQL',
        ]),
      )
      .optional()
      .describe('Data types to clear'),
    clearSince: z
      .number()
      .optional()
      .describe('Epoch timestamp (in ms) to clear data since. If not provided, clears all time.'),
  }),
};

export const manageExtensionsActionSchema: ActionSchema = {
  name: 'manage_extensions',
  description: 'Manage Chrome extensions: get all installed extensions or enable/disable them.',
  schema: z.object({
    action: z.enum(['getAll', 'setEnabled']).describe('The action to perform on extensions'),
    extensionId: z.string().optional().describe('Extension ID to enable/disable'),
    extensionEnabled: z.boolean().optional().describe('Whether to enable or disable the extension'),
  }),
};

export const manageSystemActionSchema: ActionSchema = {
  name: 'manage_system',
  description: 'Manage Chrome system info: get CPU or memory information.',
  schema: z.object({
    action: z.enum(['getCpu', 'getMemory']).describe('The action to perform on system info'),
  }),
};

export const manageSessionsActionSchema: ActionSchema = {
  name: 'manage_sessions',
  description: 'Manage Chrome sessions: get recently closed tabs/windows or restore a specific session.',
  schema: z.object({
    action: z.enum(['getRecentlyClosed', 'restore']).describe('The action to perform on sessions'),
    sessionId: z.string().optional().describe('Session ID to restore'),
  }),
};

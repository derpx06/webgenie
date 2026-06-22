import { z } from 'zod';

export interface ActionSchema {
  name: string;
  description: string;
  schema: z.ZodType;
}

export const doneActionSchema: ActionSchema = {
  name: 'done',
  description: 'Complete task',
  schema: z.object({
    text: z.string(),
    success: z.boolean(),
  }),
};

// Basic Navigation Actions
export const searchGoogleActionSchema: ActionSchema = {
  name: 'search_google',
  description:
    'Compatibility alias for Google search in the current tab. Prefer search_web for fast provider-agnostic web search.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    query: z.string(),
  }),
};

export const searchWebActionSchema: ActionSchema = {
  name: 'search_web',
  description:
    'Search the web in one fast step using a search engine results page in the current tab. Prefer this over manually opening a search engine and typing.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    query: z.string().describe('search query in natural language'),
    engine: z
      .enum(['duckduckgo', 'google'])
      .default('google')
      .describe('search engine to use; default is google'),
  }),
};

export const goToUrlActionSchema: ActionSchema = {
  name: 'go_to_url',
  description: 'Navigate to URL in the current tab',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string(),
  }),
};

export const goBackActionSchema: ActionSchema = {
  name: 'go_back',
  description: 'Go back to the previous page',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
};

export const clickElementActionSchema: ActionSchema = {
  name: 'click_element',
  description: 'Click element by index',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the element'),
    xpath: z.string().nullable().optional().describe('xpath of the element'),
  }),
};

export const hoverElementActionSchema: ActionSchema = {
  name: 'hover_element',
  description: 'Hover mouse over an element by index to reveal hidden CSS menus or tooltips',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the element'),
    xpath: z.string().nullable().optional().describe('xpath of the element'),
  }),
};

export const rightClickElementActionSchema: ActionSchema = {
  name: 'right_click_element',
  description: 'Right click an element by index to open context menus',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the element'),
    xpath: z.string().nullable().optional().describe('xpath of the element'),
  }),
};

export const inputTextActionSchema: ActionSchema = {
  name: 'input_text',
  description: 'Input text into an interactive input element',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the element'),
    text: z.string().describe('text to input'),
    xpath: z.string().nullable().optional().describe('xpath of the element'),
  }),
};

// Tab Management Actions
export const switchTabActionSchema: ActionSchema = {
  name: 'switch_tab',
  description: 'Switch to tab by tab id',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    tab_id: z.number().int().describe('id of the tab to switch to'),
  }),
};

export const openTabActionSchema: ActionSchema = {
  name: 'open_tab',
  description: 'Open URL in a new tab. Do NOT use chrome:// URLs (like chrome://newtab/). Use search_web or a specific website URL instead.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string().describe('url to open. If you need to search, use search_web action instead of opening a search engine manually.'),
  }),
};

export const closeTabActionSchema: ActionSchema = {
  name: 'close_tab',
  description: 'Close tab by tab id',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    tab_id: z.number().int().describe('id of the tab'),
  }),
};

// Content Actions, not used currently
export const extractContentActionSchema: ActionSchema = {
  name: 'extract_content',
  description:
    'Extract page content to retrieve specific information from the page, e.g. all company names, a specific description, all information about, links with companies in structured format or simply links',
  schema: z.object({
    goal: z.string(),
  }),
};

// Cache Actions
export const cacheContentActionSchema: ActionSchema = {
  name: 'cache_content',
  description: 'Cache what you have found so far from the current page for future use',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    content: z.string().default('').describe('content to cache'),
  }),
};

export const scrollToPercentActionSchema: ActionSchema = {
  name: 'scroll_to_percent',
  description:
    'Scrolls to a particular vertical percentage of the document or an element. If no index of element is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    yPercent: z.number().int().describe('percentage to scroll to - min 0, max 100; 0 is top, 100 is bottom'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const scrollToTopActionSchema: ActionSchema = {
  name: 'scroll_to_top',
  description: 'Scroll the document in the window or an element to the top',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const scrollToBottomActionSchema: ActionSchema = {
  name: 'scroll_to_bottom',
  description: 'Scroll the document in the window or an element to the bottom',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const previousPageActionSchema: ActionSchema = {
  name: 'previous_page',
  description:
    'Scroll the document in the window or an element to the previous page. If no index is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const nextPageActionSchema: ActionSchema = {
  name: 'next_page',
  description:
    'Scroll the document in the window or an element to the next page. If no index is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const scrollToTextActionSchema: ActionSchema = {
  name: 'scroll_to_text',
  description: 'If you dont find something which you want to interact with in current viewport, try to scroll to it',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    text: z.string().describe('text to scroll to'),
    nth: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('which occurrence of the text to scroll to (1-indexed, default: 1)'),
  }),
};

export const sendKeysActionSchema: ActionSchema = {
  name: 'send_keys',
  description:
    'Send strings of special keys like Backspace, Insert, PageDown, Delete, Enter. Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard press. Be aware of different operating systems and their shortcuts',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    keys: z.string().describe('keys to send'),
  }),
};

export const getDropdownOptionsActionSchema: ActionSchema = {
  name: 'get_dropdown_options',
  description: 'Get all options from a native dropdown',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the dropdown element'),
  }),
};

export const selectDropdownOptionActionSchema: ActionSchema = {
  name: 'select_dropdown_option',
  description: 'Select dropdown option for interactive element index by the text of the option you want to select',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the dropdown element'),
    text: z.string().describe('text of the option'),
  }),
};

export const waitActionSchema: ActionSchema = {
  name: 'wait',
  description: 'Wait for x seconds default 3, do NOT use this action unless user asks to wait explicitly',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    seconds: z.number().int().default(3).describe('amount of seconds'),
  }),
};

export const askHumanActionSchema: ActionSchema = {
  name: 'ask_human',
  description: 'Ask the human a question or request confirmation for sensitive actions.',
  schema: z.object({
    question: z.string().describe('The question or confirmation message to show the human'),
    options: z.array(z.string()).optional().describe('Optional list of choices (buttons) for the human to pick from'),
    fields: z.array(z.object({
      id: z.string().describe('Unique ID for the field'),
      label: z.string().describe('Label to show for the field'),
      type: z.enum(['text', 'number', 'date', 'select']).default('text').describe('The type of input field'),
      required: z.boolean().default(true).describe('Whether the field is required'),
      options: z.array(z.string()).optional().describe('Options for select type field'),
      placeholder: z.string().optional().describe('Placeholder text'),
    })).optional().describe('List of structured input fields for the user to fill'),
    type: z.enum(['question', 'confirmation']).default('question').describe('The type of intervention requested'),
    actionType: z.string().optional().describe('The class of action being confirmed (e.g., "send_message", "delete_item") for "don\'t ask again" tracking'),
  }),
};

export const getCompletePageContentActionSchema: ActionSchema = {
  name: 'get_complete_page_content',
  description:
    'Extract the complete text content of the current webpage at once. Use this to read long articles, posts, or page data without having to scroll or navigate.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
};

export const manageBookmarksActionSchema: ActionSchema = {
  name: 'manage_bookmarks',
  description: 'Manage Chrome bookmarks: get flat lists, search by title/url, get recent bookmarks, or create new ones.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['getFlat', 'search', 'create', 'getRecent']).describe('The action to perform on bookmarks'),
    query: z.string().optional().describe('Text query for searching bookmarks'),
    url: z.string().optional().describe('URL for bookmarking'),
    title: z.string().optional().describe('Title of the bookmark'),
    folderPath: z.string().optional().describe('Filter bookmarks by folder path name'),
    parentId: z.string().optional().describe('Parent folder ID to create a bookmark in (optional)'),
    count: z.number().int().optional().describe('Number of recent items to fetch (for getRecent)')
  }),
};

export const manageReadingListActionSchema: ActionSchema = {
  name: 'manage_reading_list',
  description: 'Manage Chrome reading list: query items, get unread, add items, or mark as read.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['query', 'getUnread', 'add', 'markAsRead']).describe('The action to perform on the reading list'),
    url: z.string().optional().describe('URL for adding to or updating in reading list'),
    title: z.string().optional().describe('Title of the reading list item to add')
  }),
};

export const manageHistoryActionSchema: ActionSchema = {
  name: 'manage_history',
  description: 'Manage Chrome history: get recent history items or find frequent domains.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['getRecent', 'getFrequentDomains']).describe('The action to perform on history'),
    query: z.string().optional().describe('Text query/search term for searching history'),
    daysAgo: z.number().int().optional().describe('Days ago filter for history and domain analysis'),
    maxResults: z.number().int().optional().describe('Max results to fetch for history items'),
    minVisitCount: z.number().int().optional().describe('Minimum visit count threshold for domain analysis')
  }),
};

export const manageDownloadsActionSchema: ActionSchema = {
  name: 'manage_downloads',
  description: 'Manage Chrome downloads: initiate a new download or search existing downloads.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['download', 'searchDownloads']).describe('The action to perform on downloads'),
    query: z.string().optional().describe('Text query/search term for searching downloads'),
    url: z.string().optional().describe('URL for downloading'),
    filename: z.string().optional().describe('Filename or relative path to save the downloaded file to'),
    conflictAction: z.enum(['uniquify', 'overwrite', 'prompt']).optional().describe('Action to resolve download conflicts'),
    saveAs: z.boolean().optional().describe('Whether to prompt the user with a Save As dialog box for downloads')
  }),
};

export const manageTabsActionSchema: ActionSchema = {
  name: 'manage_tabs',
  description: 'Manage Chrome tab groups: group tabs, ungroup tabs, or update existing groups.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['groupTabs', 'ungroupTabs', 'updateGroup']).describe('The action to perform on tab groups'),
    tabIds: z.array(z.number().int()).optional().describe('Array of tab IDs to group or ungroup'),
    groupId: z.number().int().optional().describe('ID of the tab group to update'),
    windowId: z.number().int().optional().describe('Window ID to target or open groups in'),
    title: z.string().optional().describe('Title to set for the tab group'),
    color: z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']).optional().describe('Color to set for a tab group'),
    collapsed: z.boolean().optional().describe('Whether to collapse or expand a tab group')
  }),
};

export const manageWindowsActionSchema: ActionSchema = {
  name: 'manage_windows',
  description: 'Manage Chrome windows: get all windows or get the current window.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['getAllWindows', 'getCurrentWindow']).describe('The action to perform on windows')
  }),
};

export const managePrivacyActionSchema: ActionSchema = {
  name: 'manage_privacy',
  description: 'Manage Chrome privacy data: clear browsing data like cookies, cache, or history.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['clearData']).describe('The action to perform for privacy'),
    clearTypes: z.array(z.enum(['appcache', 'cache', 'cacheStorage', 'cookies', 'downloads', 'fileSystems', 'formData', 'history', 'indexedDB', 'localStorage', 'passwords', 'serviceWorkers', 'webSQL'])).optional().describe('Data types to clear'),
    clearSince: z.number().optional().describe('Epoch timestamp (in ms) to clear data since. If not provided, clears all time.')
  }),
};

export const manageExtensionsActionSchema: ActionSchema = {
  name: 'manage_extensions',
  description: 'Manage Chrome extensions: get all installed extensions or enable/disable them.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['getAll', 'setEnabled']).describe('The action to perform on extensions'),
    extensionId: z.string().optional().describe('Extension ID to enable/disable'),
    extensionEnabled: z.boolean().optional().describe('Whether to enable or disable the extension')
  }),
};

export const manageSystemActionSchema: ActionSchema = {
  name: 'manage_system',
  description: 'Manage Chrome system info: get CPU or memory information.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['getCpu', 'getMemory']).describe('The action to perform on system info')
  }),
};

export const manageSessionsActionSchema: ActionSchema = {
  name: 'manage_sessions',
  description: 'Manage Chrome sessions: get recently closed tabs/windows or restore a specific session.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    action: z.enum(['getRecentlyClosed', 'restore']).describe('The action to perform on sessions'),
    sessionId: z.string().optional().describe('Session ID to restore')
  }),
};

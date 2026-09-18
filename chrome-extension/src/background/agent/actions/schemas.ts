import { z } from 'zod';

export interface ActionSchema {
  name: string;
  description: string;
  schema: z.AnyZodObject;
}

const elementIndex = z.number().int().describe('index from the interactive elements list');
const COMMIT_KINDS = ['none', 'order', 'payment', 'subscription', 'account_change'] as const;
const COMMITS_DESCRIPTION =
  "What this commits: 'none' unless it places an order, pays, starts a subscription or trial, or deletes, closes or changes an account. Anything but 'none' is confirmed with the user first.";
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
  .describe('a scrollable element; omit for the whole page');

export const doneActionSchema: ActionSchema = {
  name: 'done',
  description:
    'Propose the finished answer, alone in the response; the planner checks it against the page. Also when the task cannot be completed.',
  schema: z.object({
    text: z
      .string()
      .describe(
        'the complete answer, with every requested value; if success is false, what is missing and why',
      ),
    success: z.boolean().describe('true only if the whole task is complete'),
  }),
};

// Basic Navigation Actions
export const searchWebActionSchema: ActionSchema = {
  name: 'search_web',
  description:
    'Search the web in one step, in the current tab. Prefer it over opening a search engine and typing.',
  schema: z.object({
    query: z.string().describe('search query'),
    engine: z.enum(['duckduckgo', 'google']).optional().describe('defaults to duckduckgo'),
  }),
};

export const goToUrlActionSchema: ActionSchema = {
  name: 'go_to_url',
  description: 'Open a URL in the current tab.',
  schema: z.object({
    url: z.string().describe('absolute URL, including https://'),
  }),
};

export const goBackActionSchema: ActionSchema = {
  name: 'go_back',
  description: 'Go back to the previous page.',
  schema: z.object({}),
};

export const goForwardActionSchema: ActionSchema = {
  name: 'go_forward',
  description: 'Go forward again after go_back.',
  schema: z.object({}),
};

export const clickElementActionSchema: ActionSchema = {
  name: 'click_element',
  description: 'Click an element by index.',
  schema: z.object({
    index: elementIndex,
    double: z.boolean().optional().describe('true for a double-click; two separate calls are not one'),
    commits: commitsField,
  }),
};

export const dragElementActionSchema: ActionSchema = {
  name: 'drag_element',
  description: 'Drag an element by index and drop it onto another.',
  schema: z.object({
    index: elementIndex,
    target_index: z.number().int().describe('where to drop it'),
  }),
};

export const handleDialogActionSchema: ActionSchema = {
  name: 'handle_dialog',
  description:
    'Answer the JavaScript dialog in the browser state; no other action works while one is open.',
  schema: z.object({
    accept: z.boolean().describe('true for OK/accept, false for Cancel/dismiss'),
    prompt_text: z.string().optional().describe('text to enter before accepting a prompt'),
  }),
};

export const hoverElementActionSchema: ActionSchema = {
  name: 'hover_element',
  description: 'Hover an element by index to reveal a hidden menu or tooltip.',
  schema: z.object({
    index: elementIndex,
  }),
};

export const rightClickElementActionSchema: ActionSchema = {
  name: 'right_click_element',
  description: 'Right-click an element by index to open its context menu.',
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
      .describe('text to type: only values from the task, the user\'s answers or the page; never invented personal details'),
    submit: z.boolean().optional().describe('true to press Enter after typing; defaults to false'),
    commits: z
      .enum(COMMIT_KINDS)
      .optional()
      .describe("with submit: what submitting commits, as for click_element"),
  }),
};

export const fillFormActionSchema: ActionSchema = {
  name: 'fill_form',
  description:
    'Fill a whole form in one call: every field by index with its value, in order. All indexes are checked before anything is typed, and it stops at the first field whose typing leaves the page.',
  schema: z.object({
    fields: z
      .array(
        z.object({
          index: elementIndex,
          value: z
            .string()
            .describe("text to type: only values from the task, the user's answers or the page; never invented personal details"),
        }),
      )
      .describe('the fields to fill, in the order they should be filled'),
    submit: z.boolean().optional().describe('true to press Enter in the last field afterwards; defaults to false'),
    commits: z.enum(COMMIT_KINDS).optional().describe('with submit: what submitting commits, as for click_element'),
  }),
};

export const viewScreenshotActionSchema: ActionSchema = {
  name: 'view_screenshot',
  description:
    'Attach a screenshot of the visible page to your next state, for what the element list cannot say: colours, pictures, charts, maps, layout. Call it alone; indexes are drawn on it.',
  schema: z.object({}),
};

export const uploadFileActionSchema: ActionSchema = {
  name: 'upload_file',
  description:
    'Upload a file the user attached into a file field, upload button or drop zone by index. Only attached files; ask_human when none is.',
  schema: z.object({
    index: elementIndex,
    file: z.string().describe("the attached file's name, exactly as in the user's message"),
  }),
};

// Tab Management Actions
export const switchTabActionSchema: ActionSchema = {
  name: 'switch_tab',
  description: 'Switch to a tab by id.',
  schema: z.object({
    tab_id: z.number().int().describe('tab to switch to'),
  }),
};

export const openTabActionSchema: ActionSchema = {
  name: 'open_tab',
  description: 'Open an address in a new tab, which becomes the current tab. Not for chrome:// pages.',
  schema: z.object({
    url: z.string().describe('absolute URL, including https://'),
  }),
};

export const closeTabActionSchema: ActionSchema = {
  name: 'close_tab',
  description: 'Close a tab by id.',
  schema: z.object({
    tab_id: z.number().int().describe('tab to close'),
  }),
};

export const saveFindingsActionSchema: ActionSchema = {
  name: 'save_findings',
  description:
    'Keep values, lists or partial results, with where they came from, for later steps of this task.',
  schema: z.object({
    text: z.string().describe('what to keep, with exact values'),
  }),
};

export const notesActionSchema: ActionSchema = {
  name: 'notes',
  description:
    'Your own scratchpad for this task, shown in every later step and never summarized away: what you tried, what did not work, where things are, what to do next. Not the answer; that is save_findings.',
  schema: z.object({
    action: z.enum(['add', 'replace', 'clear']).describe('append a note, replace every note with this one, or drop them all'),
    text: z.string().optional().describe('the note; not needed for clear'),
  }),
};

export const todoListActionSchema: ActionSchema = {
  name: 'todo_list',
  description:
    'The parts of the task, numbered and shown in every step, so a task asking for several things loses none of them. Add them once, complete each as its answer is in hand.',
  schema: z.object({
    action: z.enum(['add', 'complete', 'reorder']).describe('append items, mark items done, or put them in this order'),
    items: z
      .array(z.string())
      .describe('the items: their text to add, their text or number to complete, or every item by number in the order wanted'),
  }),
};

export const assertActionSchema: ActionSchema = {
  name: 'assert',
  description:
    'Back a claim you are going to report with the page text that shows it, before you finish. The evidence is checked against the page you are on; a success is sent back without one.',
  schema: z.object({
    claim: z.string().describe('what you will report, in one sentence'),
    evidence: z.string().describe('the exact words on the page that show it, copied from the page, not your own wording'),
  }),
};

export const scrollActionSchema: ActionSchema = {
  name: 'scroll',
  description:
    'Scroll the page, or the element at index, by screens or to an end. It only moves the view: it loads no next page, reveals no element the list does not already hold, and is refused after a few scrolls that revealed nothing new.',
  schema: z.object({
    direction: z.enum(['down', 'up', 'top', 'bottom']).describe('down or up by pages, or to an end'),
    pages: z.number().optional().describe('screens to scroll, 0.1-10; defaults to 1'),
    index: optionalElementIndex,
  }),
};

export const scrollToTextActionSchema: ActionSchema = {
  name: 'scroll_to_text',
  description: 'Scroll the nth match of a text (case-insensitive, all frames) into view; reports whether it was found.',
  schema: z.object({
    text: z.string().describe('text to scroll to'),
    nth: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('which occurrence, from 1; defaults to 1'),
  }),
};

export const sendKeysActionSchema: ActionSchema = {
  name: 'send_keys',
  description:
    'Press keys in the focused element, or in element index after focusing it: Enter, Escape, Tab, arrows, PageDown, Control+A. Not for typing text (input_text) or dialogs (handle_dialog).',
  schema: z.object({
    keys: z.string().describe('one key or shortcut, e.g. Enter, ArrowDown, Control+A'),
    index: z.number().int().optional().describe('element to focus first; omit for the focused one'),
    repeat: z.number().int().optional().describe('presses, 1-50; defaults to 1'),
    commits: commitsField,
  }),
};

export const selectDropdownOptionActionSchema: ActionSchema = {
  name: 'select_dropdown_option',
  description:
    'Select an option of a select, combobox or listbox by its exact visible text; the result lists the options when none matches.',
  schema: z.object({
    index: elementIndex,
    text: z.string().describe('exact visible text of the option'),
  }),
};

export const waitActionSchema: ActionSchema = {
  name: 'wait',
  description:
    'Wait a fixed number of seconds, for nothing in particular. Use wait_for instead whenever you can name what you are waiting for: it returns as soon as it happens.',
  schema: z.object({
    seconds: z.number().int().optional().describe('seconds to wait, 1-10; defaults to 3'),
  }),
};

export const waitForActionSchema: ActionSchema = {
  name: 'wait_for',
  description:
    'Wait until the page reaches a state and return as soon as it does: a text appears or is gone, an element by index is gone, or loading and its requests have finished.',
  schema: z.object({
    condition: z
      .enum(['text', 'text_gone', 'element_gone', 'network_idle'])
      .describe('text appears / text is gone / the element at index is gone / loading finished'),
    text: z.string().optional().describe('the text, for text and text_gone; matched as whole words, case-insensitive'),
    index: z.number().int().optional().describe('the element, for element_gone'),
    seconds: z.number().int().optional().describe('longest wait, 1-30; defaults to 10'),
  }),
};

export const askHumanActionSchema: ActionSchema = {
  name: 'ask_human',
  description:
    'Ask the user for a decision or information that is theirs: a confirmation, a value the task and page do not give, or a choice the task leaves open. Never for an order, payment, subscription or account change: the system confirms those.',
  schema: z.object({
    question: z.string().describe('the question or confirmation to show'),
    options: z.array(z.string()).optional().describe('choices shown as buttons'),
    fields: z
      .array(
        z.object({
          id: z.string().describe('unique field id'),
          label: z.string().describe('field label'),
          type: z
            .enum(['text', 'password', 'number', 'date', 'select'])
            .optional()
            .describe('defaults to text; password for secrets'),
          required: z.boolean().optional().describe('defaults to true'),
          options: z.array(z.string()).optional().describe('choices of a select'),
        }),
      )
      .optional()
      .describe('fields for the user to fill'),
    type: z.enum(['question', 'confirmation']).optional().describe('defaults to question'),
    actionType: z
      .string()
      .optional()
      .describe('the kind of action a confirmation is for, so the user can choose not to be asked again'),
  }),
};

export const getCompletePageContentActionSchema: ActionSchema = {
  name: 'get_complete_page_content',
  description: 'Deprecated, use read_page (or find_in_page for find); this calls them.',
  schema: z.object({
    find: z.string().optional().describe('return only the passages containing this text, with their surroundings'),
    start_char: z.number().int().optional().describe('offset to continue a truncated read from; defaults to 0'),
  }),
};

export const readPageActionSchema: ActionSchema = {
  name: 'read_page',
  description:
    "Read the page as markdown instead of scrolling it. A long page returns its first part with a section outline and a cursor; section or cursor reads the rest.",
  schema: z.object({
    target: z.string().optional().describe("'current' (default) or an absolute URL to open and read"),
    mode: z
      .enum(['main', 'full', 'structured'])
      .optional()
      .describe("'main' content without navigation (default), 'full' all text, 'structured' outline only"),
    max_tokens: z.number().int().optional().describe('size of this part, 200-8000; default 3000'),
    section: z.string().optional().describe('one section, by outline id (s3) or heading'),
    cursor: z.number().int().optional().describe('offset from a previous read, to continue'),
    all_pages: z
      .boolean()
      .optional()
      .describe('true to follow next-page links or load more, reading every page'),
    max_pages: z.number().int().optional().describe('pages to read with all_pages, 1-20; defaults to 5'),
  }),
};

export const extractActionSchema: ActionSchema = {
  name: 'extract',
  description:
    'Pull typed data off the page against a JSON Schema you give: lists, tables, grids. Says per field whether it was parsed or inferred.',
  schema: z.object({
    schema: z
      .string()
      .describe('JSON Schema as text: an object with properties, or {"type":"array","items":{...}} for a list of them'),
    scope: z.string().optional().describe('limit it to one part of the page, by section id, heading or a text on it'),
  }),
};

export const findInPageActionSchema: ActionSchema = {
  name: 'find_in_page',
  description:
    'Find text anywhere on the page without reading it all: each match with its surroundings and, where there is one, the element index.',
  schema: z.object({
    query: z.string().describe('the text to find, or a regular expression when regex is true'),
    regex: z.boolean().optional().describe('true to read query as a JavaScript regular expression; defaults to false'),
    max_snippets: z.number().int().optional().describe('matches to return, 1-30; defaults to 8'),
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

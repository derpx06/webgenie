import { z } from 'zod';

/**
 * How hard this tool's call is to undo, as static metadata next to the schema (Magentic-UI's tiering):
 * - `never`: it reads, or it only changes what this task keeps; nothing outside the browser survives it.
 * - `maybe`: it depends on the target — a click is "Next page" or "Place order" — so the gate inspects the call.
 * - `always`: every call destroys something, so it is confirmed whatever its arguments say.
 *
 * The commit gate is derived from it (`COMMIT_DECIDING_TOOLS` below, `COMMIT_GATED_TOOLS` in `validation/service.ts`)
 * and `actions/__tests__/tools.test.ts` refuses a tool with no tier or one no gate knows, so a new tool cannot slip
 * past `commitTarget()` unnoticed.
 */
export type Irreversibility = 'always' | 'maybe' | 'never';

export interface ActionSchema {
  name: string;
  description: string;
  schema: z.AnyZodObject;
  irreversible: Irreversibility;
  /**
   * The model must say what this call commits: a press or a key whose meaning is in the element it lands on, which
   * only the model can read. `commits` becomes required in the model-facing schema (replays may omit it).
   */
  commitDeciding?: true;
}

const elementIndex = z.number().int().describe('index from the interactive elements list');
const COMMIT_KINDS = ['none', 'order', 'payment', 'subscription', 'account_change'] as const;
const COMMITS_DESCRIPTION =
  "What this commits: 'none' unless it places an order, pays, starts a subscription or trial, or deletes, closes or changes an account. Anything but 'none' is confirmed with the user first.";
const commitsField = z.enum(COMMIT_KINDS).optional().describe(COMMITS_DESCRIPTION);
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
  irreversible: 'never',
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
  irreversible: 'never',
  description:
    'Search the web in one step, in the current tab. Prefer it over opening a search engine and typing.',
  schema: z.object({
    query: z.string().describe('search query'),
    engine: z.enum(['duckduckgo', 'google']).optional().describe('defaults to duckduckgo'),
  }),
};

export const goToUrlActionSchema: ActionSchema = {
  name: 'go_to_url',
  irreversible: 'never',
  description: 'Open a URL in the current tab, or in a new tab that becomes the current one.',
  schema: z.object({
    url: z.string().describe('absolute URL, including https://'),
    new_tab: z.boolean().optional().describe('true to open it in a new tab, keeping this one; defaults to false'),
  }),
};

export const goBackActionSchema: ActionSchema = {
  name: 'go_back',
  irreversible: 'never',
  description: 'Go back to the previous page, or forward again after going back.',
  schema: z.object({
    forward: z.boolean().optional().describe('true to go forward again after a go_back; defaults to false'),
  }),
};

export const clickElementActionSchema: ActionSchema = {
  name: 'click_element',
  irreversible: 'maybe',
  commitDeciding: true,
  description:
    'Click an element by index. One option changes the gesture: double, right for its context menu, hover to only point at it, drop_on to drag it onto another element.',
  schema: z.object({
    index: elementIndex,
    target: z
      .string()
      .optional()
      .describe('the control you mean, as listed, e.g. Star "Weekend plans"; checked against index before the click'),
    double: z.boolean().optional().describe('true for a double-click; two separate calls are not one'),
    right: z.boolean().optional().describe('true to right-click it and open its context menu'),
    hover: z
      .boolean()
      .optional()
      .describe('true to only move the pointer onto it, revealing a hidden menu or tooltip, without clicking'),
    drop_on: z.number().int().optional().describe('index of the element to drag this one onto and drop it there'),
    desired_state: z
      .enum(['checked', 'unchecked'])
      .optional()
      .describe('for a checkbox, switch or radio: the state you want. One already in it is left alone, never toggled off'),
    commits: commitsField,
  }),
};

export const handleDialogActionSchema: ActionSchema = {
  name: 'handle_dialog',
  irreversible: 'maybe',
  description:
    'Answer the JavaScript dialog in the browser state; no other action works while one is open.',
  schema: z.object({
    accept: z.boolean().describe('true for OK/accept, false for Cancel/dismiss'),
    prompt_text: z.string().optional().describe('text to enter before accepting a prompt'),
  }),
};

export const inputTextActionSchema: ActionSchema = {
  name: 'input_text',
  irreversible: 'maybe',
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
  irreversible: 'maybe',
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
  irreversible: 'never',
  description:
    'Attach a screenshot to your next state, for what the element list cannot say: colours, pictures, charts, maps, layout. Never for text or a value: the read tools give those far more cheaply. Call it alone; index or region narrows it to one part.',
  schema: z.object({
    index: z.number().int().optional().describe('show only the element at this index and its surroundings'),
    region: z
      .array(z.number())
      .optional()
      .describe('show only this part of the visible page: [x, y, width, height] in pixels from its top left'),
    annotate: z.boolean().optional().describe('false to leave the index boxes off the image; defaults to true'),
  }),
};

export const uploadFileActionSchema: ActionSchema = {
  name: 'upload_file',
  irreversible: 'maybe',
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
  irreversible: 'never',
  description:
    'Switch to a tab by id, or close it. Work across several tabs by opening them with go_to_url (new_tab) and switching between them; each tab keeps its own page, scroll position and form state.',
  schema: z.object({
    tab_id: z.number().int().describe('the tab to act on, from the id shown in the browser state'),
    action: z.enum(['switch', 'close']).optional().describe("'switch' to it (default) or 'close' it"),
  }),
};

export const saveFindingsActionSchema: ActionSchema = {
  name: 'save_findings',
  irreversible: 'never',
  description:
    'Keep values, lists or partial results, with where they came from, for later steps of this task.',
  schema: z.object({
    text: z.string().describe('what to keep, with exact values'),
  }),
};

export const notesActionSchema: ActionSchema = {
  name: 'notes',
  irreversible: 'never',
  description:
    'Your own scratchpad for this task, shown in every later step and never summarized away: what you tried, what did not work, where things are, what to do next. Not the answer; that is save_findings.',
  schema: z.object({
    action: z.enum(['add', 'replace', 'clear']).describe('append a note, replace every note with this one, or drop them all'),
    text: z.string().optional().describe('the note; not needed for clear'),
  }),
};

export const todoListActionSchema: ActionSchema = {
  name: 'todo_list',
  irreversible: 'never',
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
  irreversible: 'never',
  description:
    'Back a claim you are going to report with the page text that shows it, before you finish. The evidence is checked against the page you are on; a success is sent back without one.',
  schema: z.object({
    claim: z.string().describe('what you will report, in one sentence'),
    evidence: z.string().describe('the exact words on the page that show it, copied from the page, not your own wording'),
  }),
};

export const scrollActionSchema: ActionSchema = {
  name: 'scroll',
  irreversible: 'never',
  description:
    'Scroll the page, or the element at index, by screens or to an end. It only moves the view: it loads no next page, reveals no element the list does not already hold, and is refused after a few scrolls that revealed nothing new.',
  schema: z.object({
    direction: z.enum(['down', 'up', 'top', 'bottom']).describe('down or up by pages, or to an end'),
    pages: z.number().optional().describe('screens to scroll, 0.1-10; defaults to 1'),
    index: optionalElementIndex,
    text: z
      .string()
      .optional()
      .describe('scroll the first match of this text into view instead (case-insensitive, all frames); reports whether it was found'),
  }),
};

export const sendKeysActionSchema: ActionSchema = {
  name: 'send_keys',
  irreversible: 'maybe',
  commitDeciding: true,
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
  irreversible: 'never',
  description:
    'Select an option of a select, combobox or listbox by its exact visible text; the result lists the options when none matches.',
  schema: z.object({
    index: elementIndex,
    text: z.string().describe('exact visible text of the option'),
  }),
};

export const waitForActionSchema: ActionSchema = {
  name: 'wait_for',
  irreversible: 'never',
  description:
    'Wait until the page reaches a state and return as soon as it does: a text appears or is gone, an element by index is gone, or loading and its requests have finished (the default).',
  schema: z.object({
    condition: z
      .enum(['text', 'text_gone', 'element_gone', 'network_idle'])
      .optional()
      .describe('text appears / text is gone / the element at index is gone / loading finished, which is the default'),
    text: z.string().optional().describe('the text, for text and text_gone; matched as whole words, case-insensitive'),
    index: z.number().int().optional().describe('the element, for element_gone'),
    seconds: z.number().int().optional().describe('longest wait, 1-30; defaults to 10'),
  }),
};

export const askHumanActionSchema: ActionSchema = {
  name: 'ask_human',
  irreversible: 'never',
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

export const readPageActionSchema: ActionSchema = {
  name: 'read_page',
  irreversible: 'never',
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
  irreversible: 'never',
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
  irreversible: 'never',
  description:
    'Find text anywhere on the page without reading it all: each match with its surroundings and, where there is one, the element index.',
  schema: z.object({
    query: z.string().describe('the text to find, or a regular expression when regex is true'),
    regex: z.boolean().optional().describe('true to read query as a JavaScript regular expression; defaults to false'),
    max_snippets: z.number().int().optional().describe('matches to return, 1-30; defaults to 8'),
  }),
};

export const sniffApiActionSchema: ActionSchema = {
  name: 'sniff_api',
  irreversible: 'never',
  description:
    "The JSON endpoints this site called while you browsed, with a sample of each. A list or table paged over many pages usually comes from one of them; fetch_json reads it in one call instead.",
  schema: z.object({
    filter: z.string().optional().describe('only endpoints whose address or sample contains this text'),
    limit: z.number().int().optional().describe('endpoints to return, 1-30; defaults to 10'),
  }),
};

export const fetchJsonActionSchema: ActionSchema = {
  name: 'fetch_json',
  irreversible: 'never',
  description:
    "Request a JSON address of the site you are on, in the page's own session, and read the reply. For an endpoint sniff_api showed; change its query to page or filter. It loads no page and clicks nothing.",
  schema: z.object({
    url: z.string().describe('absolute URL on the current site, as sniff_api gave it, with any query you want'),
    max_chars: z.number().int().optional().describe('characters of the reply to return, 500-40000; defaults to 8000'),
    path: z.string().optional().describe('return only this part of the reply, by dotted path, e.g. data.items'),
  }),
};

export const downloadActionSchema: ActionSchema = {
  name: 'download',
  irreversible: 'maybe',
  description:
    'Click a link or button that produces a file and wait for the browser to save it. read_file then reads it. For a file, not for a link that opens a page.',
  schema: z.object({
    index: elementIndex,
    seconds: z.number().int().optional().describe('longest wait for the file, 5-120; defaults to 30'),
  }),
};

export const readFileActionSchema: ActionSchema = {
  name: 'read_file',
  irreversible: 'never',
  description:
    'Read a file the task downloaded as text and tables: pdf, csv, xlsx, docx, txt. PDF text is marked [page n], so name the page a value came from.',
  schema: z.object({
    path: z.string().describe("the file's name as the state lists it, or the absolute URL it came from"),
    find: z.string().optional().describe('return only the passages containing this text, with their surroundings'),
  }),
};

export const evalJsActionSchema: ActionSchema = {
  name: 'eval_js',
  irreversible: 'never',
  description:
    'Last resort, when no other tool can see it: read a value out of the page with one JavaScript expression (shadow DOM, canvas, an exotic widget). It only reads; navigating, clicking, typing and storage are refused.',
  schema: z.object({
    expression: z
      .string()
      .describe('one JavaScript expression evaluated in the page, e.g. document.querySelector("x").shadowRoot.textContent; await is allowed'),
    max_chars: z.number().int().optional().describe('characters of the value to return, 200-8000; defaults to 2000'),
  }),
};

export const manageBookmarksActionSchema: ActionSchema = {
  name: 'manage_bookmarks',
  irreversible: 'never',
  description:
    "The user's bookmarks. search, getFlat, getRecent and listFolders show ids; create adds a bookmark (a folder when there is no url), update renames by id, move puts one in another folder. It cannot delete: that is the user's.",
  schema: z.object({
    action: z
      .enum(['getFlat', 'search', 'create', 'getRecent', 'listFolders', 'update', 'move'])
      .describe('What to do with the bookmarks'),
    query: z.string().optional().describe('Text to search for'),
    url: z.string().optional().describe('Address to bookmark, search for, or change to'),
    title: z.string().optional().describe('Title to create, search for, or change to'),
    folderPath: z.string().optional().describe('Only folders or bookmarks whose folder path contains this name'),
    id: z.string().optional().describe('The bookmark or folder to update or move, from a listing'),
    parentId: z.string().optional().describe('Folder id: where to create it, or where to move it'),
    count: z.number().int().optional().describe('How many recent bookmarks (getRecent)'),
  }),
};

export const manageReadingListActionSchema: ActionSchema = {
  name: 'manage_reading_list',
  irreversible: 'never',
  description: 'Manage Chrome reading list: query items, get unread, add items, or mark as read.',
  schema: z.object({
    action: z.enum(['query', 'getUnread', 'add', 'markAsRead']).describe('The action to perform on the reading list'),
    url: z.string().optional().describe('URL for adding to or updating in reading list'),
    title: z.string().optional().describe('Title of the reading list item to add'),
  }),
};

export const manageHistoryActionSchema: ActionSchema = {
  name: 'manage_history',
  irreversible: 'never',
  description:
    "What the user visited: getRecent lists pages newest first with last visit and visit count, in a window (daysAgo back to endDaysAgo: yesterday is 2 to 1); getFrequentDomains ranks sites. Read-only.",
  schema: z.object({
    action: z.enum(['getRecent', 'getFrequentDomains']).describe('List pages, or rank sites by visits'),
    query: z.string().optional().describe('Only pages whose title or address contains this text'),
    daysAgo: z.number().int().optional().describe('How far back to look, in days (default 7)'),
    endDaysAgo: z.number().int().optional().describe('Stop this many days ago instead of now, to look at one day or week'),
    maxResults: z.number().int().optional().describe('Pages to list, newest first (default 50, at most 200)'),
    minVisitCount: z.number().int().optional().describe('getFrequentDomains: skip sites visited fewer times'),
  }),
};

export const manageDownloadsActionSchema: ActionSchema = {
  name: 'manage_downloads',
  irreversible: 'never',
  description: "Search Chrome's downloads (downloads during this task are already listed in the state).",
  schema: z.object({
    query: z.string().optional().describe('Text to search for in file names and addresses'),
  }),
};

export const manageTabsActionSchema: ActionSchema = {
  name: 'manage_tabs',
  irreversible: 'never',
  description:
    "The user's open tabs and groups. listTabs and listGroups show the ids first; then groupTabs (a new group, or an existing one with groupId), updateGroup (title, colour, collapse) or ungroupTabs. Name each group for what it holds.",
  schema: z.object({
    action: z
      .enum(['listTabs', 'listGroups', 'groupTabs', 'ungroupTabs', 'updateGroup'])
      .describe('What to do with the tabs or groups'),
    tabIds: z.array(z.number().int()).optional().describe('Tab ids to group or ungroup, from listTabs'),
    groupId: z.number().int().optional().describe('Group id: the group to update, or the existing group to add tabs to'),
    windowId: z.number().int().optional().describe('Only this window'),
    query: z.string().optional().describe('listTabs: only tabs whose title or address contains this text'),
    title: z.string().optional().describe('Name for the group'),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional()
      .describe('Colour for the group'),
    collapsed: z.boolean().optional().describe('Collapse or expand the group'),
  }),
};

export const manageWindowsActionSchema: ActionSchema = {
  name: 'manage_windows',
  irreversible: 'never',
  description: 'Manage Chrome windows: get all windows or get the current window.',
  schema: z.object({
    action: z.enum(['getAllWindows', 'getCurrentWindow']).describe('The action to perform on windows'),
  }),
};

export const managePrivacyActionSchema: ActionSchema = {
  name: 'manage_privacy',
  irreversible: 'always',
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
  irreversible: 'maybe',
  description: 'Manage Chrome extensions: get all installed extensions or enable/disable them.',
  schema: z.object({
    action: z.enum(['getAll', 'setEnabled']).describe('The action to perform on extensions'),
    extensionId: z.string().optional().describe('Extension ID to enable/disable'),
    extensionEnabled: z.boolean().optional().describe('Whether to enable or disable the extension'),
  }),
};

export const manageSystemActionSchema: ActionSchema = {
  name: 'manage_system',
  irreversible: 'never',
  description: 'Manage Chrome system info: get CPU or memory information.',
  schema: z.object({
    action: z.enum(['getCpu', 'getMemory']).describe('The action to perform on system info'),
  }),
};

export const manageSessionsActionSchema: ActionSchema = {
  name: 'manage_sessions',
  irreversible: 'never',
  description: 'Manage Chrome sessions: get recently closed tabs/windows or restore a specific session.',
  schema: z.object({
    action: z.enum(['getRecentlyClosed', 'restore']).describe('The action to perform on sessions'),
    sessionId: z.string().optional().describe('Session ID to restore'),
  }),
};

/** Every tool the extension defines, whether or not this task offers it. */
export const ALL_ACTION_SCHEMAS: ActionSchema[] = [
  doneActionSchema,
  searchWebActionSchema,
  goToUrlActionSchema,
  goBackActionSchema,
  clickElementActionSchema,
  handleDialogActionSchema,
  inputTextActionSchema,
  fillFormActionSchema,
  viewScreenshotActionSchema,
  uploadFileActionSchema,
  switchTabActionSchema,
  saveFindingsActionSchema,
  notesActionSchema,
  todoListActionSchema,
  assertActionSchema,
  scrollActionSchema,
  sendKeysActionSchema,
  selectDropdownOptionActionSchema,
  waitForActionSchema,
  askHumanActionSchema,
  readPageActionSchema,
  extractActionSchema,
  findInPageActionSchema,
  sniffApiActionSchema,
  fetchJsonActionSchema,
  downloadActionSchema,
  readFileActionSchema,
  evalJsActionSchema,
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
];

/**
 * Tools whose calls must say what they commit, derived from the schemas rather than remembered by hand: a tool that
 * may not be undoable and whose meaning is in the element the model chose. Typing is gated on the form around the
 * field instead (`mayCommitThroughForm`), so its `commits` stays an optional hint.
 */
export const COMMIT_DECIDING_TOOLS = new Set(
  ALL_ACTION_SCHEMAS.filter(action => action.irreversible !== 'never' && action.commitDeciding).map(action => action.name),
);

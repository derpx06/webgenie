import { describe, it, expect, vi } from 'vitest';
import { NavigatorActionRegistry } from '../registry';
import { Action, ActionBuilder } from '../../../actions/builder';
import { manageHistoryActionSchema } from '../../../actions/schemas';
import { ActionResult, type AgentContext } from '../../../types';

vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

type Flags = { enableBrowserDataTools?: boolean; enableAdvancedTools?: boolean; useVision?: boolean };

const defaultRegistry = (options: Flags = {}) =>
  new NavigatorActionRegistry(new ActionBuilder({ options } as unknown as AgentContext).buildDefaultActions());

const names = (options: Flags = {}) => defaultRegistry(options).getTools().map(tool => tool.function.name);

describe('NavigatorActionRegistry tools', () => {
  it('memoizes the tool definitions and cannot be changed once built', () => {
    const registry = new NavigatorActionRegistry([new Action(async () => new ActionResult(), manageHistoryActionSchema)]);

    const tools = registry.getTools();
    expect(tools.map(tool => tool.function.name)).toEqual(['manage_history']);
    // The same array, so the tool block a task sends is byte-identical on every call of that task.
    expect(registry.getTools()).toBe(tools);
    expect(registry.getValidators()).toBe(registry.getValidators());
    expect(registry).not.toHaveProperty('registerAction');
    expect(registry).not.toHaveProperty('unregisterAction');
  });

  it('offers the browser data tools only when the user turns them on', () => {
    expect(names().filter(name => name.startsWith('manage_'))).toEqual([]);
    expect(names()).toEqual(expect.arrayContaining(['scroll', 'go_back', 'save_findings', 'send_keys', 'input_text']));
    expect(names()).not.toEqual(expect.arrayContaining(['search_google']));
    expect(names({ enableBrowserDataTools: true }).filter(name => name.startsWith('manage_'))).toHaveLength(10);
  });

  /**
   * The power tools reach past the page — the site's JSON, a JavaScript expression, files on disk — and no task in
   * 649 benchmark runs called one. They are off unless the user turns them on, chosen once, before the first call.
   */
  it('offers the power tools only when the user turns them on', () => {
    const power = ['eval_js', 'sniff_api', 'fetch_json', 'download', 'read_file'];
    for (const tool of power) expect(names()).not.toContain(tool);
    expect(names({ enableAdvancedTools: true })).toEqual(expect.arrayContaining(power));
    // Uploading a file the user attached is not a power tool: the user handed the file over themselves.
    expect(names()).toContain('upload_file');
  });

  /**
   * The ceiling on the tool list a task starts with. 28 tools cost ~5,300 tokens on every navigator call; the block is
   * paid 22.8 times a task, so a tool that earns nothing is paid for over and over (analysis-1-tool-census.md).
   * Plan 4.6 sets the target at 18, which needs the two gated merges as well (4.2 select_dropdown_option into
   * click_element, 4.7 notes/todo_list/assert into save_findings and the per-call memory).
   */
  it('keeps the default tool list small', () => {
    expect(names().length).toBeLessThanOrEqual(23);
    expect(names({ useVision: true }).length).toBeLessThanOrEqual(23);
    expect(names()).toEqual([
      'done',
      'ask_human',
      'search_web',
      'go_to_url',
      'go_back',
      'wait_for',
      'click_element',
      'input_text',
      'fill_form',
      'upload_file',
      'handle_dialog',
      'select_dropdown_option',
      'switch_tab',
      'save_findings',
      'scroll',
      'read_page',
      'find_in_page',
      'extract',
      'send_keys',
      'notes',
      'todo_list',
      'assert',
    ]);
  });

  it('still makes key presses state what they commit, with an index and a repeat count', () => {
    const validators = defaultRegistry().getValidators();

    expect(validators.send_keys.safeParse({ keys: 'ArrowRight', index: 3, repeat: 5, memory: 'm' }).success).toBe(false);
    expect(validators.send_keys.safeParse({ keys: 'ArrowRight', index: 3, repeat: 5, commits: 'none', memory: 'm' }).success).toBe(true);
    expect(validators.input_text.safeParse({ index: 1, text: 'weather', submit: true, memory: 'm' }).success).toBe(true);
    expect(validators.scroll.safeParse({ pages: 2, memory: 'm' }).success).toBe(false);
  });
});

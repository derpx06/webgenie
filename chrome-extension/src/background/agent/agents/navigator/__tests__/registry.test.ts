import { describe, it, expect, vi } from 'vitest';
import { NavigatorActionRegistry } from '../registry';
import { Action, ActionBuilder } from '../../../actions/builder';
import { doneActionSchema, manageHistoryActionSchema } from '../../../actions/schemas';
import { ActionResult, type AgentContext } from '../../../types';

vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

const defaultRegistry = (enableBrowserDataTools: boolean) =>
  new NavigatorActionRegistry(new ActionBuilder({ options: { enableBrowserDataTools } } as unknown as AgentContext).buildDefaultActions());

describe('NavigatorActionRegistry tools', () => {
  it('memoizes tool definitions and rebuilds them when actions change', () => {
    const handler = async () => new ActionResult();
    const registry = new NavigatorActionRegistry([new Action(handler, manageHistoryActionSchema)]);

    const tools = registry.getTools();
    expect(tools.map(tool => tool.function.name)).toEqual(['manage_history']);
    expect(registry.getTools()).toBe(tools);

    registry.registerAction(new Action(handler, doneActionSchema));
    expect(registry.getTools().map(tool => tool.function.name)).toEqual(['manage_history', 'done']);
    expect(registry.getValidators().done.safeParse({ text: 'x', success: true, memory: 'm' }).success).toBe(true);

    registry.unregisterAction('manage_history');
    expect(registry.getTools().map(tool => tool.function.name)).toEqual(['done']);
  });

  it('offers the browser data tools only when the user turns them on', () => {
    const names = (enabled: boolean) => defaultRegistry(enabled).getTools().map(tool => tool.function.name);

    expect(names(false).filter(name => name.startsWith('manage_'))).toEqual([]);
    expect(names(false)).toEqual(expect.arrayContaining(['scroll', 'go_forward', 'save_findings', 'send_keys', 'input_text']));
    expect(names(false)).not.toEqual(expect.arrayContaining(['search_google']));
    expect(names(true).filter(name => name.startsWith('manage_'))).toHaveLength(10);
  });

  it('still makes key presses state what they commit, with an index and a repeat count', () => {
    const validators = defaultRegistry(false).getValidators();

    expect(validators.send_keys.safeParse({ keys: 'ArrowRight', index: 3, repeat: 5, memory: 'm' }).success).toBe(false);
    expect(validators.send_keys.safeParse({ keys: 'ArrowRight', index: 3, repeat: 5, commits: 'none', memory: 'm' }).success).toBe(true);
    expect(validators.input_text.safeParse({ index: 1, text: 'weather', submit: true, memory: 'm' }).success).toBe(true);
    expect(validators.scroll.safeParse({ pages: 2, memory: 'm' }).success).toBe(false);
  });
});

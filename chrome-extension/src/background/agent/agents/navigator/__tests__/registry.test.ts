import { describe, it, expect } from 'vitest';
import { NavigatorActionRegistry } from '../registry';
import { Action } from '../../../actions/builder';
import { doneActionSchema, manageHistoryActionSchema } from '../../../actions/schemas';
import { ActionResult } from '../../../types';

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
});

import type { z } from 'zod';
import {
  type Action,
  buildToolDefinitions,
  buildToolValidators,
  NAVIGATOR_TOOL_FIELDS,
  type ToolDefinition,
} from '../../actions/builder';

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};
  private tools: ToolDefinition[] | null = null;
  private validators: Record<string, z.AnyZodObject> | null = null;

  constructor(actions: Action[]) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  registerAction(action: Action): void {
    this.actions[action.name()] = action;
    this.tools = this.validators = null;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
    this.tools = this.validators = null;
  }

  getTools(): ToolDefinition[] {
    this.tools ??= buildToolDefinitions(this.getAllActions().map(action => action.schema), NAVIGATOR_TOOL_FIELDS);
    return this.tools;
  }

  getValidators(): Record<string, z.AnyZodObject> {
    this.validators ??= buildToolValidators(this.getAllActions().map(action => action.schema), NAVIGATOR_TOOL_FIELDS);
    return this.validators;
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  getAllActions(): Action[] {
    return Object.values(this.actions);
  }
}

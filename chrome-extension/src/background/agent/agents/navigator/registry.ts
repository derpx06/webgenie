import type { z } from 'zod';
import {
  type Action,
  buildToolDefinitions,
  buildToolValidators,
  NAVIGATOR_TOOL_FIELDS,
  type ToolDefinition,
} from '../../actions/builder';
import { COMMIT_DECIDING_TOOLS, REQUIRED_COMMITS_FIELD, type ActionSchema } from '../../actions/schemas';

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
    this.tools ??= buildToolDefinitions(this.modelSchemas(), NAVIGATOR_TOOL_FIELDS);
    return this.tools;
  }

  getValidators(): Record<string, z.AnyZodObject> {
    this.validators ??= buildToolValidators(this.modelSchemas(), NAVIGATOR_TOOL_FIELDS);
    return this.validators;
  }

  /** Schemas as the model sees them: clicks and key presses must state what they commit (replays may omit it). */
  private modelSchemas(): ActionSchema[] {
    return this.getAllActions().map(({ schema }) =>
      COMMIT_DECIDING_TOOLS.has(schema.name) ? { ...schema, schema: schema.schema.extend(REQUIRED_COMMITS_FIELD) } : schema,
    );
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  getAllActions(): Action[] {
    return Object.values(this.actions);
  }
}

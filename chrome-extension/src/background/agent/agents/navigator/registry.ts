import type { z } from 'zod';
import {
  type Action,
  buildToolDefinitions,
  buildToolValidators,
  NAVIGATOR_TOOL_FIELDS,
  type ToolDefinition,
} from '../../actions/builder';
import { COMMIT_DECIDING_TOOLS, REQUIRED_COMMITS_FIELD, type ActionSchema } from '../../actions/schemas';

/**
 * The tools of one task. The set is fixed when the registry is built (the executor's constructor) and never changes
 * again: every provider's prompt cache is keyed on a prefix that starts with the tool block, so a tool added or
 * dropped mid-task invalidates it for every later call, and a model that saw a tool in step 1 may still call it.
 */
export class NavigatorActionRegistry {
  private readonly actions: Readonly<Record<string, Action>>;
  private tools: ToolDefinition[] | null = null;
  private validators: Record<string, z.AnyZodObject> | null = null;

  constructor(actions: Action[]) {
    this.actions = Object.fromEntries(actions.map(action => [action.name(), action]));
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

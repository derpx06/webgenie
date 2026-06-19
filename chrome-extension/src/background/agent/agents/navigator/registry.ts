import { z } from 'zod';
import { Action } from '../../actions/builder';
import { buildDynamicActionSchema } from '../../actions/builder';
import { agentBrainSchema } from '../../types';

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};
  private refinedDescriptions: Record<string, string> = {};

  constructor(actions: Action[]) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  registerAction(action: Action): void {
    this.actions[action.name()] = action;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  getAllActions(): Action[] {
    return Object.values(this.actions);
  }

  refineActionDescription(actionName: string, errorMsg: string, args: any): void {
    const errorString = errorMsg.slice(0, 150);
    this.refinedDescriptions[actionName] = `\n[DRAFT WARNING]: A previous call to this tool failed. ` +
      `Arguments sent: ${JSON.stringify(args)}. ` +
      `Error: "${errorString}". ` +
      `Please adjust your parameters to avoid repeating this failure.`;
  }

  setupModelOutputSchema(currentUrl?: string): z.ZodType {
    const actions = this.getAllActions().map(action => {
      let description = action.schema.description;
      if (this.refinedDescriptions[action.name()]) {
        description += this.refinedDescriptions[action.name()];
      }

      return new Action(
        action.handler,
        {
          name: action.name(),
          description: description,
          schema: action.schema.schema,
        },
        action.hasIndex
      );
    });

    const actionSchema = buildDynamicActionSchema(actions);
    return z.object({
      current_state: agentBrainSchema,
      action: z.array(actionSchema),
    });
  }
}

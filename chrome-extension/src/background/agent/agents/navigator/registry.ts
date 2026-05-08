import { z } from 'zod';
import type { Action } from '../../actions/builder';
import { buildDynamicActionSchema } from '../../actions/builder';
import { agentBrainSchema } from '../../types';

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};

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

  setupModelOutputSchema(): z.ZodType {
    const actionSchema = buildDynamicActionSchema(this.getAllActions());
    return z.object({
      current_state: agentBrainSchema,
      action: z.array(actionSchema),
    });
  }
}

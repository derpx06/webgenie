import { z } from 'zod';
import { Action , buildDynamicActionSchema } from '../../actions/builder';
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

  setupModelOutputSchema(currentUrl?: string, macroObjective?: string): z.ZodType {
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
    let actionArray = z.array(actionSchema);
    
    if (macroObjective === 'NAVIGATE' || macroObjective === 'VERIFY_STATE' || macroObjective === 'BROWSER_CONTROL') {
      actionArray = actionArray.max(2, 'Only 1 or 2 actions allowed for this macro objective to prevent hallucinations');
    } else if (macroObjective === 'FORM_FILL' || macroObjective === 'SEARCH' || macroObjective === 'EXTRACT_DATA') {
      actionArray = actionArray.max(5, 'Maximum of 5 actions allowed for batching');
    } else {
      actionArray = actionArray.max(3); // default safe throttle
    }

    return z.object({
      current_state: agentBrainSchema,
      action: actionArray,
    });
  }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { plannerSystemPromptTemplate } from './templates/planner';

/** Only when the navigator can take screenshots (V2: unable to see a colour, the planner asked the user which swatch was green). */
const PLANNER_VISION_RULES = `# Seeing the page
The navigator can look at a screenshot of the page (view_screenshot). When the task depends on how the page looks (a colour, a picture, a chart, where something is) and the browser state does not say it, plan EXPLORE_PAGE to look first. Never ask the user what the page shows, and do not list items as matching until how they look is known.`;

export class PlannerPrompt extends BasePrompt {
  constructor(private readonly vision = false) {
    super();
  }

  getSystemMessage(): SystemMessage {
    return new SystemMessage(this.vision ? `${plannerSystemPromptTemplate}\n\n${PLANNER_VISION_RULES}` : plannerSystemPromptTemplate);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return new HumanMessage('');
  }
}

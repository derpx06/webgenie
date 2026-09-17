/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt, forTools } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { plannerSystemPromptTemplate } from './templates/planner';

/** Only when the navigator can take screenshots (V2: unable to see a colour, the planner asked the user which swatch was green). */
const PLANNER_VISION_RULES = `# Seeing the page
The navigator can look at a screenshot of the page (view_screenshot). When the task depends on how the page looks (a colour, a picture, a chart, where something is) and the browser state does not say it, plan EXPLORE_PAGE to look first. Never ask the user what the page shows, and do not list items as matching until how they look is known.`;

export class PlannerPrompt extends BasePrompt {
  private readonly systemPrompt: string;

  /** `tools`: the names of the navigator's registered actions; the prompt mentions no other tool. */
  constructor(tools: ReadonlySet<string>) {
    super();
    const prompt = forTools(plannerSystemPromptTemplate, tools);
    this.systemPrompt = tools.has('view_screenshot') ? `${prompt}\n\n${PLANNER_VISION_RULES}` : prompt;
  }

  getSystemMessage(): SystemMessage {
    return new SystemMessage(this.systemPrompt);
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return new HumanMessage('');
  }
}

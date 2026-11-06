/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt, forTools } from './base';
import { type HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { createLogger } from '@src/background/log';
import { navigatorSystemPromptTemplate } from './templates/navigator';
import { type AskLevel, askRules } from './templates/common';

const logger = createLogger('agent/prompts/navigator');

/** Only when view_screenshot is registered. */
const NAVIGATOR_VISION_RULES = `# Seeing the page
- Colours, pictures, charts, maps and where things are on the page are not in the element list. When the task depends on them, call view_screenshot and look before acting; never ask the user what the page shows.`;

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemMessage;

  /** `tools`: the names of the registered actions; the prompt mentions no other tool. */
  constructor(
    private readonly maxActionsPerStep: number,
    tools: ReadonlySet<string>,
    askLevel: AskLevel = 'balanced',
  ) {
    super();

    // Format the template with the maxActionsPerStep
    const formattedPrompt = forTools(
      navigatorSystemPromptTemplate
        .replace('{{max_actions}}', this.maxActionsPerStep.toString())
        .replace('{{ask_choose}}', askRules[askLevel].choose)
        .replace('{{ask_settle}}', askRules[askLevel].settle)
        .replace('{{ask_never}}', askRules[askLevel].never)
        .trim(),
      tools,
    );
    this.systemMessage = new SystemMessage(tools.has('view_screenshot') ? `${formattedPrompt}\n\n${NAVIGATOR_VISION_RULES}` : formattedPrompt);
  }

  getSystemMessage(): SystemMessage {
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return await this.buildBrowserStateUserMessage(context);
  }
}

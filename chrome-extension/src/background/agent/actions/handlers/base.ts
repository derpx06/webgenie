import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';

export abstract class BaseHandler {
  constructor(
    protected readonly context: AgentContext,
    protected readonly extractorLLM: BaseChatModel
  ) {}

  protected handleElementNotFound(index: number): ActionResult {
    const errorMsg = t('act_errors_elementNotExist', [index.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
    return new ActionResult({ error: errorMsg, includeInMemory: true });
  }
}

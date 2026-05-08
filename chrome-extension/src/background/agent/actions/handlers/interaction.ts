import { ActionResult } from '@src/background/agent/types';
import type {
  clickElementActionSchema,
  inputTextActionSchema,
  getDropdownOptionsActionSchema,
  selectDropdownOptionActionSchema,
} from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import { createLogger } from '@src/background/log';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import type { DOMElementNode, DOMState } from '@src/background/browser/dom/views';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';

const logger = createLogger('Action');

type ResolvablePage = {
  getCachedState(): DOMState | null;
  getState(useVision?: boolean, cacheClickableElementsHashes?: boolean): Promise<DOMState>;
  locateElement(element: DOMElementNode): Promise<ElementHandle<Element> | null>;
  clickElementNode(useVision: boolean, elementNode: DOMElementNode): Promise<void>;
  inputTextElementNode(useVision: boolean, elementNode: DOMElementNode, text: string): Promise<void>;
  isFileUploader(elementNode: DOMElementNode, maxDepth?: number, currentDepth?: number): boolean;
};

export class InteractionHandler extends BaseHandler {
  private async remapElementInState(
    latestElementTree: DOMElementNode,
    elementNode: DOMElementNode,
  ): Promise<DOMElementNode | null> {
    const historyElement = HistoryTreeProcessor.convertDomElementToHistoryElement(elementNode);
    return await HistoryTreeProcessor.findHistoryElementInTree(historyElement, latestElementTree);
  }

  private normalizeXPath(xpath?: string | null): string | null {
    if (!xpath) return null;
    const normalized = xpath.trim();
    if (!normalized) return null;
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  private findByXPathInSelectorMap(
    selectorMap: Map<number, DOMElementNode>,
    xpath?: string | null,
  ): DOMElementNode | null {
    const targetXPath = this.normalizeXPath(xpath);
    if (!targetXPath) return null;

    for (const element of selectorMap.values()) {
      const candidateXPath = this.normalizeXPath(element.xpath);
      if (candidateXPath && candidateXPath === targetXPath) {
        return element;
      }
    }
    return null;
  }

  private async resolveElementNode(
    page: ResolvablePage,
    index: number,
    xpath?: string | null,
  ): Promise<DOMElementNode | null> {
    const cachedState = page.getCachedState();
    const cachedElement = cachedState?.selectorMap.get(index) ?? null;

    const latestState = await page.getState();
    let resolved = latestState?.selectorMap.get(index) ?? null;
    if (resolved) return resolved;

    resolved = this.findByXPathInSelectorMap(latestState.selectorMap, xpath);
    if (resolved) return resolved;

    if (cachedElement && latestState.elementTree) {
      const remapped = await this.remapElementInState(latestState.elementTree, cachedElement);
      if (remapped) {
        logger.info(
          `Resolved stale index ${index} -> ${remapped.highlightIndex ?? 'unknown'} via history remap`,
        );
        return remapped;
      }
    }

    return null;
  }

  async handleClickElement(input: z.infer<typeof clickElementActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_click_start', [input.index.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    let elementNode = await this.resolveElementNode(page, input.index, input.xpath);

    if (!elementNode) {
      await new Promise(resolve => setTimeout(resolve, 250));
      elementNode = await this.resolveElementNode(page, input.index, input.xpath);
    }

    if (!elementNode) {
      throw new Error(t('act_errors_elementNotExist', [input.index.toString()]));
    }

    if (page.isFileUploader(elementNode)) {
      const msg = t('act_click_fileUploader', [input.index.toString()]);
      logger.info(msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }

    try {
      const initialTabIds = await this.context.browserContext.getAllTabIds();
      await page.clickElementNode(this.context.options.useVision, elementNode);

      let msg = t('act_click_ok', [input.index.toString(), elementNode.getAllTextTillNextClickableElement(2)]);
      logger.info(msg);

      const currentTabIds = await this.context.browserContext.getAllTabIds();
      if (currentTabIds.size > initialTabIds.size) {
        const newTabMsg = t('act_click_newTabOpened');
        msg += ` - ${newTabMsg}`;
        logger.info(newTabMsg);
        const newTabId = Array.from(currentTabIds).find((id) => !initialTabIds.has(id));
        if (newTabId) {
          await this.context.browserContext.switchTab(newTabId);
        }
      }

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      try {
        const relocated = await this.resolveElementNode(page, input.index, input.xpath);
        if (relocated) {
          const initialTabIds = await this.context.browserContext.getAllTabIds();
          await page.clickElementNode(this.context.options.useVision, relocated);

          let msg = t('act_click_ok', [input.index.toString(), relocated.getAllTextTillNextClickableElement(2)]);
          if (relocated.highlightIndex !== null && relocated.highlightIndex !== input.index) {
            msg += ` (index updated to ${relocated.highlightIndex})`;
          }

          const currentTabIds = await this.context.browserContext.getAllTabIds();
          if (currentTabIds.size > initialTabIds.size) {
            const newTabMsg = t('act_click_newTabOpened');
            msg += ` - ${newTabMsg}`;
            const newTabId = Array.from(currentTabIds).find((id) => !initialTabIds.has(id));
            if (newTabId) {
              await this.context.browserContext.switchTab(newTabId);
            }
          }

          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }
      } catch (recoveryError) {
        logger.debug('Failed click recovery after DOM shift:', recoveryError);
      }

      const msg = t('act_errors_elementNoLongerAvailable', [input.index.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleInputText(input: z.infer<typeof inputTextActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_inputText_start', [input.index.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    let elementNode = await this.resolveElementNode(page, input.index, input.xpath);

    if (!elementNode) {
      await new Promise(resolve => setTimeout(resolve, 250));
      elementNode = await this.resolveElementNode(page, input.index, input.xpath);
    }

    if (!elementNode) {
      throw new Error(t('act_errors_elementNotExist', [input.index.toString()]));
    }

    await page.inputTextElementNode(this.context.options.useVision, elementNode, input.text);
    const msg = t('act_inputText_ok', [input.text, input.index.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleGetDropdownOptions(
    input: z.infer<typeof getDropdownOptionsActionSchema.schema>,
  ): Promise<ActionResult> {
    const intent = input.intent || t('act_getDropdownOptions_start', [input.index.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    let elementNode = await this.resolveElementNode(page, input.index);

    if (!elementNode) {
      await new Promise(resolve => setTimeout(resolve, 250));
      elementNode = await this.resolveElementNode(page, input.index);
    }

    if (!elementNode) {
      return this.handleElementNotFound(input.index);
    }

    try {
      const dropdownHandle = await page.locateElement(elementNode);
      if (!dropdownHandle) {
        return this.handleElementNotFound(input.index);
      }

      const options = await dropdownHandle.evaluate(select => {
        if (!(select instanceof HTMLSelectElement)) {
          throw new Error('Element is not a select element');
        }

        return Array.from(select.options).map(option => ({
          index: option.index,
          text: option.text,
          value: option.value,
        }));
      });

      if (options && options.length > 0) {
        const formattedOptions = options.map((opt) => `${opt.index}: text=${JSON.stringify(opt.text)}`);
        let msg = formattedOptions.join('\n');
        msg += '\n' + t('act_getDropdownOptions_useExactText');
        this.context.emitEvent(
          Actors.NAVIGATOR,
          ExecutionState.ACT_OK,
          t('act_getDropdownOptions_ok', [options.length.toString()]),
        );
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }

      const msg = t('act_getDropdownOptions_noOptions');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      const errorMsg = t('act_getDropdownOptions_failed', [error instanceof Error ? error.message : String(error)]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      return new ActionResult({ error: errorMsg, includeInMemory: true });
    }
  }

  async handleSelectDropdownOption(
    input: z.infer<typeof selectDropdownOptionActionSchema.schema>,
  ): Promise<ActionResult> {
    const intent = input.intent || t('act_selectDropdownOption_start', [input.text, input.index.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    let elementNode = await this.resolveElementNode(page, input.index);

    if (!elementNode) {
      await new Promise(resolve => setTimeout(resolve, 250));
      elementNode = await this.resolveElementNode(page, input.index);
    }

    if (!elementNode) {
      return this.handleElementNotFound(input.index);
    }

    if (!elementNode.tagName || elementNode.tagName.toLowerCase() !== 'select') {
      const errorMsg = t('act_selectDropdownOption_notSelect', [
        input.index.toString(),
        elementNode.tagName || 'unknown',
      ]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      return new ActionResult({ error: errorMsg, includeInMemory: true });
    }

    logger.debug(`Attempting to select '${input.text}' using xpath: ${elementNode.xpath}`);

    try {
      const dropdownHandle = await page.locateElement(elementNode);
      if (!dropdownHandle) {
        return this.handleElementNotFound(input.index);
      }

      const result = await dropdownHandle.evaluate(
        (select, optionText, elementIndex) => {
          if (!(select instanceof HTMLSelectElement)) {
            throw new Error(`Element with index ${elementIndex} is not a SELECT`);
          }

          const options = Array.from(select.options);
          const option = options.find(opt => opt.text.trim() === optionText);

          if (!option) {
            const availableOptions = options.map(o => o.text.trim()).join('", "');
            throw new Error(
              `Option "${optionText}" not found in dropdown element with index ${elementIndex}. Available options: "${availableOptions}"`,
            );
          }

          const previousValue = select.value;
          select.value = option.value;
          if (previousValue !== option.value) {
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));
          }

          return `Selected option "${optionText}" with value "${option.value}"`;
        },
        input.text,
        input.index,
      );
      const msg = t('act_selectDropdownOption_ok', [input.text, input.index.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: result, includeInMemory: true });
    } catch (error) {
      const errorMsg = t('act_selectDropdownOption_failed', [error instanceof Error ? error.message : String(error)]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
      return new ActionResult({ error: errorMsg, includeInMemory: true });
    }
  }
}

import { ActionResult } from '@src/background/agent/types';
import type {
  cacheContentActionSchema,
  scrollToPercentActionSchema,
  scrollToTopActionSchema,
  scrollToBottomActionSchema,
  previousPageActionSchema,
  nextPageActionSchema,
  scrollToTextActionSchema,
  getCompletePageContentActionSchema,
} from '../schemas';
import type { z } from 'zod';
import { t } from '@extension/i18n';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import { wrapUntrustedContent } from '../../messages/utils';
import { createLogger } from '@src/background/log';

const logger = createLogger('Action');

export class ContentHandler extends BaseHandler {
  async handleCacheContent(input: z.infer<typeof cacheContentActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_cache_start', [input.content]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const rawMsg = t('act_cache_ok', [input.content]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, rawMsg);

    const msg = wrapUntrustedContent(rawMsg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleScrollToPercent(input: z.infer<typeof scrollToPercentActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_scrollToPercent_start');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await this.context.browserContext.getCurrentPage();

    if (input.index) {
      const state = await page.getCachedState();
      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        return this.handleElementNotFound(input.index);
      }
      logger.info(`Scrolling to percent: ${input.yPercent} with elementNode: ${elementNode.xpath}`);
      await page.scrollToPercent(input.yPercent, elementNode);
    } else {
      await page.scrollToPercent(input.yPercent);
    }

    const msg = t('act_scrollToPercent_ok', [input.yPercent.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleScrollToTop(input: z.infer<typeof scrollToTopActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_scrollToTop_start');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await this.context.browserContext.getCurrentPage();

    if (input.index) {
      const state = await page.getCachedState();
      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        return this.handleElementNotFound(input.index);
      }
      await page.scrollToPercent(0, elementNode);
    } else {
      await page.scrollToPercent(0);
    }

    const msg = t('act_scrollToTop_ok');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleScrollToBottom(input: z.infer<typeof scrollToBottomActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_scrollToBottom_start');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await this.context.browserContext.getCurrentPage();

    if (input.index) {
      const state = await page.getCachedState();
      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        return this.handleElementNotFound(input.index);
      }
      await page.scrollToPercent(100, elementNode);
    } else {
      await page.scrollToPercent(100);
    }

    const msg = t('act_scrollToBottom_ok');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handlePreviousPage(input: z.infer<typeof previousPageActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_previousPage_start');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await this.context.browserContext.getCurrentPage();

    if (input.index) {
      const state = await page.getCachedState();
      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        return this.handleElementNotFound(input.index);
      }

      try {
        const [elementScrollTop] = await page.getElementScrollInfo(elementNode);
        if (elementScrollTop === 0) {
          const msg = t('act_errors_alreadyAtTop', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }
      } catch (error) {
        logger.warning(`Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`);
      }

      await page.scrollToPreviousPage(elementNode);
    } else {
      const [initialScrollY] = await page.getScrollInfo();
      if (initialScrollY === 0) {
        const msg = t('act_errors_pageAlreadyAtTop');
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }
      await page.scrollToPreviousPage();
    }

    const msg = t('act_previousPage_ok');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleNextPage(input: z.infer<typeof nextPageActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_nextPage_start');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await this.context.browserContext.getCurrentPage();

    if (input.index) {
      const state = await page.getCachedState();
      const elementNode = state?.selectorMap.get(input.index);
      if (!elementNode) {
        return this.handleElementNotFound(input.index);
      }

      try {
        const [elementScrollTop, elementClientHeight, elementScrollHeight] = await page.getElementScrollInfo(elementNode);
        if (elementScrollTop + elementClientHeight >= elementScrollHeight) {
          const msg = t('act_errors_alreadyAtBottom', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }
      } catch (error) {
        logger.warning(`Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`);
      }

      await page.scrollToNextPage(elementNode);
    } else {
      const [initialScrollY, initialVisualViewportHeight, initialScrollHeight] = await page.getScrollInfo();
      if (initialScrollY + initialVisualViewportHeight >= initialScrollHeight) {
        const msg = t('act_errors_pageAlreadyAtBottom');
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }
      await page.scrollToNextPage();
    }

    const msg = t('act_nextPage_ok');
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }

  async handleScrollToText(input: z.infer<typeof scrollToTextActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || t('act_scrollToText_start', [input.text, input.nth.toString()]);
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    try {
      const scrolled = await page.scrollToText(input.text, input.nth);
      const msg = scrolled
        ? t('act_scrollToText_ok', [input.text, input.nth.toString()])
        : t('act_scrollToText_notFound', [input.text, input.nth.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      const msg = t('act_scrollToText_failed', [error instanceof Error ? error.message : String(error)]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
  }

  async handleGetCompletePageContent(input: z.infer<typeof getCompletePageContentActionSchema.schema>): Promise<ActionResult> {
    const intent = input.intent || 'Extracting complete page content...';
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const page = await this.context.browserContext.getCurrentPage();
    try {
      const content = await page.getCompletePageContent();
      const sanitized = wrapUntrustedContent(content, false);
      const msg = `Successfully extracted ${content.length} characters of page content.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: sanitized, includeInMemory: true });
    } catch (error) {
      const msg = `Failed to extract page content: ${error instanceof Error ? error.message : String(error)}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
  }
}


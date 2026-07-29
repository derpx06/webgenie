import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DOMElementNode } from '../../../../browser/dom/views';
import type { AgentContext } from '../../../types';
import { ContentHandler } from '../content';

vi.mock('@extension/i18n', () => ({
  t: (key: string) => key,
}));

function createElement(index: number): DOMElementNode {
  return new DOMElementNode({
    tagName: 'DIV',
    xpath: `/div[${index + 1}]`,
    attributes: {},
    children: [],
    isVisible: true,
    isInViewport: true,
    highlightIndex: index,
  });
}

describe('ContentHandler indexed scrolling', () => {
  it('treats index 0 as a valid element target', async () => {
    const element = createElement(0);
    const scrollToPercent = vi.fn();
    const page = {
      getCachedState: vi.fn(async () => ({
        selectorMap: new Map([[0, element]]),
      })),
      scrollToPercent,
    };
    const context = {
      emitEvent: vi.fn(),
      browserContext: {
        getCurrentPage: vi.fn(async () => page),
      },
    } as unknown as AgentContext;
    const handler = new ContentHandler(context, {} as BaseChatModel);

    await handler.handleScrollToTop({ intent: 'scroll to top', index: 0 });

    expect(scrollToPercent).toHaveBeenCalledWith(0, element);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { SystemMessage, type HumanMessage } from '@langchain/core/messages';
import { ActionResult, type AgentContext } from '../../types';
import { DOMElementNode } from '../../../browser/dom/views';
import { NavigatorAgent } from '../../agents/navigator';
import { BasePrompt, capPromptSection, scrollViewportPercentage } from '../base';

class BrowserStatePrompt extends BasePrompt {
  getSystemMessage(): SystemMessage {
    return new SystemMessage('test');
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return this.buildBrowserStateUserMessage(context);
  }
}

describe('browser prompt budgeting', () => {
  it('caps large sections while retaining both the beginning and end', () => {
    const value = `${'head '.repeat(100)}middle ${'tail '.repeat(100)}`;
    const capped = capPromptSection(value, 220, 'interactive DOM');

    expect(capped.length).toBeLessThanOrEqual(220);
    expect(capped).toContain('interactive DOM truncated');
    expect(capped).toContain('head');
    expect(capped).toContain('tail');
  });

  it('does not emit Infinity or NaN for a non-scrollable page', () => {
    expect(scrollViewportPercentage(800, 800)).toBeNull();
    expect(scrollViewportPercentage(800, 400)).toBe(100);
    expect(scrollViewportPercentage(2000, 400)).toBe(25);
  });

  it('keeps native action results visible while constructing the next state message', async () => {
    const root = new DOMElementNode({
      tagName: 'body',
      xpath: '',
      attributes: {},
      children: [],
      isVisible: true,
    });
    const browserState = {
      elementTree: root,
      selectorMap: new Map(),
      tabId: 7,
      url: 'about:blank',
      title: 'Blank',
      screenshot: null,
      scrollY: 0,
      scrollHeight: 800,
      visualViewportHeight: 800,
      tabs: [{ id: 7, url: 'about:blank', title: 'Blank' }],
    };
    const actionResult = new ActionResult({
      extractedContent: 'Bookmark created: Example',
      includeInMemory: true,
    });
    const stateMessages: HumanMessage[] = [];
    const context = {
      browserContext: { getState: vi.fn().mockResolvedValue(browserState) },
      options: { useVision: false, includeAttributes: [], logDOMSnapshot: false },
      actionResults: [actionResult],
      stateMessageAdded: false,
      lastGoal: undefined,
      lastMemory: '',
      lastEvaluation: '',
      messageManager: {
        getWorkingMemory: vi.fn().mockReturnValue(''),
        addMessageWithTokens: vi.fn(),
        addStateMessage: vi.fn((message: HumanMessage) => stateMessages.push(message)),
      },
      isSelectorBlocked: vi.fn().mockReturnValue(false),
    } as unknown as AgentContext;

    await NavigatorAgent.prototype.addStateMessageToMemory.call({
      context,
      prompt: new BrowserStatePrompt(),
    } as unknown as NavigatorAgent);

    expect(stateMessages).toHaveLength(1);
    expect(String(stateMessages[0].content)).toContain('Bookmark created: Example');
    expect(context.actionResults).toEqual([]);
  });
});

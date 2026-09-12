import { describe, expect, it, vi } from 'vitest';
import { SystemMessage, type HumanMessage } from '@langchain/core/messages';
import { ActionResult, type AgentContext } from '../../types';
import { DOMElementNode } from '../../../browser/dom/views';
import { BasePrompt, capPromptSection, scrollViewportPercentage, windowAroundViewport } from '../base';

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

  it('windows a long element list around the first on-screen element', () => {
    const above = Array.from({ length: 50 }, (_, i) => `[${i}]<a offscreen="true">above ${i} />`);
    const visible = ['Visible heading', '[50]<button>On screen />'];
    const below = Array.from({ length: 50 }, (_, i) => `[${51 + i}]<a offscreen="true">below ${i} />`);
    const text = [...above, ...visible, ...below].join('\n');

    const windowed = windowAroundViewport(text, 600);

    expect(windowed).toContain('[50]<button>On screen />');
    expect(windowed).toMatch(/^\.\.\. \d+ lines above; scroll up to see them \.\.\./);
    expect(windowed).toMatch(/\.\.\. \d+ lines below; scroll down to see them \.\.\.$/);
    expect(windowed.length).toBeLessThan(700);
    expect(windowAroundViewport('short', 600)).toBe('short');
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
    const context = {
      browserContext: { getCachedState: vi.fn().mockResolvedValue(browserState) },
      options: { useVision: false, includeAttributes: [], logDOMSnapshot: false },
      actionResults: [actionResult],
      lastGoal: undefined,
      messageManager: { getWorkingMemory: vi.fn().mockReturnValue('') },
    } as unknown as AgentContext;

    const content = String((await new BrowserStatePrompt().getUserMessage(context)).content);

    expect(content).toContain('Results of your last actions:');
    expect(content).toContain('Bookmark created: Example');
    expect(content).not.toContain('observation id');
    expect(content).not.toContain('target fingerprints');
  });
});

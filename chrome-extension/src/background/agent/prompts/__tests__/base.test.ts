import { describe, expect, it, vi } from 'vitest';
import { SystemMessage, type HumanMessage } from '@langchain/core/messages';
import { ActionResult, type AgentContext } from '../../types';
import { DOMElementNode, DOMTextNode } from '../../../browser/dom/views';
import { BasePrompt, capPromptSection, controlSummary, scrollViewportPercentage, windowAroundViewport } from '../base';

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

  it('says a page that could not be read in time is not empty', async () => {
    const root = new DOMElementNode({ tagName: 'body', xpath: '', attributes: {}, children: [], isVisible: true });
    const browserState = {
      elementTree: root,
      selectorMap: new Map(),
      unreadable: true,
      tabId: 7,
      url: 'https://example.com/',
      title: 'Example',
      screenshot: null,
      scrollY: 0,
      scrollHeight: 800,
      visualViewportHeight: 800,
      tabs: [{ id: 7, url: 'https://example.com/', title: 'Example' }],
    };
    const context = {
      browserContext: { getCachedState: vi.fn().mockResolvedValue(browserState) },
      options: { useVision: false, includeAttributes: [], logDOMSnapshot: false },
      actionResults: [],
      messageManager: { getWorkingMemory: vi.fn().mockReturnValue('') },
    } as unknown as AgentContext;

    const content = String((await new BrowserStatePrompt().getUserMessage(context)).content);

    expect(content).toContain('could not be read in time');
    expect(content).not.toContain('empty page');
  });

  it('shows an open JavaScript dialog and tells the navigator to answer it first', async () => {
    const root = new DOMElementNode({ tagName: 'body', xpath: '', attributes: {}, children: [], isVisible: true });
    const browserState = {
      elementTree: root,
      selectorMap: new Map(),
      tabId: 7,
      url: 'https://example.com/',
      title: 'Example',
      screenshot: null,
      scrollY: 0,
      scrollHeight: 800,
      visualViewportHeight: 800,
      tabs: [{ id: 7, url: 'https://example.com/', title: 'Example' }],
      dialog: { type: 'confirm', message: 'Delete everything?' },
    };
    const context = {
      browserContext: { getCachedState: vi.fn().mockResolvedValue(browserState) },
      options: { useVision: false, includeAttributes: [], logDOMSnapshot: false },
      actionResults: [],
      messageManager: { getWorkingMemory: vi.fn().mockReturnValue('') },
    } as unknown as AgentContext;

    const content = String((await new BrowserStatePrompt().getUserMessage(context)).content);

    expect(content).toContain('JavaScript confirm dialog open, written by the page: <nano_untrusted_content>Delete everything?</nano_untrusted_content>');
    expect(content).toContain('handle_dialog');
  });
});

describe('control summary above the element list', () => {
  const element = (index: number, tagName: string, attributes: Record<string, string>, text = '') => {
    const node = new DOMElementNode({ tagName, xpath: '', attributes, children: [], isVisible: true, isInteractive: true, highlightIndex: index });
    if (text) node.children.push(new DOMTextNode(text, true, node));
    return node;
  };
  const page = () => [
    element(0, 'input', { role: 'searchbox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }),
    element(1, 'button', { 'aria-expanded': 'false' }, 'Price'),
    element(2, 'button', { 'aria-expanded': 'true' }, 'Brand'),
    element(3, 'button', { 'aria-label': 'Sort by', 'aria-haspopup': 'menu' }),
    element(4, 'input', { role: 'checkbox', 'aria-label': '4 stars & up', 'aria-checked': 'true' }),
    element(5, 'input', { role: 'checkbox', 'aria-checked': 'false' }),
    element(6, 'label', { checked: 'true' }, 'Free shipping'),
    element(7, 'input', { type: 'radio', role: 'radio', 'aria-checked': 'false' }),
    element(8, 'select', { role: 'combobox', 'aria-expanded': 'false' }),
    element(9, 'input', { role: 'slider' }),
  ];

  it('names collapsed sections and popup controls and counts form controls, omitting empty lines', () => {
    expect(controlSummary(page())).toBe(
      'Collapsed sections: [1] Price, [3] Sort by\nControls: 2 checkboxes (1 checked), 1 radio button (0 selected), 1 select, 1 slider\n',
    );
    expect(controlSummary([element(0, 'a', {}, 'Home')])).toBe('');
  });

  it('caps the collapsed sections it names', () => {
    const many = Array.from({ length: 20 }, (_, i) => element(i, 'button', { 'aria-expanded': 'false' }, `Section ${i}`));
    const [line] = controlSummary(many).split('\n');
    expect(line.match(/\[\d+\]/g)).toHaveLength(15);
    expect(line).toMatch(/and 5 more$/);
  });

  it('is shown just before the element list', async () => {
    const root = new DOMElementNode({ tagName: 'body', xpath: '', attributes: {}, children: [], isVisible: true });
    const nodes = page();
    for (const node of nodes) {
      node.parent = root;
      root.children.push(node);
    }
    const browserState = {
      elementTree: root,
      selectorMap: new Map(nodes.map(node => [node.highlightIndex!, node])),
      tabId: 7,
      url: 'https://example.com/',
      title: 'Example',
      screenshot: null,
      scrollY: 0,
      scrollHeight: 800,
      visualViewportHeight: 800,
      tabs: [{ id: 7, url: 'https://example.com/', title: 'Example' }],
    };
    const context = {
      browserContext: { getCachedState: vi.fn().mockResolvedValue(browserState) },
      options: { useVision: false, includeAttributes: null, logDOMSnapshot: false },
      actionResults: [],
      messageManager: { getWorkingMemory: vi.fn().mockReturnValue('') },
    } as unknown as AgentContext;

    const content = String((await new BrowserStatePrompt().getUserMessage(context)).content);

    expect(content).toMatch(/Collapsed sections: \[1\] Price, \[3\] Sort by\nControls: [^\n]+\n\[0\]<input/);
  });
});

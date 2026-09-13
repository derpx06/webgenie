import { describe, expect, it, vi } from 'vitest';
import { DOMElementNode } from '../../../../browser/dom/views';
import type { AgentContext } from '../../../types';
import { KeyboardHandler } from '../keyboard';
import { InteractionHandler } from '../interaction';

vi.mock('@extension/i18n', () => ({
  t: (key: string, substitutions?: string[]) => [key, ...(substitutions ?? [])].join(' '),
}));

const node = (index: number, attributes: Record<string, string> = {}) =>
  new DOMElementNode({ tagName: 'input', xpath: `/input[${index}]`, attributes, children: [], isVisible: true, highlightIndex: index });

function contextFor(page: Record<string, unknown>) {
  return { emitEvent: vi.fn(), browserContext: { getCurrentPage: vi.fn(async () => page) } } as unknown as AgentContext;
}

describe('send_keys', () => {
  it('focuses the element at index and presses the key the requested number of times', async () => {
    const slider = node(4, { role: 'slider' });
    const page = { getCurrentState: vi.fn(async () => ({ selectorMap: new Map([[4, slider]]) })), sendKeys: vi.fn() };

    const result = await new KeyboardHandler(contextFor(page)).handleSendKeys({ keys: 'ArrowRight', index: 4, repeat: 5 });

    expect(page.sendKeys).toHaveBeenCalledWith('ArrowRight', slider, 5);
    expect(result.extractedContent).toBe('act_sendKeys_ok ArrowRight x5 in [4]');
  });

  it('presses once in the focused element by default and caps repeats at 50', async () => {
    const page = { getCurrentState: vi.fn(), sendKeys: vi.fn() };
    const handler = new KeyboardHandler(contextFor(page));

    await handler.handleSendKeys({ keys: 'Enter' });
    await handler.handleSendKeys({ keys: 'PageDown', repeat: 500 });

    expect(page.sendKeys).toHaveBeenNthCalledWith(1, 'Enter', undefined, 1);
    expect(page.sendKeys).toHaveBeenNthCalledWith(2, 'PageDown', undefined, 50);
    expect(page.getCurrentState).not.toHaveBeenCalled();
  });

  it('reports an index that is not on the page without pressing anything', async () => {
    const page = { getCurrentState: vi.fn(async () => ({ selectorMap: new Map() })), sendKeys: vi.fn() };

    const result = await new KeyboardHandler(contextFor(page)).handleSendKeys({ keys: 'Enter', index: 2 });

    expect(result.error).toContain('act_errors_elementNotExist');
    expect(page.sendKeys).not.toHaveBeenCalled();
  });
});

describe('input_text submit', () => {
  const typed = { matched: true, secret: false, actualLength: 5, actual: 'hello' };

  it('presses Enter in the field after typing, and points at suggestions of an autocomplete field', async () => {
    const field = node(2, { role: 'combobox' });
    const page = {
      getCurrentState: vi.fn(async () => ({ selectorMap: new Map([[2, field]]) })),
      inputTextNode: vi.fn(async () => typed),
      sendKeys: vi.fn(),
    };

    const result = await new InteractionHandler(contextFor(page)).handleInputText({ index: 2, text: 'hello', submit: true });

    expect(page.sendKeys).toHaveBeenCalledWith('Enter', field);
    expect(page.inputTextNode.mock.invocationCallOrder[0]).toBeLessThan(page.sendKeys.mock.invocationCallOrder[0]);
    expect(result.extractedContent).toContain('You typed "hello" into [2] and pressed Enter');
    expect(result.extractedContent).toContain('This field offers suggestions');
  });

  it('only types without submit', async () => {
    const page = {
      getCurrentState: vi.fn(async () => ({ selectorMap: new Map([[2, node(2)]]) })),
      inputTextNode: vi.fn(async () => typed),
      sendKeys: vi.fn(),
    };

    const result = await new InteractionHandler(contextFor(page)).handleInputText({ index: 2, text: 'hello' });

    expect(page.sendKeys).not.toHaveBeenCalled();
    expect(result.extractedContent).not.toContain('Enter');
  });
});

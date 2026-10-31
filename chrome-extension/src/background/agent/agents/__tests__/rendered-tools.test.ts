import { describe, expect, it } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { renderToolsForPrompt, withRenderedTools } from '../base';
import type { ToolDefinition } from '../../actions/builder';

const tools = [
  { type: 'function', function: { name: 'click_element', description: 'Click', parameters: { type: 'object', properties: { index: { type: 'number', description: 'which' } } } } },
  { type: 'function', function: { name: 'done', description: 'Finish', parameters: { type: 'object', properties: { text: { type: 'string', description: 'answer' } } } } },
] as unknown as ToolDefinition[];

const textOf = (message: { content: unknown }) => String(message.content);

/**
 * In prompt-rendered mode the schemas used to be appended after the page state: about 2,800 tokens of the most stable
 * content in the packet, in the one position a prefix cache can never reach. Every provider caches a prefix.
 */
describe('tools rendered into the prompt', () => {
  it('puts the schemas at the end of the system message, ahead of anything that changes', () => {
    const messages = [new SystemMessage('You are a navigator.'), new HumanMessage('task'), new HumanMessage('page state, step 7')];
    const out = withRenderedTools(messages, tools);

    expect(out[0]).toBeInstanceOf(SystemMessage);
    expect(textOf(out[0])).toContain('You are a navigator.');
    expect(textOf(out[0])).toContain('"click_element"');
    expect(textOf(out[0])).toContain('Available tools, with JSON Schema for args');
    // The schemas are not repeated further down.
    expect(out.slice(1).map(textOf).join('\n')).not.toContain('"click_element"');
  });

  it('keeps the prefix byte-identical when only the page state changes', () => {
    const at = (state: string) => withRenderedTools([new SystemMessage('You are a navigator.'), new HumanMessage('task'), new HumanMessage(state)], tools);
    const first = at('page state, step 7');
    const second = at('a different page, step 8');

    // Everything before the volatile message is the same bytes, which is what a prompt cache matches.
    expect(textOf(first[0])).toBe(textOf(second[0]));
    expect(textOf(first[1])).toBe(textOf(second[1]));
    expect(textOf(first[2])).not.toBe(textOf(second[2]));
  });

  // The models on this path are the small and local ones, which follow a format instruction best when it is last.
  it('still ends with the reply format, as a short reminder', () => {
    const out = withRenderedTools([new SystemMessage('s'), new HumanMessage('state')], tools);
    const last = textOf(out[out.length - 1]);
    expect(last).toContain('Respond with ONLY a JSON object of this exact shape');
    expect(last).toContain('{"tool_calls":[{"name":"<tool name>","args":{...}}]}');
    expect(last.length).toBeLessThan(400); // the schemas did not come with it
  });

  it('adds a system message when the packet has none', () => {
    const out = withRenderedTools([new HumanMessage('state')], tools);
    expect(out[0]).toBeInstanceOf(SystemMessage);
    expect(textOf(out[0])).toContain('"done"');
    expect(textOf(out[1])).toBe('state');
  });

  it('leaves renderToolsForPrompt unchanged for anything that still calls it', () => {
    const whole = renderToolsForPrompt(tools);
    expect(whole.startsWith('Respond with ONLY a JSON object of this exact shape')).toBe(true);
    expect(whole).toContain('"click_element"');
  });
});

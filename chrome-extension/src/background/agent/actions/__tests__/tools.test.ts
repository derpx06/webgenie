import { describe, expect, it } from 'vitest';
import { ChatGoogle } from '@langchain/google-webauth';
import { ChatOpenAI } from '@langchain/openai';
import * as schemaModule from '../schemas';
import type { ActionSchema } from '../schemas';
import { buildToolDefinitions, buildToolValidators, NAVIGATOR_TOOL_FIELDS } from '../builder';

const actionSchemas = Object.values(schemaModule).filter(
  (value): value is ActionSchema => typeof value === 'object' && value !== null && 'name' in value && 'schema' in value,
);

const FORBIDDEN_KEYS = ['$ref', 'definitions', '$defs', 'anyOf', 'oneOf', 'allOf', 'default'];

function collectProblems(node: unknown, path: string, problems: string[]): string[] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectProblems(item, `${path}[${i}]`, problems));
    return problems;
  }
  if (!node || typeof node !== 'object') return problems;
  const record = node as Record<string, unknown>;
  for (const key of FORBIDDEN_KEYS) if (key in record) problems.push(`${path}: has ${key}`);
  if ('type' in record && typeof record.type !== 'string') problems.push(`${path}: type is not a single string`);
  const properties = (record.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, prop] of Object.entries(properties)) {
    if (typeof prop.type !== 'string') problems.push(`${path}.${name}: missing type`);
    if (typeof prop.description !== 'string' || !prop.description.trim()) problems.push(`${path}.${name}: missing description`);
    collectProblems(prop, `${path}.${name}`, problems);
  }
  if (record.items) collectProblems(record.items, `${path}[]`, problems);
  return problems;
}

describe('model-facing tool definitions', () => {
  const tools = buildToolDefinitions(actionSchemas, NAVIGATOR_TOOL_FIELDS);

  it('covers every action with unique, provider-valid names', () => {
    const names = tools.map(tool => tool.function.name);
    expect(names).toHaveLength(42);
    expect(names).toEqual(expect.arrayContaining(['handle_dialog', 'drag_element']));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/);
  });

  it('emits clean, fully described JSON Schema for every tool', () => {
    const problems = tools.flatMap(tool => collectProblems(tool.function.parameters, tool.function.name, []));
    expect(problems).toEqual([]);
  });

  it('requires memory and hides engine-only fields', () => {
    for (const tool of tools) {
      const parameters = tool.function.parameters as { properties: Record<string, unknown>; required?: string[] };
      expect(parameters.required).toContain('memory');
      for (const hidden of ['observationId', 'targetFingerprint', 'xpath', 'intent']) {
        expect(parameters.properties).not.toHaveProperty(hidden);
      }
    }
  });

  it('is byte-stable across builds, so the tool prefix stays cacheable', () => {
    expect(JSON.stringify(buildToolDefinitions(actionSchemas, NAVIGATOR_TOOL_FIELDS))).toBe(JSON.stringify(tools));
  });

  /**
   * The tool block is uploaded on every navigator call (17.2 a task in the r2-cand run) and was 15.6% of that
   * run's whole input bill, so a description that grows costs more than it reads. The ceilings are the measured
   * size after `reports/TOKEN_BUDGET.md` §5 plus ~5% headroom; raise one only with a measurement that earns it.
   * Raised once, deliberately: read_page, find_in_page and extract added ~2,400 characters (~600 tokens a call) and
   * removed the scroll loop that cost 710 wasted steps across 247 reviewed tasks, so the block buys back far more
   * than it costs. Raised again for fill_form (+1,161 characters, ~290 tokens a call), which turns a form of N fields
   * from N steps carrying N element lists into one: at 14,454 input tokens a step it pays for itself on the first form.
   * Capability outranks the budget; the budget still refuses growth that buys nothing.
   */
  it('stays inside its character budget, which is what the model pays for', () => {
    const defaults = new Set([
      'done', 'ask_human', 'search_web', 'go_to_url', 'go_back', 'go_forward', 'wait', 'wait_for',
      'click_element', 'hover_element', 'right_click_element', 'input_text', 'fill_form', 'upload_file', 'drag_element',
      'handle_dialog', 'select_dropdown_option', 'switch_tab', 'open_tab', 'close_tab',
      'get_complete_page_content', 'read_page', 'find_in_page', 'extract',
      'save_findings', 'notes', 'todo_list', 'assert', 'scroll', 'scroll_to_text', 'view_screenshot', 'send_keys',
    ]);
    const defaultBlock = tools.filter(tool => defaults.has(tool.function.name));
    expect(defaultBlock).toHaveLength(defaults.size);
    expect(JSON.stringify(defaultBlock).length).toBeLessThan(21_200);
    expect(JSON.stringify(tools).length).toBeLessThan(28_100);
    // No description carries a worked example or a retention detail no call can act on.
    for (const tool of tools) expect(tool.function.description.length).toBeLessThan(260);
  });

  it('binds to the Google and OpenAI LangChain adapters without schema errors', () => {
    expect(() => new ChatGoogle({ apiKey: 'test-key', model: 'gemini-2.5-flash' }).bindTools(tools, { tool_choice: 'any' })).not.toThrow();
    expect(() => new ChatOpenAI({ apiKey: 'test-key', model: 'gpt-4.1' }).bindTools(tools, { tool_choice: 'any' })).not.toThrow();
  });

  it('validates arguments with the internal schemas and names the wrong field', () => {
    const validators = buildToolValidators(actionSchemas, NAVIGATOR_TOOL_FIELDS);
    expect(validators.click_element.safeParse({ index: 3, memory: 'clicking submit' }).success).toBe(true);

    const wrongName = validators.click_element.safeParse({ element_index: 3, memory: 'clicking submit' });
    expect(wrongName.success).toBe(false);
    expect(wrongName.error?.issues.map(issue => issue.path.join('.'))).toContain('index');

    const doneWithResult = validators.done.safeParse({ result: 'Example Domain', success: true, memory: 'done' });
    expect(doneWithResult.success).toBe(false);
    expect(doneWithResult.error?.issues.map(issue => issue.path.join('.'))).toContain('text');
  });
});

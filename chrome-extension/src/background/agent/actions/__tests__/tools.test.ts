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
    expect(names).toHaveLength(33);
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

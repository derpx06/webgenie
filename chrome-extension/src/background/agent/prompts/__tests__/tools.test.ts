import { describe, expect, it } from 'vitest';
import * as schemaModule from '../../actions/schemas';
import { forTools } from '../base';
import { NavigatorPrompt } from '../navigator';
import { PlannerPrompt } from '../planner';
import { plannerSystemPromptTemplate } from '../templates/planner';

const allTools = new Set(
  Object.values(schemaModule).flatMap(value =>
    typeof value === 'object' && value !== null && 'schema' in value && 'name' in value ? [String(value.name)] : [],
  ),
);
const without = (...names: string[]) => new Set([...allTools].filter(name => !names.includes(name)));
const prompts = (tools: ReadonlySet<string>) => [
  String(new PlannerPrompt(tools).getSystemMessage().content),
  String(new NavigatorPrompt(10, tools).getSystemMessage().content),
];

describe('prompts for the registered tools', () => {
  it('drops sentences naming a missing tool and keeps the rest of the line', () => {
    const text = '- Use alpha.\n- Call search_web first. Then read.\n7. Use search_web to search. Never open chrome:// URLs.\n[[without search_web]] Search is off.';
    expect(forTools(text, new Set(['done']))).toBe('- Use alpha.\n- Then read.\n7. Never open chrome:// URLs.\nSearch is off.');
    expect(forTools('- Call search_web.\nnext', new Set(['done']))).toBe('next');
    expect(forTools(text, new Set(['search_web']))).toBe(
      '- Use alpha.\n- Call search_web first. Then read.\n7. Use search_web to search. Never open chrome:// URLs.',
    );
  });

  it('never offers web search when it is not registered, and says it is unavailable', () => {
    const [planner, navigator] = prompts(without('search_web'));
    for (const prompt of [planner, navigator]) {
      expect(prompt).not.toContain('search_web');
      expect(prompt).not.toContain('[[');
      expect(prompt).toContain('Web search is not available');
    }
    expect(navigator).toContain('6. Web search is not available');
    expect(navigator).toContain('Never open chrome:// URLs.');
  });

  it('keeps the prompts whole when every tool is registered, and adds vision rules only with view_screenshot', () => {
    for (const prompt of prompts(allTools)) {
      expect(prompt).toContain('search_web');
      expect(prompt).not.toContain('Web search is not available');
      expect(prompt).not.toContain('[[');
      expect(prompt).toContain('# Seeing the page');
    }
    for (const prompt of prompts(without('view_screenshot'))) expect(prompt).not.toContain('view_screenshot');
    expect(prompts(without('view_screenshot'))[0]).toBe(plannerSystemPromptTemplate.replace(/ \[\[without search_web\]\][^.]*\./, ''));
  });
});

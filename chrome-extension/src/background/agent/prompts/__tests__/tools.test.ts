import { describe, expect, it } from 'vitest';
import * as schemaModule from '../../actions/schemas';
import { forTools } from '../base';
import { NavigatorPrompt } from '../navigator';
import { PlannerPrompt } from '../planner';
import { askRules } from '../templates/common';
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
    expect(navigator).toContain('7. Web search is not available');
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
    expect(prompts(without('view_screenshot'))[0]).toBe(
      plannerSystemPromptTemplate.replace('{{ask_planner}}', askRules.balanced.planner).replace(/ \[\[without search_web\]\][^.]*\./, ''),
    );
  });

  // The setting changes only the choice rules: a person who wants fewer questions still has every order, payment and account
  // stopped by the system, and a CAPTCHA, a login and a value only they have still go to them.
  describe('how often it asks', () => {
    const text = (level: 'more' | 'balanced' | 'less') => ({
      navigator: String(new NavigatorPrompt(10, allTools, level).getSystemMessage().content),
      planner: String(new PlannerPrompt(allTools, level).getSystemMessage().content),
    });

    it('fills every placeholder at every level', () => {
      for (const level of ['more', 'balanced', 'less'] as const) {
        const { navigator, planner } = text(level);
        for (const prompt of [navigator, planner]) expect(prompt).not.toMatch(/\{\{ask_/);
      }
    });

    it('asks about differing matches at "more", decides and reports at "balanced", and never asks at "less"', () => {
      expect(text('more').navigator).toContain('differ in a way the task does not settle (price, size, material, date), ask the user.');
      expect(text('more').planner).toContain('which of several differing items): choose ASK_HUMAN');
      expect(text('balanced').navigator).toContain('say in your answer which you chose and what the other was; ask only when a wrong pick would be costly');
      expect(text('balanced').planner).toContain('let the navigator choose by the task\'s words and report the choice');
      expect(text('less').navigator).toContain('never ask about it');
      expect(text('less').planner).toContain('Never ASK_HUMAN for which of several matching items');
    });

    it('keeps what must always be asked, at every level', () => {
      for (const level of ['more', 'balanced', 'less'] as const) {
        const { navigator, planner } = text(level);
        expect(navigator).toContain('Get past a login, 2FA code, captcha');
        expect(navigator).toContain('Get information only the user has');
        expect(navigator).toContain('You do not place orders, make payments, open accounts');
        expect(planner).toContain('(a phone number, an email, an address');
        expect(planner).toContain('verification challenge');
      }
    });
  });
});

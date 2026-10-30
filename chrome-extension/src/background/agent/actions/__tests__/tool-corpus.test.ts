import { describe, expect, it } from 'vitest';
import { jsonrepair } from 'jsonrepair';
import * as schemaModule from '../schemas';
import { type ActionSchema } from '../schemas';
import { buildToolValidators, NAVIGATOR_TOOL_FIELDS } from '../builder';
import { upgradeLegacyAction } from '../../agents/navigator/replay';
import { schemaFields } from '@src/background/browser/dom/read-page';
import { unfence } from '../handlers/content';
import corpus from '../../../../../e2e/corpus/tool-calls.json';

/**
 * Every argument in tools.test.ts was written by a human. These were written by the models, pulled
 * out of 2,102 saved trace files by `node e2e/corpus/harvest.mjs`. That is the difference that let
 * eleven malformed `extract` schemas reach production: nobody imagined a CSS selector carrying \'
 * inside a JSON string, and the models produced it 136 times.
 *
 * Re-harvest after a run lands. Shapes here are a ratchet, not a wishlist.
 */
const actionSchemas = Object.values(schemaModule).filter(
  (value): value is ActionSchema => typeof value === 'object' && value !== null && 'name' in value && 'schema' in value,
);
// Two validator sets, because there are two callers. The navigator's LLM path requires `memory`
// (and `commits` on the commit-deciding tools); the replay path dispatches a saved action straight
// to its handler after `upgradeLegacyAction`, with no Zod pass, so a legacy shape is held only to
// the tool's own schema. Checking legacy shapes against the stricter set would pin a failure that
// cannot happen.
const validators = buildToolValidators(actionSchemas, NAVIGATOR_TOOL_FIELDS);
const baseValidators = buildToolValidators(actionSchemas);
const LEGACY_NAMES = new Set([
  'scroll_to_top', 'scroll_to_bottom', 'next_page', 'previous_page', 'scroll_to_percent',
  'cache_content', 'search_google', 'get_dropdown_options', 'wait', 'hover_element',
  'right_click_element', 'drag_element', 'go_forward', 'open_tab', 'close_tab',
  'scroll_to_text', 'get_complete_page_content',
]);

/** Tools that are not navigator actions: the planner's own tool, the two internal model calls. */
const NOT_ACTIONS = new Set(['plan', 'intent_check', 'extracted']);

describe('argument shapes real models produced', () => {
  it('has a corpus to check against', () => {
    expect(corpus.calls.length).toBeGreaterThan(100);
    expect(corpus.malformedExtractSchemas.length).toBeGreaterThan(0);
  });

  it('still accepts every shape it accepted before', () => {
    const broken: string[] = [];
    for (const row of corpus.calls) {
      if (row.refused || NOT_ACTIONS.has(row.name)) continue;
      const upgraded = upgradeLegacyAction({ [row.name]: row.args });
      if (!upgraded) continue; // the tool was deliberately removed, and replay maps it to nothing
      const [name] = Object.keys(upgraded);
      const validator = LEGACY_NAMES.has(row.name) ? baseValidators[name] : validators[name];
      if (!validator) {
        broken.push(`${row.name} -> ${name}: no such tool`);
        continue;
      }
      const parsed = validator.safeParse(upgraded[name]);
      if (!parsed.success) broken.push(`${row.name} -> ${name}: ${JSON.stringify(row.args).slice(0, 90)}`);
    }
    expect(broken).toEqual([]);
  });

  // The regression that killed runs. `extract` threw an ActionResult error on a schema JSON.parse
  // refused; an error ends the batch and charges the failure budget, so three of these ended a task.
  it('repairs every malformed extract schema the models sent', () => {
    const unrepairable: string[] = [];
    for (const row of corpus.malformedExtractSchemas) {
      let schema: Record<string, unknown> | null = null;
      try {
        schema = JSON.parse(jsonrepair(unfence(row.schema))) as Record<string, unknown>;
      } catch {
        schema = null;
      }
      if (!schema) {
        unrepairable.push(`unrepairable (${row.reason}): ${row.schema.slice(0, 80)}`);
        continue;
      }
      // Repair is only worth it if the repaired schema still names the fields the model asked for.
      const { fields } = schemaFields(schema);
      if (fields.length === 0) unrepairable.push(`repaired but fieldless: ${row.schema.slice(0, 80)}`);
    }
    expect(unrepairable).toEqual([]);
  });

  it('knows the three ways models break a schema, so a repair change cannot silently narrow', () => {
    const reasons = corpus.malformedExtractSchemas.map(row => row.reason);
    expect(reasons.some(r => /Bad escaped character/.test(r))).toBe(true); // \' from a CSS selector
    expect(reasons.some(r => /Expected property name/.test(r))).toBe(true); // single-quoted object
    expect(reasons.some(r => /Unexpected token/.test(r))).toBe(true);
  });
});

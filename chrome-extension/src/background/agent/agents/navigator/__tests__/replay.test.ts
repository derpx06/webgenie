import { describe, expect, it } from 'vitest';
import { upgradeLegacyAction } from '../replay';
import { buildToolValidators } from '../../../actions/builder';
import * as schemaModule from '../../../actions/schemas';
import type { ActionSchema } from '../../../actions/schemas';

const validators = buildToolValidators(
  Object.values(schemaModule).filter((value): value is ActionSchema => typeof value === 'object' && value !== null && 'schema' in value),
);

describe('replaying saved histories', () => {
  it('turns removed and renamed tools into the calls that do the same now', () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ previous_page: { index: null } }, { scroll: { direction: 'up', pages: 1 } }],
      [{ next_page: {} }, { scroll: { direction: 'down', pages: 1 } }],
      [{ scroll_to_top: {} }, { scroll: { direction: 'top' } }],
      [{ scroll_to_bottom: { index: 4 } }, { scroll: { direction: 'bottom', index: 4 } }],
      [{ scroll_to_percent: { yPercent: 80 } }, { scroll: { direction: 'bottom' } }],
      [{ cache_content: { content: 'Book A: $10' } }, { save_findings: { text: 'Book A: $10' } }],
      [{ search_google: { query: 'weather' } }, { search_web: { query: 'weather', engine: 'google' } }],
    ];
    for (const [saved, now] of cases) {
      const upgraded = upgradeLegacyAction(saved)!;
      expect(upgraded).toEqual(now);
      const [name] = Object.keys(upgraded);
      expect(validators[name].safeParse(upgraded[name]).success).toBe(true);
    }
  });

  it('drops the removed read-only dropdown listing and leaves current tools alone', () => {
    const click = { click_element: { index: 1 } };
    expect(upgradeLegacyAction({ get_dropdown_options: { index: 2 } })).toBeNull();
    expect(upgradeLegacyAction(click)).toBe(click);
    expect(upgradeLegacyAction(null)).toBeNull();
  });
});

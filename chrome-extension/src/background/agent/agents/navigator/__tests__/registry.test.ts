import { describe, it, expect } from 'vitest';
import { NavigatorActionRegistry } from '../registry';
import { Action } from '../../../actions/builder';
import { chromeControlActionSchema } from '../../../actions/schemas';
import { ActionResult } from '../../../types';
import type { z } from 'zod';

describe('NavigatorActionRegistry DRAFT & Tool Availability', () => {
  it('keeps chrome_control subsystems available at all times and refines descriptions on failure', () => {
    const mockAction = new Action(
      async () => new ActionResult(),
      chromeControlActionSchema
    );
    const registry = new NavigatorActionRegistry([mockAction]);

    // 1. Verify schema has all subsystems on a public page
    const publicSchema = registry.setupModelOutputSchema('https://google.com') as z.ZodObject<any>;
    const publicActionSchema = publicSchema.shape.action.element.shape.chrome_control.unwrap().unwrap();
    const publicSubsystems = publicActionSchema.shape.subsystem._def.values;
    expect(publicSubsystems).toEqual(['bookmarks', 'readingList', 'history', 'downloads']);

    // 2. Refine description on failure (DRAFT)
    registry.refineActionDescription('chrome_control', 'Invalid query', { subsystem: 'history' });

    // 3. Verify refined description contains the warning details
    const refinedSchema = registry.setupModelOutputSchema('https://google.com') as z.ZodObject<any>;
    const refinedDescription = refinedSchema.shape.action.element.shape.chrome_control.description;

    expect(refinedDescription).toContain('[DRAFT WARNING]');
    expect(refinedDescription).toContain('Invalid query');
    expect(refinedDescription).toContain('subsystem');
  });
});

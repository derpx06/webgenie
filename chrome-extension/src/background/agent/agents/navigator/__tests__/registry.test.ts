import { describe, it, expect } from 'vitest';
import { NavigatorActionRegistry } from '../registry';
import { Action } from '../../../actions/builder';
import { manageHistoryActionSchema } from '../../../actions/schemas';
import { ActionResult } from '../../../types';
import type { z } from 'zod';

describe('NavigatorActionRegistry DRAFT & Tool Availability', () => {
  it('keeps manage_history available at all times and refines descriptions on failure', () => {
    const mockAction = new Action(
      async () => new ActionResult(),
      manageHistoryActionSchema
    );
    const registry = new NavigatorActionRegistry([mockAction]);

    // 1. Verify schema has history actions on a public page
    const publicSchema = registry.setupModelOutputSchema('https://google.com') as z.ZodObject<any>;
    const publicActionSchema = publicSchema.shape.action.element.shape.manage_history.unwrap().unwrap() as any;
    const publicActions = publicActionSchema.shape.action._def.values;
    expect(publicActions).toEqual(['getRecent', 'getFrequentDomains']);

    // 2. Refine description on failure (DRAFT)
    registry.refineActionDescription('manage_history', 'Invalid query', {});

    // 3. Verify refined description contains the warning details
    const refinedSchema = registry.setupModelOutputSchema('https://google.com') as z.ZodObject<any>;
    const refinedDescription = refinedSchema.shape.action.element.shape.manage_history.description;

    expect(refinedDescription).toContain('[DRAFT WARNING]');
    expect(refinedDescription).toContain('Invalid query');
  });
});

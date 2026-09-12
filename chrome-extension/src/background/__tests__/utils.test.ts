import { describe, expect, it } from 'vitest';
import { optimizeSchemaConstraints } from '../utils';

describe('optimizeSchemaConstraints', () => {
  it('inlines local $ref definitions and drops bound keywords', () => {
    const optimized = optimizeSchemaConstraints({
      type: 'object',
      properties: { name: { $ref: '#/definitions/Name' } },
      definitions: { Name: { type: 'string', minLength: 1 } },
    });

    expect(optimized).toEqual({ type: 'object', properties: { name: { type: 'string' } } });
  });

  it('removes provider-incompatible JSON Schema type arrays', () => {
    const optimized = optimizeSchemaConstraints({
      type: 'object',
      properties: {
        optionalText: { type: ['string', 'null'] },
        mixedValue: { type: ['string', 'number', 'null'] },
      },
    }) as { properties: Record<string, Record<string, unknown>> };

    expect(optimized.properties.optionalText).toEqual({ type: 'string', nullable: true });
    expect(optimized.properties.mixedValue).toEqual({ nullable: true });
  });
});

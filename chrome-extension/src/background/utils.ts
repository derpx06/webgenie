import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type JsonSchemaConverter = (
  schema: unknown,
  options?: Record<string, unknown> | string,
) => Record<string, unknown>;
const toJsonSchema = zodToJsonSchema as JsonSchemaConverter;

/**
 * Some providers accept only a subset of JSON Schema for structured output.
 * Runtime Zod validation still enforces stripped constraints after the model
 * returns, so this function intentionally optimizes only the wire schema.
 */
function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveLocalJsonRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let current = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[decodeJsonPointerSegment(rawSegment)];
  }
  return current;
}

/**
 * Structured-output providers do not all support the same JSON Schema dialect.
 * In addition to removing bounds/format constraints, inline local JSON Schema
 * refs produced by zod-to-json-schema and normalize nullable type arrays.
 * Runtime Zod parsing remains the source of truth after the model returns.
 */
export function optimizeSchemaConstraints(schema: unknown): unknown {
  const root = schema;
  const visiting = new Set<string>();

  const optimize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(optimize);
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    const source = value as Record<string, unknown>;
    if (typeof source.$ref === 'string') {
      if (visiting.has(source.$ref)) {
        return {};
      }
      const resolved = resolveLocalJsonRef(root, source.$ref);
      if (resolved) {
        visiting.add(source.$ref);
        const optimizedResolved = optimize(resolved);
        visiting.delete(source.$ref);
        const siblings = { ...source };
        delete siblings.$ref;
        return optimize({ ...(optimizedResolved as Record<string, unknown>), ...siblings });
      }
    }

    const optimized = { ...source };
    if (Array.isArray(optimized.type)) {
      const types = optimized.type.filter((type): type is string => typeof type === 'string');
      const nonNullTypes = types.filter(type => type !== 'null');
      if (types.includes('null')) {
        optimized.nullable = true;
      }
      if (nonNullTypes.length === 1) {
        optimized.type = nonNullTypes[0];
      } else {
        delete optimized.type;
      }
    }

    for (const key of [
      '$schema',
      '$ref',
      'definitions',
      '$defs',
      'pattern',
      'format',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'minimum',
      'maximum',
    ]) {
      delete optimized[key];
    }

    for (const [key, child] of Object.entries(optimized)) {
      optimized[key] = optimize(child);
    }
    return optimized;
  };

  return optimize(schema);
}

/** JSON Schema for a tool's parameters: no $ref, no type arrays, no bounds/format keywords. */
export function zodToToolParameters(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = toJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
  return optimizeSchemaConstraints(jsonSchema) as Record<string, unknown>;
}


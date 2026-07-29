import type { z } from 'zod';
import { jsonrepair } from 'jsonrepair';
import { createLogger } from '@src/background/log';
import { zodToJsonSchema } from 'zod-to-json-schema';

const logger = createLogger('Utils');
type JsonSchemaConverter = (
  schema: unknown,
  options?: Record<string, unknown> | string,
) => Record<string, unknown>;
const toJsonSchema = zodToJsonSchema as JsonSchemaConverter;

export function getCurrentTimestampStr(): string {
  /**
   * Get the current timestamp as a string in the format yyyy/MM/dd HH:mm:ss
   * using local timezone.
   *
   * @returns Formatted datetime string in local time
   */
  return new Date()
    .toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(',', '');
}

/**
 * Fix malformed action string using the jsonrepair library
 * Only called when initial JSON.parse fails
 */
export function repairJsonString(actionString: string): string {
  try {
    // Use jsonrepair to fix malformed JSON
    const repairedJson = jsonrepair(actionString.trim());
    logger.info('Successfully repaired JSON string', { original: actionString, repaired: repairedJson });
    return repairedJson;
  } catch (error) {
    // If jsonrepair fails, log the error and return the original string
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warning('jsonrepair failed to fix JSON string', { original: actionString, error: errorMessage });
    return actionString.trim();
  }
}

// Helper function to capitalize first letter and convert to proper title case
function capitalizeFirstLetter(str: string): string {
  // Handle snake_case: convert to Title Case
  if (str.includes('_')) {
    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // Handle camelCase: add spaces before capital letters and capitalize
  const withSpaces = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

// Post-process callback to add titles to properties
function addTitlesToProperties(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return jsonSchema;
  }

  // If this object has properties, add titles to them
  if (jsonSchema.properties && typeof jsonSchema.properties === 'object') {
    for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties)) {
      if (propertySchema && typeof propertySchema === 'object') {
        const schema = propertySchema as Record<string, unknown>;
        // Only add title if it doesn't already exist
        if (!schema.title) {
          schema.title = capitalizeFirstLetter(propertyName);
        }
        // Recursively process nested properties
        addTitlesToProperties(schema);
      }
    }
  }

  // Handle array items
  if (jsonSchema.items) {
    addTitlesToProperties(jsonSchema.items as Record<string, unknown>);
  }

  // Handle oneOf, anyOf, allOf
  if (Array.isArray(jsonSchema.oneOf)) {
    for (const schema of jsonSchema.oneOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }
  if (Array.isArray(jsonSchema.anyOf)) {
    for (const schema of jsonSchema.anyOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }
  if (Array.isArray(jsonSchema.allOf)) {
    for (const schema of jsonSchema.allOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }

  return jsonSchema;
}

export function convertZodToJsonSchema(zodSchema: z.ZodType, name: string, addTitle = false): Record<string, unknown> {
  const jsonSchema = toJsonSchema(zodSchema, {
    name: name,
    nameStrategy: 'title',
    target: 'openApi3',
    allowedAdditionalProperties: undefined,
    rejectedAdditionalProperties: undefined,
    postProcess: addTitle
      ? (schema: unknown) => {
          // Titles of the properties of the schema will make some models follow the schema better, especially for Haiku
          if (schema && typeof schema === 'object') {
            return addTitlesToProperties(schema as Record<string, unknown>);
          }
          return schema;
        }
      : undefined,
  });

  // logger.info('Navigator json schema', JSON.stringify(jsonSchema, null, 2));
  return jsonSchema;
}

export function isProviderSchemaPayloadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes('generation_config.response_schema') ||
    message.includes('response_schema') ||
    message.includes('json_schema') ||
    message.includes('specified schema') ||
    message.includes('schema produces a constraint')
  ) && (
    message.includes('Invalid JSON payload') ||
    message.includes('Unknown name') ||
    message.includes('Cannot find field') ||
    message.includes('Proto field is not repeating') ||
    message.includes('too many states') ||
    message.includes('specified schema produces a constraint') ||
    message.includes('not supported')
  );
}

export function shouldBypassStructuredOutput(
  provider: string | undefined,
  chatModelLibrary: string | undefined,
  modelName?: string,
): boolean {
  const normalizedProvider = (provider ?? '').toLowerCase();
  const normalizedLibrary = (chatModelLibrary ?? '').toLowerCase();
  const normalizedModel = (modelName ?? '').toLowerCase();

  const providerSupportsStructuredOutput =
    normalizedProvider.includes('openai') ||
    normalizedProvider.includes('azure') ||
    normalizedProvider.includes('gemini') ||
    normalizedProvider.includes('google') ||
    normalizedProvider.includes('vertex') ||
    normalizedLibrary.includes('chatopenai') ||
    normalizedLibrary.includes('azurechatopenai') ||
    normalizedLibrary.includes('chatgooglegenerativeai') ||
    normalizedLibrary.includes('chatvertexai') ||
    normalizedModel.includes('gpt-') ||
    normalizedModel.includes('gemini');

  return !providerSupportsStructuredOutput;
}

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

export function buildProviderSafeJsonSchema(
  zodSchema: z.ZodType,
  name: string,
  addTitle = false,
): Record<string, unknown> {
  return optimizeSchemaConstraints(convertZodToJsonSchema(zodSchema, name, addTitle)) as Record<string, unknown>;
}

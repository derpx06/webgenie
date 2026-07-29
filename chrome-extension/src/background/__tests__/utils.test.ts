import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildProviderSafeJsonSchema,
  convertZodToJsonSchema,
  isProviderSchemaPayloadError,
  optimizeSchemaConstraints,
  shouldBypassStructuredOutput,
} from '../utils';
import { Action, buildDynamicActionSchema } from '../agent/actions/builder';
import { plannerOutputSchema } from '../agent/agents/planner';
import {
  askHumanActionSchema,
  cacheContentActionSchema,
  clickElementActionSchema,
  closeTabActionSchema,
  doneActionSchema,
  getCompletePageContentActionSchema,
  getDropdownOptionsActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  hoverElementActionSchema,
  inputTextActionSchema,
  manageBookmarksActionSchema,
  manageDownloadsActionSchema,
  manageExtensionsActionSchema,
  manageHistoryActionSchema,
  managePrivacyActionSchema,
  manageReadingListActionSchema,
  manageSessionsActionSchema,
  manageSystemActionSchema,
  manageTabsActionSchema,
  manageWindowsActionSchema,
  nextPageActionSchema,
  openTabActionSchema,
  previousPageActionSchema,
  rightClickElementActionSchema,
  scrollToBottomActionSchema,
  scrollToPercentActionSchema,
  scrollToTextActionSchema,
  scrollToTopActionSchema,
  searchGoogleActionSchema,
  searchWebActionSchema,
  selectDropdownOptionActionSchema,
  sendKeysActionSchema,
  switchTabActionSchema,
  waitActionSchema,
} from '../agent/actions/schemas';
import { ActionResult, agentBrainSchema } from '../agent/types';

function collectRefs(value: unknown, refs: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;
  const record = value as Record<string, unknown>;
  if ('$ref' in record) refs.push(record.$ref);
  for (const child of Object.values(record)) collectRefs(child, refs);
  return refs;
}

function collectArrayTypes(value: unknown, arrayTypes: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectArrayTypes(item, arrayTypes);
    return arrayTypes;
  }
  if (!value || typeof value !== 'object') return arrayTypes;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.type)) arrayTypes.push(record.type);
  for (const child of Object.values(record)) collectArrayTypes(child, arrayTypes);
  return arrayTypes;
}

describe('optimizeSchemaConstraints', () => {
  it('detects provider-side response schema payload errors', () => {
    const error = new Error(
      'Invalid JSON payload received. Unknown name "$ref" at generation_config.response_schema.properties[1].value'
    );
    const tooManyStates = new Error(
      'The specified schema produces a constraint that has too many states for serving.'
    );

    expect(isProviderSchemaPayloadError(error)).toBe(true);
    expect(isProviderSchemaPayloadError(tooManyStates)).toBe(true);
    expect(isProviderSchemaPayloadError(new Error('rate limit exceeded'))).toBe(false);
  });

  it('allows provider response schemas only for known structured-output model families', () => {
    expect(shouldBypassStructuredOutput('gemini', 'Unknown', 'gemini-2.5-flash')).toBe(false);
    expect(shouldBypassStructuredOutput('vertex_ai', 'Unknown', 'gemini-2.5-pro')).toBe(false);
    expect(shouldBypassStructuredOutput(undefined, 'ChatGoogleGenerativeAI', 'gemini-2.5-flash')).toBe(false);
    expect(shouldBypassStructuredOutput(undefined, 'ChatVertexAI', 'gemini-2.5-pro')).toBe(false);
    expect(shouldBypassStructuredOutput(undefined, 'ChatOpenAI', 'gpt-4.1')).toBe(false);
    expect(shouldBypassStructuredOutput('anthropic', 'ChatAnthropic', 'claude-sonnet-4-5')).toBe(true);
  });

  it('builds provider-safe wire schemas without JSON Schema refs', () => {
    const schema = z.object({
      action: z.array(z.object({
        click_element: z.object({
          index: z.number(),
          targetFingerprint: z.any().optional(),
        }).optional(),
        input_text: z.object({
          index: z.number(),
          text: z.string(),
          targetFingerprint: z.any().optional(),
        }).optional(),
      })),
    });

    const optimized = buildProviderSafeJsonSchema(schema, 'NavigatorLikeOutput', true);

    expect(collectRefs(optimized)).toEqual([]);
  });

  it('removes provider-incompatible JSON Schema type arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        optionalText: { type: ['string', 'null'] },
        mixedValue: { type: ['string', 'number', 'null'] },
      },
    };

    const optimized = optimizeSchemaConstraints(schema) as {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(collectArrayTypes(optimized)).toEqual([]);
    expect(optimized.properties.optionalText.type).toBe('string');
    expect(optimized.properties.optionalText.nullable).toBe(true);
    expect(optimized.properties.mixedValue.type).toBeUndefined();
    expect(optimized.properties.mixedValue.nullable).toBe(true);
  });

  it('removes refs and type arrays from the planner contract provider wire schema', () => {
    const optimized = buildProviderSafeJsonSchema(plannerOutputSchema, 'planner_output', true);

    expect(collectRefs(optimized)).toEqual([]);
    expect(collectArrayTypes(optimized)).toEqual([]);
  });

  it('removes refs and type arrays from the intent-classifier provider wire schema', () => {
    const intentSchema = z.object({
      intent: z.enum([
        'CONTINUE_TASK',
        'MODIFY_TASK',
        'NEW_TASK',
        'QUESTION',
        'REFERENCE_PREVIOUS_TASK',
      ]),
    });
    const optimized = buildProviderSafeJsonSchema(intentSchema, 'IntentClassifierOutput', true);

    expect(collectRefs(optimized)).toEqual([]);
    expect(collectArrayTypes(optimized)).toEqual([]);
  });

  it('removes refs from the full navigator dynamic action provider wire schema', () => {
    const handler = async () => new ActionResult();
    const actionSchemas = [
      doneActionSchema,
      askHumanActionSchema,
      searchWebActionSchema,
      searchGoogleActionSchema,
      goToUrlActionSchema,
      goBackActionSchema,
      waitActionSchema,
      clickElementActionSchema,
      hoverElementActionSchema,
      rightClickElementActionSchema,
      inputTextActionSchema,
      getDropdownOptionsActionSchema,
      selectDropdownOptionActionSchema,
      switchTabActionSchema,
      openTabActionSchema,
      closeTabActionSchema,
      cacheContentActionSchema,
      scrollToPercentActionSchema,
      scrollToTopActionSchema,
      scrollToBottomActionSchema,
      previousPageActionSchema,
      nextPageActionSchema,
      scrollToTextActionSchema,
      getCompletePageContentActionSchema,
      sendKeysActionSchema,
      manageBookmarksActionSchema,
      manageReadingListActionSchema,
      manageHistoryActionSchema,
      manageDownloadsActionSchema,
      manageTabsActionSchema,
      manageWindowsActionSchema,
      managePrivacyActionSchema,
      manageExtensionsActionSchema,
      manageSystemActionSchema,
      manageSessionsActionSchema,
    ];
    const actions = actionSchemas.map(schema => new Action(handler, schema));
    const navigatorSchema = z.object({
      current_state: agentBrainSchema,
      action: z.array(buildDynamicActionSchema(actions)),
    });

    const jsonSchema = convertZodToJsonSchema(navigatorSchema, 'NavigatorAgentOutput', true);
    const optimized = buildProviderSafeJsonSchema(navigatorSchema, 'NavigatorAgentOutput', true);

    expect(collectRefs(jsonSchema).length).toBeGreaterThan(0);
    expect(collectRefs(optimized)).toEqual([]);
    expect(collectArrayTypes(optimized)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { extractJsonFromModelOutput } from '../utils';

describe('extractJsonFromModelOutput', () => {
  it('extracts a JSON object even when the model adds surrounding text', () => {
    expect(extractJsonFromModelOutput('Here is the JSON: {"done":false,"web_task":true}')).toEqual({
      done: false,
      web_task: true,
    });
  });
});

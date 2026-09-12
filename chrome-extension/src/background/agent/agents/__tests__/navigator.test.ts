import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));

import { redactArgs } from '../navigator';

describe('redactArgs', () => {
  it('replaces typed text with its length and drops engine stamps', () => {
    expect(redactArgs('input_text', { index: 3, text: 'S3cret!', observationId: 'obs', targetFingerprint: {} })).toEqual({
      index: 3,
      text: '<7 characters>',
    });
    expect(redactArgs('handle_dialog', { accept: true, prompt_text: 'hi' })).toEqual({ accept: true, prompt_text: '<2 characters>' });
    expect(redactArgs('click_element', { index: 1 })).toEqual({ index: 1 });
  });
});

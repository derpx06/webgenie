import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));

import { offersToRetry, redactArgs } from '../navigator';

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

describe('offersToRetry', () => {
  it('finds questions that only offer another attempt', () => {
    expect(offersToRetry('Would you like me to search for a different location, or proceed without a location filter?')).toBe(true);
    expect(offersToRetry('I could not find it. Would you like me to try searching the web for the menu?')).toBe(true);
    expect(offersToRetry('Should I try again?')).toBe(true);
    expect(offersToRetry('Shall I keep trying?')).toBe(true);
  });

  it('leaves questions whose answer only the user has', () => {
    expect(offersToRetry('Which of the two flights do you want, 9:00 or 14:30?')).toBe(false);
    expect(offersToRetry('Should I search for flights on May 3 or May 4?')).toBe(false);
    expect(offersToRetry('Should I try the blue or the red one?')).toBe(false);
  });
});

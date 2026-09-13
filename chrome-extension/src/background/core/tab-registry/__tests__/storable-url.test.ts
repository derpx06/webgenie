import { describe, expect, it } from 'vitest';
import { storableUrl } from '../registry';

describe('storableUrl', () => {
  it('keeps the page but not what the address carried (a GET form password, a token)', () => {
    expect(storableUrl('https://www.selenium.dev/selenium/web/submitted-form.html?my-text=WebGenie&my-password=pw-123#top')).toBe(
      'https://www.selenium.dev/selenium/web/submitted-form.html',
    );
    expect(storableUrl('https://example.com/callback#access_token=abc')).toBe('https://example.com/callback');
    expect(storableUrl('https://example.com/plain')).toBe('https://example.com/plain');
    expect(storableUrl('')).toBe('');
  });
});

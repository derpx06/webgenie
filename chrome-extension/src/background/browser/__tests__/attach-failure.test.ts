import { describe, expect, it } from 'vitest';
import { explainAttachFailure } from '../util';

/**
 * Since Chrome 155 (stable 6 October 2026) a managed browser refuses chrome.debugger.attach outright when an
 * administrator has blocked hosts for the extension or restricted screenshots. No user setting changes that, so the
 * message has to say whose decision it is. These are the two strings Chrome documents.
 */
describe('explaining why the debugger would not attach', () => {
  it('says an administrator policy blocked it, and whose to change, for a blocked-hosts policy', () => {
    const message = explainAttachFailure('Host access is restricted by policy.');
    expect(message).toContain('administrator');
    expect(message).toContain('runtime_blocked_hosts');
    expect(message).not.toMatch(/devtools/i);
  });

  it('says the same for a screenshot restriction, which Chrome applies to every debugger session', () => {
    const message = explainAttachFailure('Screenshot capture is restricted by policy.');
    expect(message).toContain('administrator');
    expect(message).toContain('screen capture');
    expect(message).not.toMatch(/devtools may be open/i);
  });

  it('keeps the other-debugger advice for the case it is true of', () => {
    const message = explainAttachFailure('Another debugger is already attached to the tab with id: 12.');
    expect(message).toMatch(/DevTools or another extension/);
  });

  it('passes an unknown cause through rather than guessing one', () => {
    expect(explainAttachFailure('Target closed')).toBe('Cannot control this tab: Target closed');
  });
});

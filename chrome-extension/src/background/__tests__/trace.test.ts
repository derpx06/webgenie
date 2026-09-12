import { describe, expect, it } from 'vitest';
import { sanitize } from '../trace';

describe('trace sanitize', () => {
  it('redacts secret fields and token-shaped values but keeps token counts', () => {
    const out = sanitize({
      apiKey: 'plain-secret',
      usage: { inputTokens: 12, outputTokens: 3 },
      header: 'Bearer ya29.a0AfH6SMBx-secret_123',
      note: 'key ya29.abcDEF-123 inside text',
    }) as { apiKey: string; usage: { inputTokens: number; outputTokens: number }; header: string; note: string };

    expect(out.apiKey).toBe('[redacted]');
    expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(out.header).not.toContain('ya29.');
    expect(out.note).toBe('key [redacted] inside text');
  });

  it('flattens errors with their cause and truncates long strings', () => {
    const error = new Error('outer', { cause: new Error('inner') });
    const out = sanitize({ error, blob: 'x'.repeat(9_000) }) as { error: { stack: string }; blob: string };

    expect(out.error).toMatchObject({ name: 'Error', message: 'outer', cause: { message: 'inner' } });
    expect(out.error.stack).toContain('outer');
    expect(out.blob.length).toBeLessThan(8_100);
    expect(out.blob).toMatch(/…\[\+1000 chars\]$/);
  });

  it('bounds depth and breadth so cyclic or huge objects cannot blow up a record', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 10; i++) cursor = (cursor.next = {}) as Record<string, unknown>;
    expect(JSON.stringify(sanitize(deep))).toContain('[depth limit]');
    expect((sanitize(Array.from({ length: 200 }, (_, i) => i)) as unknown[]).length).toBe(50);
  });
});

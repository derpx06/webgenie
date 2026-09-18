import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({}));
vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { refuseExpression } from '../script';
import { serializeForModel } from '../../../../browser/page';

describe('eval_js refuses what it is not for', () => {
  it('refuses navigation, whichever way it is written', () => {
    for (const expression of [
      'location.href = "https://evil.test"',
      'window.location.replace("/checkout")',
      'document.location = "/x"',
      'window.open("https://evil.test")',
      'history.pushState({}, "", "/paid")',
    ]) {
      expect(refuseExpression(expression), expression).toMatch(/Not evaluated/);
    }
  });

  it('refuses writing credentials, page values and site storage', () => {
    expect(refuseExpression('document.querySelector("#password").value')).toContain('credentials');
    expect(refuseExpression('document.querySelector("#email").value = "a@b.test"')).toContain('writes to the page');
    expect(refuseExpression('localStorage.setItem("token", "x")')).toContain("site's storage");
    expect(refuseExpression('document.cookie = "session=1"')).toContain("site's storage");
  });

  it('refuses acting on the page and sending requests, and names the tool that does it', () => {
    expect(refuseExpression('document.querySelector("button").click()')).toContain('click_element');
    expect(refuseExpression('fetch("/api/rows").then(r => r.json())')).toContain('fetch_json');
    expect(refuseExpression('new Function("return 1")()')).toContain('code this check cannot see');
  });

  it('allows reading, including the shadow DOM and a canvas, and awaiting', () => {
    for (const expression of [
      'document.querySelector("my-widget").shadowRoot.querySelector(".total").textContent',
      '[...document.querySelectorAll("tr")].map(r => r.innerText)',
      'document.querySelector("canvas").toDataURL().length',
      'await customElements.whenDefined("my-widget")',
    ]) {
      expect(refuseExpression(expression), expression).toBe('');
    }
  });

  it('refuses an empty expression and a program', () => {
    expect(refuseExpression('   ')).toBe('eval_js needs an expression.');
    expect(refuseExpression(`x${'+1'.repeat(1200)}`)).toContain('not a program');
  });
});

describe('the value comes back readable and capped', () => {
  it('returns primitives as they are and names undefined', () => {
    expect(serializeForModel('Total: 42', 100)).toBe('Total: 42');
    expect(serializeForModel(7, 100)).toBe('7');
    expect(serializeForModel(undefined, 100)).toBe('(undefined)');
    expect(serializeForModel(null, 100)).toBe('null');
  });

  it('shapes objects, sets, maps and errors instead of dropping them', () => {
    expect(serializeForModel({ rows: [1, 2], ok: true }, 100)).toBe('{"rows":[1,2],"ok":true}');
    expect(serializeForModel(new Set(['a', 'b']), 100)).toBe('["a","b"]');
    expect(serializeForModel(new Map([['a', 1]]), 100)).toBe('{"a":1}');
    expect(serializeForModel(new Error('nope'), 100)).toBe('Error: nope');
    expect(serializeForModel(function total() {}, 100)).toBe('[function total]');
  });

  it('names a cycle instead of throwing, and stops at a depth', () => {
    const loop: Record<string, unknown> = { name: 'a' };
    loop.self = loop;
    expect(serializeForModel(loop, 200)).toBe('{"name":"a","self":"[circular]"}');
    let deep: unknown = 'bottom';
    for (let i = 0; i < 8; i++) deep = { next: deep };
    expect(serializeForModel(deep, 200)).toContain('[…]');
  });

  it('cuts a long value to the cap and says so, because an unbounded value is an unbounded prompt', () => {
    const out = serializeForModel('x'.repeat(5000), 200);
    expect(out).toHaveLength(200 + '…(cut at 200 characters)'.length);
    expect(out.endsWith('…(cut at 200 characters)')).toBe(true);
  });

  it('keeps only the first hundred items of a long list and counts the rest', () => {
    const out = serializeForModel(Array.from({ length: 250 }, (_, i) => i), 8000);
    expect(out).toContain('"…150 more"');
  });
});

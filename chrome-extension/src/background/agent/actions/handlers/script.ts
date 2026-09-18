import { ActionResult } from '@src/background/agent/types';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../../event/types';
import { BaseHandler } from './base';
import type { evalJsActionSchema } from '../schemas';
import { wrapUntrustedContent } from '../../messages/utils';
import { record } from '@src/background/trace';

const DEFAULT_CHARS = 2000;
const MIN_CHARS = 200;
const MAX_CHARS = 8000;
/** An expression longer than this is a program, and a program is not what this tool is for. */
const MAX_EXPRESSION = 2000;

/**
 * What an expression may not do, and which tool does it instead. eval_js exists to *read* what the accessibility tree
 * cannot reach; everything that changes the page has a tool whose guards (commit confirmation, secret placeholders,
 * the personal-data intent check, the firewall) an expression would walk straight past.
 */
const REFUSALS: Array<[RegExp, string]> = [
  [/\b(location\s*[.=]|location\s*\.\s*(href|assign|replace|reload)|window\s*\.\s*open|document\s*\.\s*location)/i, 'it navigates: use go_to_url, open_tab or click_element'],
  [/\bhistory\s*\.\s*(pushState|replaceState|go|back|forward)\b/i, 'it changes history: use go_back or go_forward'],
  [/\.\s*(click|submit|focus|blur|dispatchEvent)\s*\(/i, 'it acts on the page: use click_element, send_keys or the form tools'],
  [/(\.\s*value\s*=[^=]|\.\s*(innerHTML|outerHTML|textContent|innerText)\s*=[^=]|\bsetAttribute\s*\()/i, 'it writes to the page: use input_text, fill_form or select_dropdown_option'],
  [/\b(password|credentials?|autocomplete\s*=\s*["']?(current|new)-password)/i, 'it touches credentials: passwords are given through ask_human and never read or written here'],
  [/(document\s*\.\s*cookie|(local|session)Storage\s*\.\s*(setItem|removeItem|clear)|indexedDB\s*\.\s*deleteDatabase)/i, 'it writes to the site\'s storage, which no task needs'],
  [/\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource)/i, 'it sends a request: use fetch_json, which checks the address'],
  [/\b(eval\s*\(|new\s+Function|import\s*\(|importScripts|Worker\s*\()/i, 'it would run code this check cannot see'],
  [/\b(close\s*\(|print\s*\(|alert\s*\(|confirm\s*\(|prompt\s*\(|debugger\b)/i, 'it interrupts the browser instead of reading the page'],
];

/** Why this expression may not be evaluated, or empty when it may. */
export function refuseExpression(expression: string): string {
  const text = expression.trim();
  if (!text) return 'eval_js needs an expression.';
  if (text.length > MAX_EXPRESSION) {
    return `The expression is ${text.length} characters; eval_js takes one expression of at most ${MAX_EXPRESSION}, not a program.`;
  }
  for (const [pattern, why] of REFUSALS) {
    if (pattern.test(text)) return `Not evaluated: ${why}. eval_js only reads a value out of the page.`;
  }
  return '';
}

/** The last resort for perception: one expression, read-only, size-capped and recorded in the trace. */
export class ScriptHandler extends BaseHandler {
  async handleEvalJs(input: z.infer<typeof evalJsActionSchema.schema>): Promise<ActionResult> {
    const expression = input.expression.trim();
    const refusal = refuseExpression(expression);
    if (refusal) {
      record({ level: 'warning', kind: 'span', component: 'eval_js', msg: 'refused', data: { expression: expression.slice(0, 500), refusal } });
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, refusal);
      return new ActionResult({ error: refusal, includeInMemory: true });
    }

    const cap = Math.min(MAX_CHARS, Math.max(MIN_CHARS, input.max_chars ?? DEFAULT_CHARS));
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, 'Reading a value out of the page');
    const page = await this.context.browserContext.getCurrentPage();
    const startedAt = Date.now();
    try {
      const value = await page.evaluateExpression(expression, cap);
      record({
        level: 'info',
        kind: 'span',
        component: 'eval_js',
        msg: 'evaluated',
        durationMs: Date.now() - startedAt,
        data: { expression: expression.slice(0, 500), chars: value.length },
      });
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'Read a value out of the page');
      return new ActionResult({
        extractedContent: wrapUntrustedContent(`${expression} =\n${value}`),
        includeInMemory: true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      record({ level: 'warning', kind: 'span', component: 'eval_js', msg: 'threw', durationMs: Date.now() - startedAt, data: { expression: expression.slice(0, 500), reason } });
      const msg = `The expression threw: ${reason}. The element or property may not exist on this page; check the page state first.`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }
  }
}

import { describe, expect, it } from 'vitest';
import { handleAgentError, isFatalAgentError } from '../utils/error-handler';
import { ChatModelAuthError, ChatModelRateLimitError } from '../errors';

function mapped(error: Error): unknown {
  try {
    handleAgentError(error, 'Navigation failed');
  } catch (e) {
    return e;
  }
  throw new Error('handleAgentError did not throw');
}

/**
 * A 401 body commonly echoes part of the key it rejected, and these messages go into chat history and in front of the
 * user. Bodies below are the shapes providers actually send.
 */
describe('provider errors shown to the user', () => {
  const message = (error: Error) => (mapped(error) as Error).message;

  it('removes an OpenAI-style key from an authentication failure', () => {
    const text = message(
      new Error('401 Incorrect API key provided: sk-proj-AbCdEf1234567890GhIjKlMn. You can find your API key at https://platform.openai.com'),
    );
    expect(text).not.toContain('sk-proj-AbCdEf1234567890GhIjKlMn');
    expect(text).toContain('[redacted]');
    expect(text).toContain('Incorrect API key'); // the cause stays; only the secret goes
  });

  it('removes a Google key and a bearer token', () => {
    const google = message(new Error('Google request failed with status code 400: API key not valid. key=AIzaSyA1234567890abcdefghijklmnopqrstuv'));
    expect(google).not.toMatch(/AIzaSy[\w-]{20,}/);
    const bearer = message(Object.assign(new Error('401 Unauthorized: Authorization: Bearer ya29.a0AfH6SMBx-secret-token-value'), { status: 401 }));
    expect(bearer).not.toContain('ya29.a0AfH6SMBx-secret-token-value');
  });

  it('bounds a very long provider body', () => {
    const text = message(new Error(`401 Unauthorized ${'x'.repeat(5000)}`));
    expect(text.length).toBeLessThan(600);
  });
});

describe('agent error mapping', () => {
  it('ends the task on provider auth and rate-limit errors', () => {
    const auth = mapped(new Error('Google request failed with status code 401: UNAUTHENTICATED'));
    const rateLimited = mapped(Object.assign(new Error('429 Resource exhausted'), { name: 'RateLimitError' }));

    expect(auth).toBeInstanceOf(ChatModelAuthError);
    expect(isFatalAgentError(auth)).toBe(true);
    expect(rateLimited).toBeInstanceOf(ChatModelRateLimitError);
    expect(isFatalAgentError(rateLimited)).toBe(true);
  });

  it('counts timeouts and other plain failures as a failed step', () => {
    expect(isFatalAgentError(mapped(new Error('LLM call timed out after 60000ms')))).toBe(false);
    expect(isFatalAgentError(mapped(new Error('No valid tool call after 3 attempts')))).toBe(false);
  });
});

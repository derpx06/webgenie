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

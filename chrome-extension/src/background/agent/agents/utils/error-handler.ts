import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  ChatModelRateLimitError,
  ChatModelPaymentRequiredError,
  EXTENSION_CONFLICT_ERROR_MESSAGE,
  ExtensionConflictError,
  isAbortedError,
  isAuthenticationError,
  isBadRequestError,
  isExtensionConflictError,
  isForbiddenError,
  isRateLimitError,
  isPaymentRequiredError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from '../errors';
import { URLNotAllowedError } from '@src/background/browser/views';

/**
 * Maps generic LLM errors or browser errors to specific Agent error classes
 */
export function handleAgentError(error: unknown, fallbackPrefix: string): never {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (isAuthenticationError(error)) {
    throw new ChatModelAuthError(errorMessage, error);
  }

  if (isBadRequestError(error)) {
    throw new ChatModelBadRequestError(errorMessage, error);
  }

  if (isPaymentRequiredError(error)) {
    throw new ChatModelPaymentRequiredError(errorMessage, error);
  }

  if (isRateLimitError(error)) {
    throw new ChatModelRateLimitError('API Rate Limit Exceeded (429). Please try again in a few moments.', error);
  }

  if (isAbortedError(error)) {
    throw new RequestCancelledError(errorMessage);
  }

  if (isExtensionConflictError(error)) {
    throw new ExtensionConflictError(EXTENSION_CONFLICT_ERROR_MESSAGE, error);
  }

  if (isForbiddenError(error)) {
    throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
  }

  if (error instanceof URLNotAllowedError) {
    throw error;
  }

  throw new Error(`${fallbackPrefix}: ${errorMessage}`);
}

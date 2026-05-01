/**
 * Background Services Module
 * Provides ancillary services for a production-grade agent system.
 *
 * Services:
 * - Security: Content sanitization, threat detection, and guardrails
 * - Analytics: Performance tracking and task completion metrics
 * - Voice: Speech-to-text processing
 */

export * from './analytics';
export * as SecurityGuardrails from './guardrails/index';
export * from './speechToText';

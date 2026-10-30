/**
 * Delimiter integrity for untrusted page content.
 *
 * What earns its place here is keeping a page from forging the markers that separate its words from the user's: the
 * nano_* tags, the XML shapes that imitate them. The phrase matching alongside it is kept because it is cheap, not
 * because it is measured — published detectors of this kind score 0.0-0.08 true-positive rate on injections that
 * carry no explicit instruction, and this one reads English only against a threat written in eighty languages. The
 * defense that does the work is the delimiting itself, plus restating the user's request after the page.
 *
 * Nothing here may rewrite content that is not a forged delimiter. This filter runs over the user's own task text as
 * well as over pages.
 */

import type { SecurityPattern } from './types';
import { ThreatType } from './types';

/**
 * Core security patterns for content sanitization
 */
const SECURITY_PATTERNS: SecurityPattern[] = [
  // Task override attempts
  {
    pattern: /\b(ignore|forget|disregard)[\s\-_]*(previous|all|above)[\s\-_]*(instructions?|tasks?|commands?)\b/gi,
    type: ThreatType.TASK_OVERRIDE,
    description: 'Attempt to override previous instructions',
    replacement: '[BLOCKED_OVERRIDE_ATTEMPT]',
  },
  {
    pattern: /\b(your?|the)[\s\-_]*new[\s\-_]*(task|instruction|goal|objective)[\s\-_]*(is|are|:)/gi,
    type: ThreatType.TASK_OVERRIDE,
    description: 'Attempt to inject new task',
    replacement: '[BLOCKED_TASK_INJECTION]',
  },
  {
    pattern: /\b(now|instead|actually)[\s\-_]+(you must|you should|you will)[\s\-_]+/gi,
    type: ThreatType.TASK_OVERRIDE,
    description: 'Attempt to redirect agent behavior',
    replacement: '[BLOCKED_REDIRECT]',
  },
  {
    pattern: /\bultimate[-_ ]+task\b/gi,
    type: ThreatType.TASK_OVERRIDE,
    description: 'Reference to ultimate task',
    replacement: '',
  },

  // Prompt injection attempts - Tags and system references
  {
    pattern: /\bsystem[\s\-_]*(prompt|message|instruction)/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Reference to system prompt',
    replacement: '[BLOCKED_SYSTEM_REFERENCE]',
  },
  {
    pattern: /\bnano[-_ ]+untrusted[-_ ]+content\b/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Attempt to fake untrusted content tags',
    replacement: '',
  },
  {
    pattern: /\bnano[-_ ]+user[-_ ]+request\b/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Attempt to fake user request tags',
    replacement: '',
  },
  {
    pattern: /\bnano[-_]+attached[-_]+files\b/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Reference to attached files',
    replacement: '',
  },

  // Suspicious XML/HTML tags
  {
    pattern: /<\/?[\s]*(?:instruction|command|system|task|override|ignore|plan|execute|request)[\s]*>/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Suspicious XML/HTML tags',
    replacement: '',
  },
  {
    pattern: /\]\]>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'XML injection attempt',
    replacement: '',
  },

  // No content redaction here. This filter also runs over the user's own task text (MessageManager.addTask and
  // addHumanAnswer), so a 16-digit pattern rewrote the order number, tracking number or card the user deliberately
  // gave the agent, and a 3-2-4 pattern rewrote any date or reference shaped like one. Redacting page content is in
  // any case not a defense against injection: what the page says is data either way. Secrets the user supplies are
  // handled where they belong, as {{secret_N}} placeholders the model never sees.
];

/**
 * Additional patterns that can be enabled for stricter security
 * These are kept separate to allow for configurable security levels
 */
const STRICT_PATTERNS: SecurityPattern[] = [
  {
    pattern: /\b(password|pwd|passwd|api[\s_-]*key|secret|token)\s*[:=]\s*["']?[\w-]+["']?/gi,
    type: ThreatType.SENSITIVE_DATA,
    description: 'Credential detected',
    replacement: '[REDACTED_CREDENTIAL]',
  },
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
    type: ThreatType.SENSITIVE_DATA,
    description: 'Email address detected',
    replacement: '[EMAIL]',
  },
  {
    pattern: /\b(bypass|circumvent|avoid|skip)[\s\-_]*(security|safety|filter|check)/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Security bypass attempt',
    replacement: '[BLOCKED_BYPASS]',
  },
];

/**
 * Get patterns based on security level
 * @param strict - Whether to include strict patterns
 * @returns Array of security patterns based on strictness level
 */
export function getPatterns(strict: boolean = false): SecurityPattern[] {
  return strict ? [...SECURITY_PATTERNS, ...STRICT_PATTERNS] : SECURITY_PATTERNS;
}

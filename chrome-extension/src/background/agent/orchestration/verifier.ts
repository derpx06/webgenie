/**
 * The independent check. After the plan has run, every subtask's claim is re-read against the blackboard's evidence by
 * a call of its own: a fresh prompt holding the task, the claims and the evidence, and nothing from the conversation
 * that produced them. The worker that wrote a claim never gets to confirm it, which is the whole point — a model asked
 * "is what you just said true" agrees with itself.
 *
 * A claim a failed node produced is refused without a model call. A verifier call that fails leaves the report
 * `inconclusive` and re-dispatches nothing: a check that could not be made is not evidence that a claim is wrong.
 */
import { createLogger } from '@src/background/log';
import type { AskFn, Claim, VerificationReport, Verdict } from './types';

const logger = createLogger('Verifier');

export function verifierPrompt(task: string, claims: Claim[], evidence: string): string {
  return [
    'You are checking someone else\'s work. You did not do it and you cannot look at a page.',
    `The task was: ${task}`,
    '',
    'Claims made, one per part of the task:',
    ...claims.map(claim => `- ${claim.nodeId}: ${claim.text}`),
    '',
    'The evidence gathered while the task ran (this is all you may check against):',
    evidence || '(no evidence was recorded)',
    '',
    'For each claim say whether the evidence supports it. A claim that the evidence neither shows nor contradicts does',
    'not hold. Answer with JSON only, in this shape:',
    '{"verdicts":[{"nodeId":"<id>","holds":true|false,"reason":"<one short sentence>"}]}',
  ].join('\n');
}

function parseVerdicts(text: string): Verdict[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { verdicts?: unknown };
    if (!Array.isArray(parsed.verdicts)) return null;
    return parsed.verdicts.flatMap(entry => {
      const verdict = entry as Partial<Verdict>;
      return typeof verdict?.nodeId === 'string'
        ? [{ nodeId: verdict.nodeId, holds: verdict.holds === true, reason: String(verdict.reason ?? '') }]
        : [];
    });
  } catch {
    return null;
  }
}

export async function verifyRun(params: {
  task: string;
  claims: Claim[];
  evidence: string;
  ask: AskFn;
  /** Nodes that did not finish; their claims are refused before anything is asked. */
  failedNodes?: string[];
  signal?: AbortSignal;
}): Promise<VerificationReport> {
  const failed = new Set(params.failedNodes ?? []);
  const upfront: Verdict[] = [...failed].map(nodeId => ({
    nodeId,
    holds: false,
    reason: 'the part did not finish, so its claim rests on nothing',
  }));
  const checkable = params.claims.filter(claim => !failed.has(claim.nodeId) && claim.text.trim().length > 0);
  if (checkable.length === 0) {
    return { verdicts: upfront, redispatch: [...failed], passed: upfront.length === 0 };
  }

  let answer: string;
  try {
    answer = await params.ask(verifierPrompt(params.task, checkable, params.evidence), params.signal);
  } catch (error) {
    logger.warning(`verification could not be made: ${error instanceof Error ? error.message : String(error)}`);
    return { verdicts: upfront, redispatch: [...failed], passed: false, inconclusive: true };
  }

  const parsed = parseVerdicts(answer);
  if (!parsed) {
    logger.warning('verification answer was not usable JSON');
    return { verdicts: upfront, redispatch: [...failed], passed: false, inconclusive: true };
  }

  const byId = new Map(parsed.map(verdict => [verdict.nodeId, verdict]));
  const verdicts = [
    ...upfront,
    ...checkable.map(
      claim =>
        byId.get(claim.nodeId) ?? {
          nodeId: claim.nodeId,
          holds: false,
          reason: 'the check returned no verdict for this part',
        },
    ),
  ];
  return {
    verdicts,
    redispatch: verdicts.filter(verdict => !verdict.holds).map(verdict => verdict.nodeId),
    passed: verdicts.every(verdict => verdict.holds),
  };
}

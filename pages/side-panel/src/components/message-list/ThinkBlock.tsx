import React from 'react';
import { Actors, type Message } from '@extension/storage';
import { t } from '@extension/i18n';
import { PROGRESS_MARKER } from '../MessageList';

interface ThinkBlockProps {
  actor: Actors;
  messages: Message[];
  isActive: boolean;
}

const extractDomain = (text: string): string | null => {
  const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/i;
  const match = text.match(domainRegex);
  if (match) return match[1];

  const commonSites = ['techcrunch', 'github', 'google', 'amazon', 'reddit', 'twitter', 'linkedin'];
  for (const site of commonSites) {
    if (text.toLowerCase().includes(site)) return `${site}.com`;
  }
  return null;
};

interface DeduplicatedStep {
  content: string;
  timestamp: number;
  count: number;
  isWarning: boolean;
  warningDetail?: string;
  isLive: boolean;
}

function jaroWinklerSimilarity(s1: string, s2: string): number {
  s1 = s1.trim().toLowerCase();
  s2 = s2.trim().toLowerCase();
  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(len2, i + matchWindow + 1);
    for (let j = start; j < end; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (s1Matches[i]) {
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefixLen = 0;
  const maxPrefix = Math.min(4, Math.min(len1, len2));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLen++;
    } else {
      break;
    }
  }

  const p = 0.1;
  return jaro + prefixLen * p * (1 - jaro);
}

const areStringsSimilar = (s1: string, s2: string): boolean => {
  const clean1 = s1.trim().toLowerCase();
  const clean2 = s2.trim().toLowerCase();
  if (clean1 === clean2) return true;

  const norm1 = clean1.replace(/[^a-z0-9]/g, '');
  const norm2 = clean2.replace(/[^a-z0-9]/g, '');
  if (norm1 === norm2) return true;

  // Semantic similarity threshold
  return jaroWinklerSimilarity(clean1, clean2) > 0.85;
};

const deduplicateSteps = (stepsList: Message[], isPhaseActive: boolean): DeduplicatedStep[] => {
  const deduped: DeduplicatedStep[] = [];

  stepsList.forEach((step, index) => {
    const isLast = index === stepsList.length - 1;
    const isStepLive = isPhaseActive && isLast;

    // Check if it's a warning step
    const contentLower = step.content.toLowerCase();
    const isWarning =
      contentLower.includes('fail') ||
      contentLower.includes('error') ||
      contentLower.includes('timeout') ||
      contentLower.includes('retry') ||
      contentLower.includes('exception') ||
      contentLower.includes('crash');

    // Extract warning details (like 5000ms or retry number)
    let warningDetail: string | undefined;
    if (isWarning) {
      const msMatch = step.content.match(/\d+ms/i);
      if (msMatch) {
        warningDetail = msMatch[0];
      } else {
        const retryMatch = step.content.match(/retry\s*(?:#?\d+)?/i);
        if (retryMatch) {
          warningDetail = retryMatch[0];
        } else if (contentLower.includes('timeout')) {
          warningDetail = 'timeout';
        } else {
          warningDetail = 'error';
        }
      }
    }

    if (deduped.length > 0 && areStringsSimilar(deduped[deduped.length - 1].content, step.content) && !isStepLive) {
      deduped[deduped.length - 1].count += 1;
      // Keep the latest timestamp
      deduped[deduped.length - 1].timestamp = step.timestamp;
      // If any instance is warning, mark it
      if (isWarning) {
        deduped[deduped.length - 1].isWarning = true;
        if (warningDetail) deduped[deduped.length - 1].warningDetail = warningDetail;
      }
    } else {
      deduped.push({
        content: step.content,
        timestamp: step.timestamp,
        count: 1,
        isWarning,
        warningDetail,
        isLive: isStepLive,
      });
    }
  });

  return deduped;
};

const StepMark = ({ step }: { step: DeduplicatedStep }) => {
  if (step.isLive) return <span className="wg-step-mark"><span className="wg-dot wg-dot-live" /></span>;
  if (step.isWarning)
    return (
      <span className="wg-step-mark">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-2.5" aria-hidden="true">
          <path d="M8 4.5v4M8 11h.01" />
        </svg>
      </span>
    );
  return (
    <span className="wg-step-mark">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-2.5" aria-hidden="true">
        <path d="M3.5 8.5 6.5 11.5 12.5 5" />
      </svg>
    </span>
  );
};

/**
 * One phase of a run — the planner thinking, or the navigator acting — as a rail of
 * steps. Collapsed by default once it is over, so a finished run reads as a summary
 * line and the detail is one click away.
 */
export const ThinkBlock: React.FC<ThinkBlockProps> = ({ actor, messages, isActive }) => {
  const isPlanner = actor === Actors.PLANNER;
  const steps = messages.filter(m => m.content !== PROGRESS_MARKER);

  const headerDomain = steps.map(s => extractDomain(s.content)).find(d => d !== null);
  const cleanDomain = headerDomain ? headerDomain.replace(/^www\./i, '') : null;

  const dedupedSteps = deduplicateSteps(steps, isActive);

  // Open by default: the run card above is the disclosure level, so once it is open the
  // trail has to be readable without another click. The toggle is still there to fold a
  // long phase away by hand.
  const [isExpanded, setIsExpanded] = React.useState(true);

  if (steps.length === 0) return null;

  const name = isPlanner ? t('trail_phase_planning') : t('trail_phase_acting');

  return (
    <div className={`wg-phase ${isActive ? 'wg-tone-accent' : 'wg-tone-idle'}`}>
      <button
        type="button"
        className="wg-phase-head"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(v => !v)}>
        <span className="wg-phase-name">{name}</span>
        {cleanDomain && <span className="wg-phase-host">{cleanDomain}</span>}
        <span className="wg-run-sub">
          <span className="wg-num">
            {steps.length === 1 ? t('trail_stepOne') : t('trail_steps', [String(steps.length)])}
          </span>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`wg-caret ${isExpanded ? 'wg-caret-open' : ''}`}
            aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
        <span className="sr-only">{isExpanded ? t('trail_detailsHide') : t('trail_detailsShow')}</span>
      </button>

      {isExpanded && (
        <ol className="wg-steps">
          {dedupedSteps.map((step, i) => (
            <li
              key={i}
              className={`wg-step ${step.isLive ? 'wg-step-live wg-tone-accent' : step.isWarning ? 'wg-tone-wait' : 'wg-tone-ok'}`}>
              <StepMark step={step} />
              <span className="wg-step-text">
                {step.content}
                {step.count > 1 && <span className="wg-step-badge wg-num">×{step.count}</span>}
                {step.isWarning && step.warningDetail && <span className="wg-step-badge">{step.warningDetail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

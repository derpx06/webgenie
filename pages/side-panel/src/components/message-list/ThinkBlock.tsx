import React from 'react';
import { Actors, type Message } from '@extension/storage';

interface ThinkBlockProps {
  actor: Actors;
  messages: Message[];
  isActive: boolean;
  isDarkMode: boolean;
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
    const isWarning = contentLower.includes('fail') || 
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

export const ThinkBlock: React.FC<ThinkBlockProps> = ({ actor, messages, isActive }) => {
  const isPlanner = actor === Actors.PLANNER;
  const steps = messages.filter(m => m.content !== 'Showing progress...');
  
  // Extract domain for header context
  const headerDomain = steps.map(s => extractDomain(s.content)).find(d => d !== null);
  const cleanDomain = headerDomain ? headerDomain.replace(/^www\./i, '') : null;

  const dedupedSteps = deduplicateSteps(steps, isActive);

  // Default to expanded if active, collapsed if completed
  const [isExpanded, setIsExpanded] = React.useState(isActive);

  // Sync isExpanded state with isActive prop updates (e.g. when a task goes from running to completed)
  React.useEffect(() => {
    setIsExpanded(isActive);
  }, [isActive]);

  return (
    <div className={`xphase ${isActive ? 'active-phase' : ''}`}>
      {/* Absolute positioned phase dot */}
      <div className={`phase-dot ${isActive ? 'active' : isPlanner ? 'plan' : 'act'}`}>
        {isActive ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="animate-spin-fast size-2.5">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
          </svg>
        ) : isPlanner ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="size-2.5">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="size-2.5">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        )}
      </div>

      {/* Phase header labels */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`Toggle ${isPlanner ? 'planning' : 'acting'} steps`}
        className="phase-label-row" 
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span className={`phase-type-label ${isActive ? 'active' : isPlanner ? 'plan' : 'act'}`}>
          {isActive ? 'Active' : isPlanner ? 'Planning' : 'Acting'}
        </span>
        
        {cleanDomain && (
          <span className="domain-pill">
            {cleanDomain}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span className="step-count" style={{ margin: 0 }}>
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              width: '10px',
              height: '10px',
              color: 'var(--ws-muted)',
              transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.2s ease',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Steps List */}
      {isExpanded && (
        <div className="steps-list animate-slide-in relative">
          {/* Internal timeline connecting track line */}
          <div className="absolute inset-y-2 left-[7px] w-[0.5px] bg-slate-300 dark:bg-white/[0.06]" />

          {dedupedSteps.map((step, i) => {
            const isCompleted = !step.isLive;
            return (
              <div className={`step-row ${isCompleted ? 'opacity-85' : ''} ${step.isLive ? 'is-live' : ''}`} key={i}>
                <div className="step-icon-container relative z-10">
                  {step.isLive ? (
                    <div className="relative flex size-3.5 items-center justify-center">
                      <div className="absolute inset-0 animate-ping rounded-full bg-indigo-500/25" />
                      <div className="size-1.5 rounded-full bg-indigo-500" />
                    </div>
                  ) : step.isWarning ? (
                    <div className="flex size-3.5 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-500">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-2">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      </svg>
                    </div>
                  ) : (
                    <div className="flex size-3.5 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="size-1.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                </div>
                
                <div className="min-w-0 flex-grow">
                  <span className={`step-text ${step.isLive ? 'live' : ''}`}>
                    {step.content}
                  </span>

                  {step.count > 1 && (
                    <span className="step-badge-dedup">
                      ×{step.count}
                    </span>
                  )}

                  {step.isWarning && step.warningDetail && (
                    <span className="step-badge-warn">
                      {step.warningDetail}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

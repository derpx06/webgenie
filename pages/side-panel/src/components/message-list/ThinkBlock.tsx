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

    if (deduped.length > 0 && deduped[deduped.length - 1].content === step.content && !isStepLive) {
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

export const ThinkBlock: React.FC<ThinkBlockProps> = ({ actor, messages, isActive, isDarkMode }) => {
  const isPlanner = actor === Actors.PLANNER;
  const steps = messages.filter(m => m.content !== 'Showing progress...');
  
  // Extract domain for header context
  const headerDomain = steps.map(s => extractDomain(s.content)).find(d => d !== null);
  const cleanDomain = headerDomain ? headerDomain.replace(/^www\./i, '') : null;

  const dedupedSteps = deduplicateSteps(steps, isActive);

  return (
    <div className={`xphase ${isActive ? 'active-phase' : ''}`}>
      {/* 17x17px absolute positioned phase dot */}
      <div className={`phase-dot ${isActive ? 'active' : isPlanner ? 'plan' : 'act'}`}>
        {isActive ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-2.5 animate-spin-fast">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
          </svg>
        ) : (
          isPlanner ? 'P' : 'A'
        )}
      </div>

      {/* Phase header labels */}
      <div className="phase-label-row">
        <span className={`phase-type-label ${isActive ? 'active' : isPlanner ? 'plan' : 'act'}`}>
          {isActive ? 'Active' : isPlanner ? 'Planning' : 'Acting'}
        </span>
        
        {cleanDomain && (
          <span className="domain-pill">
            {cleanDomain}
          </span>
        )}

        <span className="step-count">
          {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        </span>
      </div>

      {/* Steps List */}
      <div className="steps-list">
        {dedupedSteps.map((step, i) => {
          const isCompleted = !step.isLive;
          return (
            <div className={`step-row ${isCompleted ? 'opacity-40' : ''}`} key={i}>
              <div className="step-icon-container">
                {step.isLive ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-3 animate-spin-fast text-indigo-500">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
                  </svg>
                ) : step.isWarning ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="size-3 text-[#D97706]">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" className="size-3 text-emerald-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
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
    </div>
  );
};

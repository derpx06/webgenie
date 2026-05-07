import React, { useState, useEffect } from 'react';
import { FaCheckCircle, FaChevronDown, FaRobot, FaGlobe } from 'react-icons/fa';
import { BsCpuFill } from 'react-icons/bs';
import { Actors, type Message } from '@extension/storage';

interface ThinkBlockProps {
  actor: Actors;
  messages: Message[];
  isActive: boolean;
  defaultOpen?: boolean;
  isDarkMode: boolean;
}

const formatTimeOnly = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

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

const TypewriterText: React.FC<{ text: string; speed?: number }> = ({ text, speed = 15 }) => {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      setDisplayedText(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return <span>{displayedText}</span>;
};

export const ThinkBlock: React.FC<ThinkBlockProps> = ({ actor, messages, isActive, defaultOpen, isDarkMode }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? isActive);

  useEffect(() => {
    if (isActive || defaultOpen) setIsOpen(true);
  }, [isActive, defaultOpen]);

  const toggle = () => setIsOpen(!isOpen);

  const actorName = actor === Actors.PLANNER ? 'Planner' : actor === Actors.NAVIGATOR ? 'Navigator' : actor;
  const isPlanner = actor === Actors.PLANNER;

  const steps = messages.filter(m => m.content !== 'Showing progress...');
  const lastStep = steps[steps.length - 1];
  const summaryText = lastStep ? lastStep.content : 'Thinking...';

  // Extract domain for header context
  const headerDomain = steps.map(s => extractDomain(s.content)).find(d => d !== null);

  return (
    <div className={`overflow-hidden rounded-2xl border transition-all duration-300 ${isOpen ? 'shadow-lg' : 'shadow-sm'
      } ${isDarkMode
        ? `border-white/5 bg-white/5 ${isActive ? 'ring-1 ring-indigo-500/30' : ''}`
        : `border-gray-100 bg-gray-50/50 ${isActive ? 'ring-1 ring-indigo-200' : ''}`
      } ${isActive ? (isPlanner ? 'planner-motion' : 'navigator-motion') : ''}`}>
      <button
        type="button"
        className={`flex w-full cursor-pointer select-none items-center gap-3 px-3.5 py-3 text-left transition-colors ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-white'}`}
        onClick={toggle}
      >
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-xl shadow-sm transition-all duration-500 ${isPlanner
          ? (isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600')
          : (isDarkMode ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-50 text-indigo-600')
          } ${isActive ? 'animate-neural-pulse' : ''}`}>
          {isPlanner ? <BsCpuFill size={16} /> : <FaRobot size={16} />}
        </div>

        <div className="min-w-0 grow">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {actorName}
              </span>
              {isActive && (
                <span className="flex gap-0.5">
                  <span className={`size-1 rounded-full bg-indigo-500 ${isPlanner ? 'animate-soft-breathing' : 'animate-bounce'}`}></span>
                  <span className={`size-1 rounded-full bg-indigo-500 ${isPlanner ? 'animate-soft-breathing [animation-delay:0.5s]' : 'animate-bounce [animation-delay:0.2s]'}`}></span>
                  <span className={`size-1 rounded-full bg-indigo-500 ${isPlanner ? 'animate-soft-breathing [animation-delay:1s]' : 'animate-bounce [animation-delay:0.4s]'}`}></span>
                </span>
              )}
            </div>
            {headerDomain && (
              <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${isDarkMode ? 'border border-indigo-500/20 bg-indigo-500/10 text-indigo-400' : 'border border-indigo-100 bg-indigo-50 text-indigo-600'
                }`}>
                {headerDomain.includes('.') && (
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${headerDomain}&sz=16`}
                    alt=""
                    className="size-2 opacity-70"
                  />
                )}
                {headerDomain}
              </div>
            )}
          </div>
          <div className={`truncate text-[12px] font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-500'} ${isOpen ? 'opacity-100' : 'opacity-80'}`}>
            {isActive && isPlanner ? <TypewriterText text={summaryText} /> : summaryText}
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-3">
          <span className={`hidden text-[10px] font-bold sm:inline ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
          <FaChevronDown size={12} className={`shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-indigo-500' : 'text-gray-400'}`} />
        </div>
      </button>

      {isOpen && (
        <div className={`scrollbar-thin max-h-[300px] overflow-y-auto border-t px-4 py-3 ${isDarkMode ? 'border-white/5 bg-black/20' : 'border-gray-100 bg-white/50'}`}>
          <div className="space-y-4">
            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              const type = (isActive && isLast) ? 'run' : 'done';
              const domain = extractDomain(step.content);

              return (
                <div className={`group/step animate-in fade-in slide-in-from-left-2 flex gap-3 duration-300 ${type === 'done' ? 'animate-success-wave' : ''}`} key={i}>
                  <div className="flex flex-col items-center">
                    <div className={`flex size-5 shrink-0 items-center justify-center rounded-full transition-all ${type === 'done'
                      ? (isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600')
                      : (isPlanner ? 'animate-soft-breathing bg-amber-500/20 text-amber-400' : 'animate-neural-pulse bg-indigo-500 text-white')
                      }`}>
                      {type === 'done' ? <FaCheckCircle size={10} /> : (isPlanner ? <BsCpuFill size={8} /> : <div className="size-1.5 rounded-full bg-white"></div>)}
                    </div>
                    {!isLast && <div className={`mt-1 h-full w-px ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`} />}
                  </div>
                  <div className={`relative grow overflow-hidden rounded-lg px-2 pb-1 ${type === 'run' ? (isPlanner ? 'animate-soft-breathing' : 'animate-energy-flow') : ''}`}>
                    {domain && (
                      <div className={`mb-1.5 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${isDarkMode ? 'bg-white/5 text-indigo-400' : 'bg-indigo-50 text-indigo-600'
                        }`}>
                        {domain.includes('.') ? (
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                            alt=""
                            className="size-2.5 opacity-80"
                          />
                        ) : <FaGlobe size={8} />}
                        {domain}
                      </div>
                    )}
                    <p className={`relative z-10 text-[13px] font-medium leading-snug ${type === 'run'
                      ? (isDarkMode ? 'text-white' : 'text-indigo-600')
                      : (isDarkMode ? 'text-gray-400' : 'text-gray-600')
                      }`}>
                      {isActive && isLast && isPlanner ? <TypewriterText text={step.content} /> : step.content}
                    </p>
                    <span className={`relative z-10 mt-1 block text-[10px] font-bold uppercase opacity-30 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                      {formatTimeOnly(step.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

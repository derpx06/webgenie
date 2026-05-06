import React, { useState, useEffect } from 'react';
import { FaCheckCircle, FaChevronDown, FaRobot } from 'react-icons/fa';
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

  return (
    <div className={`overflow-hidden rounded-2xl border transition-all duration-300 ${isOpen ? 'shadow-lg' : 'shadow-sm'
      } ${isDarkMode
        ? `border-white/5 bg-white/5 ${isActive ? 'ring-1 ring-indigo-500/30' : ''}`
        : `border-gray-100 bg-gray-50/50 ${isActive ? 'ring-1 ring-indigo-200' : ''}`
      }`}>
      <button
        type="button"
        className={`flex cursor-pointer select-none items-center gap-3 px-3.5 py-3 transition-colors ${isDarkMode ? 'hover:bg-white/5' : 'hover:bg-white'}`}
        onClick={toggle}
      >
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-xl shadow-sm ${isPlanner
          ? (isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600')
          : (isDarkMode ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-50 text-indigo-600')
          }`}>
          {isPlanner ? <BsCpuFill size={16} /> : <FaRobot size={16} />}
        </div>

        <div className="min-w-0 grow">
          <div className="mb-0.5 flex items-center gap-2">
            <span className={`text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {actorName}
            </span>
            {isActive && (
              <span className="flex gap-0.5">
                <span className="size-1 animate-bounce rounded-full bg-indigo-500"></span>
                <span className="size-1 animate-bounce rounded-full bg-indigo-500 [animation-delay:0.2s]"></span>
                <span className="size-1 animate-bounce rounded-full bg-indigo-500 [animation-delay:0.4s]"></span>
              </span>
            )}
          </div>
          <p className={`truncate text-[12px] font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-500'} ${isOpen ? 'opacity-100' : 'opacity-80'}`}>
            {summaryText}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className={`hidden text-[10px] font-bold sm:inline ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
          <FaChevronDown size={12} className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-indigo-500' : 'text-gray-400'}`} />
        </div>
      </button>

      {isOpen && (
        <div className={`scrollbar-thin max-h-[300px] overflow-y-auto border-t px-4 py-3 ${isDarkMode ? 'border-white/5 bg-black/20' : 'border-gray-100 bg-white/50'}`}>
          <div className="space-y-4">
            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              const type = (isActive && isLast) ? 'run' : 'done';
              return (
                <div className="group/step animate-in fade-in slide-in-from-left-2 flex gap-3 duration-300" key={i}>
                  <div className="flex flex-col items-center">
                    <div className={`flex size-5 shrink-0 items-center justify-center rounded-full transition-all ${type === 'done'
                      ? (isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600')
                      : 'animate-pulse bg-indigo-500 text-white'
                      }`}>
                      {type === 'done' ? <FaCheckCircle size={10} /> : <div className="size-1.5 rounded-full bg-white"></div>}
                    </div>
                    {!isLast && <div className={`mt-1 h-full w-px ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`} />}
                  </div>
                  <div className="grow pb-1">
                    <p className={`text-[13px] font-medium leading-snug ${type === 'run'
                      ? (isDarkMode ? 'text-white' : 'text-indigo-600')
                      : (isDarkMode ? 'text-gray-400' : 'text-gray-600')
                      }`}>
                      {step.content}
                    </p>
                    <span className="mt-1 block text-[10px] font-bold uppercase opacity-30">
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

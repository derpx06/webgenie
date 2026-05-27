import React from 'react';
import { OrbVisual } from './welcome/OrbVisual';
import { BackgroundGradientAnimation } from './ui/background-gradient-animation';
import type { ChatSessionMetadata } from '@extension/storage';
import { ChatSessionList } from './welcome/ChatSessionList';
import { WorkflowGallery } from './welcome/WorkflowGallery';

interface EmptyChatProps {
    onSelectPrompt: (text: string) => void;
    isDarkMode: boolean;
    recentSessions?: ChatSessionMetadata[];
    children?: React.ReactNode;
}

const EmptyChat: React.FC<EmptyChatProps> = ({ onSelectPrompt, isDarkMode, recentSessions = [], children }) => {
    return (
        <BackgroundGradientAnimation
            containerClassName={`flex-1 w-full overflow-hidden transition-colors duration-500 ${isDarkMode ? 'bg-slate-950' : 'bg-slate-50'}`}
            className={`relative z-10 flex h-full flex-col justify-start overflow-y-auto px-6 pb-8 pt-4 ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}
            gradientBackgroundStart={isDarkMode ? "rgb(2, 6, 23)" : "rgb(248, 250, 252)"}
            gradientBackgroundEnd={isDarkMode ? "rgb(15, 23, 42)" : "rgb(241, 245, 249)"}
            firstColor={isDarkMode ? "79, 70, 229" : "99, 102, 241"}
            secondColor={isDarkMode ? "56, 189, 248" : "129, 140, 248"}
            thirdColor={isDarkMode ? "30, 41, 59" : "226, 232, 240"}
            fourthColor={isDarkMode ? "12, 21, 37" : "248, 250, 252"}
            fifthColor={isDarkMode ? "2, 6, 23" : "255, 255, 255"}
            pointerColor={isDarkMode ? "79, 70, 229" : "99, 102, 241"}
        >
                <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-slate-950/48 via-slate-950/38 to-slate-950/62" />
                <div className="mx-auto w-full max-w-xl">
                    <div className="relative mb-4 flex flex-col items-center text-center">
                        <div className="relative mb-3 opacity-95 transition-all duration-700">
                            <OrbVisual isDarkMode={isDarkMode} />
                        </div>

                        <div className="space-y-2 px-4">
                            <h1 className={`text-5xl font-black leading-none -tracking-wider transition-all duration-700 ${isDarkMode 
                                ? 'bg-gradient-to-b from-white via-white to-white/40 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]' 
                                : 'bg-gradient-to-b from-slate-900 via-slate-800 to-slate-500 bg-clip-text text-transparent'
                                }`}>
                                WebGenie
                            </h1>
                            <p className={`mx-auto max-w-[340px] px-2 font-sans text-[14px] font-medium leading-relaxed tracking-tight ${isDarkMode ? 'text-slate-300/95' : 'text-slate-500'}`}>
                                Professional-grade autonomous intelligence for <br />
                                <span className={isDarkMode ? 'text-indigo-300/95' : 'text-indigo-700/90'}>web research and multi-step task execution.</span>
                            </p>
                        </div>
                    </div>

                    <div className="mb-6 w-full">
                        {children}
                    </div>

                    {recentSessions.length > 0 ? (
                        <ChatSessionList sessions={recentSessions} isDarkMode={isDarkMode} onSelectPrompt={onSelectPrompt} />
                    ) : (
                        <WorkflowGallery isDarkMode={isDarkMode} onSelectPrompt={onSelectPrompt} />
                    )}

                    {/* Operational Status */}
                    <div className="mt-6 flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2">
                            <div className="size-1.5 animate-pulse rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                            <span className={`text-[9px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-300/85' : 'text-slate-600/80'}`}>
                                Runtime Operational
                            </span>
                        </div>
                    </div>
                </div>
        </BackgroundGradientAnimation>
    );
};

export default EmptyChat;

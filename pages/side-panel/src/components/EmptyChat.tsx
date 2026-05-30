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

interface TestToolDefinition {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    schema?: Record<string, unknown>;
}

const EmptyChat: React.FC<EmptyChatProps> = ({ onSelectPrompt, isDarkMode, recentSessions = [], children }) => {
    const [testOutput, setTestOutput] = React.useState<string>('');
    const [toolsList, setToolsList] = React.useState<TestToolDefinition[]>([]);

    const handleLogPageState = () => {
        chrome.runtime.sendMessage({ type: 'TEST_GET_LLM_PAGE_STATE' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                setTestOutput("Error: " + chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                console.log("=== LLM PAGE STATE ===");
                console.log("Formatted Description for LLM:\n", response.stateDescription);
                console.log("Raw Browser State Object:\n", response.rawState);
                setTestOutput(response.stateDescription);
                setToolsList([]);
            } else {
                const errMsg = response?.error || "Unknown error fetching state";
                console.error("Failed to fetch state:", errMsg);
                setTestOutput("Failed to fetch state: " + errMsg);
            }
        });
    };

    const handleLogTools = () => {
        chrome.runtime.sendMessage({ type: 'TEST_GET_ALL_TOOLS' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                setTestOutput("Error: " + chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                console.log("=== LLM ACCESSIBLE TOOLS ===");
                response.tools.forEach((tool: TestToolDefinition) => {
                    console.log(`Tool: ${tool.name}`, tool);
                });
                setToolsList(response.tools);
                setTestOutput('');
            } else {
                const errMsg = response?.error || "Unknown error fetching tools";
                console.error("Failed to fetch tools:", errMsg);
                setTestOutput("Failed to fetch tools: " + errMsg);
            }
        });
    };

    const handleLogFailureRegistry = () => {
        chrome.runtime.sendMessage({ type: 'TEST_GET_FAILURE_REGISTRY' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                setTestOutput("Error: " + chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                console.log("=== FAILURE REGISTRY RECORD ===");
                console.log(response.records);
                setTestOutput(response.records.length > 0
                    ? "=== BLOCKED SELECTORS (FAILURE REGISTRY) ===\n" + JSON.stringify(response.records, null, 2)
                    : "No blocked selectors registered."
                );
                setToolsList([]);
            } else {
                const errMsg = response?.error || "Unknown error fetching failure registry";
                console.error("Failed to fetch failure registry:", errMsg);
                setTestOutput("Failed to fetch failure registry: " + errMsg);
            }
        });
    };

    const handleLogSessionStats = () => {
        chrome.runtime.sendMessage({ type: 'TEST_GET_SESSION_STATS' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                setTestOutput("Error: " + chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                console.log("=== ACTIVE SESSION STATS ===");
                console.log(response.stats);
                setTestOutput(response.stats
                    ? "=== ACTIVE SESSION STATS ===\n" + JSON.stringify(response.stats, null, 2)
                    : "No active execution task running. Stats are empty."
                );
                setToolsList([]);
            } else {
                const errMsg = response?.error || "Unknown error fetching session stats";
                console.error("Failed to fetch session stats:", errMsg);
                setTestOutput("Failed to fetch session stats: " + errMsg);
            }
        });
    };

    const handleClearFailureRegistry = () => {
        chrome.runtime.sendMessage({ type: 'TEST_CLEAR_FAILURE_REGISTRY' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                setTestOutput("Error: " + chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                console.log("=== FAILURE REGISTRY CLEARED ===");
                setTestOutput("Success: " + response.message);
                setToolsList([]);
            } else {
                const errMsg = response?.error || "Unknown error clearing failure registry";
                console.error("Failed to clear failure registry:", errMsg);
                setTestOutput("Failed to clear failure registry: " + errMsg);
            }
        });
    };

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
            <div className="from-slate-950/48 via-slate-950/38 to-slate-950/62 pointer-events-none absolute inset-0 z-0 bg-gradient-to-b" />
            <div className="pointer-events-auto relative z-10 mx-auto w-full max-w-xl">
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

                {/* TEST BUTTONS CONTAINER - START */}
                <div className="pointer-events-auto relative z-20 mt-8 rounded-xl border border-red-500/30 bg-slate-900/40 p-4 text-left">
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-red-400">Test & Verification Actions (Easy to Remove)</h3>
                    <div className="mb-3 flex flex-wrap gap-2">
                        <button
                            onClick={handleLogPageState}
                            className="pointer-events-auto rounded bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-indigo-500"
                        >
                            Log Page State
                        </button>
                        <button
                            onClick={handleLogTools}
                            className="pointer-events-auto rounded bg-purple-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-purple-500"
                        >
                            Log LLM Tools
                        </button>
                        <button
                            onClick={handleLogFailureRegistry}
                            className="pointer-events-auto rounded bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-amber-500"
                        >
                            Log Blocked Selectors
                        </button>
                        <button
                            onClick={handleLogSessionStats}
                            className="pointer-events-auto rounded bg-teal-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-teal-500"
                        >
                            Log Session Stats
                        </button>
                        <button
                            onClick={handleClearFailureRegistry}
                            className="pointer-events-auto rounded bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-rose-500"
                        >
                            Clear Blocked Selectors
                        </button>
                    </div>
                    
                    {(testOutput || toolsList.length > 0) && (
                        <div className="max-h-48 overflow-y-auto rounded border border-white/10 bg-black/60 p-2 font-mono text-[10px] text-slate-300">
                            {testOutput && <pre className="whitespace-pre-wrap">{testOutput}</pre>}
                            {toolsList.length > 0 && (
                                <div className="space-y-2">
                                    <div className="mb-1 font-bold text-amber-400">ALL ACCESSIBLE TOOLS ({toolsList.length}):</div>
                                    {toolsList.map((tool, idx) => (
                                        <div key={idx} className="border-b border-white/5 pb-1">
                                            <span className="font-bold text-indigo-400">{tool.name}</span>: {tool.description}
                                            <div className="mt-0.5 text-[9px] text-slate-500">
                                                Schema: {JSON.stringify(tool.schema)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {/* TEST BUTTONS CONTAINER - END */}

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

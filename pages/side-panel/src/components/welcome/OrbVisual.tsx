import React from 'react';

interface OrbVisualProps {
    isDarkMode: boolean;
}

export const OrbVisual: React.FC<OrbVisualProps> = ({ isDarkMode }) => {
    return (
        <div className="relative flex size-72 items-center justify-center">
            {/* 1. LAYERED ATMOSPHERIC GLOWS */}
            <div className={`absolute inset-0 ${isDarkMode ? 'bg-indigo-500/10' : 'bg-indigo-500/[0.03]'} rounded-full blur-[100px] animate-pulse-gentle`}></div>
            <div className={`absolute inset-0 ${isDarkMode ? 'bg-cyan-500/5' : 'bg-violet-500/[0.02]'} rounded-full blur-[80px] animate-pulse-slow`}></div>

            {/* 2. HOLOGRAPHIC RINGS (OUTER) */}
            <div className={`absolute inset-0 border border-dashed ${isDarkMode ? 'border-white/5' : 'border-indigo-500/10'} rounded-full animate-spin-slow opacity-50`}></div>
            <div className={`absolute inset-8 border border-dashed ${isDarkMode ? 'border-indigo-400/10' : 'border-indigo-400/10'} rounded-full animate-spin-reverse opacity-40`}></div>
            <div className={`absolute inset-16 border ${isDarkMode ? 'border-white/5' : 'border-indigo-500/5'} rounded-full animate-spin-slow opacity-30`}></div>

            {/* 3. NEURAL PATHS / SIGNAL LINES */}
            <svg className="absolute inset-0 size-full opacity-30" viewBox="0 0 100 100">
                <defs>
                    <linearGradient id="neural-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={isDarkMode ? "#22d3ee" : "#6366f1"} stopOpacity="0" />
                        <stop offset="50%" stopColor={isDarkMode ? "#22d3ee" : "#6366f1"} stopOpacity="0.8" />
                        <stop offset="100%" stopColor={isDarkMode ? "#22d3ee" : "#6366f1"} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="48" fill="none" stroke="url(#neural-gradient)" strokeWidth="0.5" strokeDasharray="1 10" className="animate-spin-slow origin-center" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="url(#neural-gradient)" strokeWidth="0.2" strokeDasharray="5 15" className="animate-spin-reverse origin-center" />
            </svg>

            {/* 4. FLOATING PARTICLES */}
            <div className="absolute inset-0 overflow-hidden rounded-full opacity-40">
                {[...Array(6)].map((_, i) => (
                    <div
                        key={i}
                        className={`absolute size-1 rounded-full ${isDarkMode ? 'bg-cyan-400' : 'bg-indigo-400/40'} blur-[1px] animate-float`}
                        style={{
                            top: `${Math.random() * 100}%`,
                            left: `${Math.random() * 100}%`,
                            animationDelay: `${i * 1.5}s`,
                            animationDuration: `${5 + Math.random() * 5}s`
                        }}
                    />
                ))}
            </div>

            {/* 5. THE CORE ENGINE */}
            <div className={`relative z-20 size-52 rounded-full p-[1px] bg-gradient-to-br ${isDarkMode ? 'from-white/20 via-transparent to-white/5' : 'from-white via-indigo-100/50 to-indigo-50/30'} ${isDarkMode ? 'shadow-[0_0_80px_rgba(34,211,238,0.2)]' : 'shadow-[0_10px_40px_rgba(79,70,229,0.08)]'}`}>
                <div className={`size-full rounded-full ${isDarkMode ? 'bg-slate-950/95' : 'bg-white/90'} relative flex items-center justify-center overflow-hidden backdrop-blur-3xl border border-white/5`}>
                    
                    {/* Internal Neural Pulse */}
                    <div className={`absolute inset-0 ${isDarkMode ? 'bg-cyan-500/5' : 'bg-indigo-500/[0.03]'} animate-pulse-soft blur-[40px]`}></div>

                    {/* Central Holographic Sphere */}
                    <div className="relative z-10 flex size-32 items-center justify-center">
                        {/* Orbiting Elements */}
                        <div className={`absolute inset-0 rounded-full border border-t-cyan-500/40 border-r-transparent border-b-violet-500/40 border-l-transparent animate-spin-slow`}></div>
                        <div className={`absolute inset-4 rounded-full border border-t-transparent border-r-indigo-500/40 border-b-transparent border-l-cyan-500/40 animate-spin-reverse`}></div>

                        {/* Inner Intelligent Orb */}
                        <div className={`relative z-10 size-16 rounded-full bg-gradient-to-tr ${isDarkMode ? 'from-indigo-600/80 via-cyan-500/60 to-white/40' : 'from-indigo-500/20 via-white to-indigo-50/40'} border ${isDarkMode ? 'border-white/30' : 'border-white'} ${isDarkMode ? 'shadow-[0_0_50px_rgba(34,211,238,0.5)]' : 'shadow-[0_8px_30px_rgba(79,70,229,0.15)]'} flex items-center justify-center overflow-hidden`}>
                            <div className={`absolute inset-0 ${isDarkMode ? 'bg-white/20' : 'bg-indigo-500/5'} animate-pulse`}></div>
                            <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent"></div>
                            <svg className={`size-8 ${isDarkMode ? 'text-white' : 'text-indigo-600/80'} drop-shadow-[0_0_15px_rgba(79,70,229,0.4)]`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                            </svg>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};


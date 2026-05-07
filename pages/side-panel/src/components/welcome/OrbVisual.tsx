import React from 'react';

interface OrbVisualProps {
    isDarkMode: boolean;
}

export const OrbVisual: React.FC<OrbVisualProps> = ({ isDarkMode }) => {
    const c = isDarkMode;
    const accent = c ? '#22d3ee' : '#6366f1';
    const accent2 = c ? '#818cf8' : '#a78bfa';

    return (
        <div className="relative flex size-64 items-center justify-center">

            {/* ── Ambient glow ── */}
            <div className={`absolute -inset-1/4 rounded-full opacity-35 blur-[90px] ${c ? 'bg-indigo-600/40' : 'bg-indigo-400/20'}`} style={{ animation: 'pulse 4s ease-in-out infinite' }} />
            <div className={`absolute inset-[-10%] rounded-full opacity-25 blur-[50px] ${c ? 'bg-cyan-500/30' : 'bg-violet-400/15'}`} style={{ animation: 'pulse 6s ease-in-out infinite reverse' }} />

            {/* ── Web-path orbital rings (represent browsing paths) ── */}
            <div className="animate-spin-slow absolute inset-0 rounded-full border border-dashed opacity-15" style={{ borderColor: accent }} />
            <div className="animate-spin-reverse absolute inset-[12%] rounded-full border opacity-10" style={{ borderColor: accent2, borderStyle: 'dashed' }} />

            {/* Gradient arc ring (represents a browser loading arc) */}
            <svg className="absolute inset-0 size-full" viewBox="0 0 200 200">
                <defs>
                    <linearGradient id="arc-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor={accent} stopOpacity="0" />
                        <stop offset="50%" stopColor={accent} stopOpacity="0.7" />
                        <stop offset="100%" stopColor={accent2} stopOpacity="0" />
                    </linearGradient>
                    {/* Animated progress arc - like a browser loading indicator */}
                    <linearGradient id="arc-grad2" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor={accent2} stopOpacity="0" />
                        <stop offset="50%" stopColor={accent2} stopOpacity="0.5" />
                        <stop offset="100%" stopColor={accent} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <circle cx="100" cy="100" r="95" fill="none" stroke="url(#arc-grad)" strokeWidth="1.5" strokeDasharray="120 480" className="animate-spin-slow origin-center" style={{ transformOrigin: '100px 100px' }} />
                <circle cx="100" cy="100" r="78" fill="none" stroke="url(#arc-grad2)" strokeWidth="1" strokeDasharray="80 410" className="animate-spin-reverse origin-center" style={{ transformOrigin: '100px 100px' }} />
            </svg>

            {/* ── Neural Synapses (connecting the nodes) ── */}
            <svg className="pointer-events-none absolute inset-0 size-full opacity-20" viewBox="0 0 200 200">
                <defs>
                    <filter id="synapse-glow">
                        <feGaussianBlur stdDeviation="1.5" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>
                {[
                    [0, 3], [1, 4], [2, 0], [3, 1], [4, 2]
                ].map(([from], i) => {
                    const nodes = [
                        { angle: 0, r: 88, dur: 10 },
                        { angle: 120, r: 88, dur: 10 },
                        { angle: 240, r: 88, dur: 10 },
                        { angle: 60, r: 72, dur: 14, rev: true },
                        { angle: 200, r: 72, dur: 14, rev: true },
                    ];
                    return (
                        <line
                            key={i}
                            x1="100" y1="100" x2="100" y2="100"
                            stroke={i % 2 === 0 ? accent : accent2}
                            strokeWidth="0.5"
                            strokeDasharray="2 4"
                            className="neural-path"
                            style={{ 
                                filter: 'url(#synapse-glow)',
                                animation: `synapse-pulse ${nodes[from].dur}s linear infinite`
                            }}
                        />
                    );
                })}
            </svg>

            {/* ── Orbiting nodes ── */}
            {[
                { angle: 0, r: 88, dur: 10, size: 5 },
                { angle: 120, r: 88, dur: 10, size: 3.5 },
                { angle: 240, r: 88, dur: 10, size: 4 },
                { angle: 60, r: 72, dur: 14, size: 3, rev: true },
                { angle: 200, r: 72, dur: 14, size: 2.5, rev: true },
            ].map((node, i) => (
                <div
                    key={i}
                    className="pointer-events-none absolute inset-0"
                    style={{ animation: `spin ${node.dur}s linear infinite ${node.rev ? 'reverse' : 'normal'}` }}
                >
                    <div
                        className="absolute rounded-full"
                        style={{
                            width: node.size,
                            height: node.size,
                            background: i % 2 === 0 ? accent : accent2,
                            boxShadow: `0 0 ${node.size * 2}px ${node.size}px ${i % 2 === 0 ? accent : accent2}66`,
                            top: `calc(50% - ${node.r}px * ${Math.sin(node.angle * Math.PI / 180)} - ${node.size / 2}px)`,
                            left: `calc(50% + ${node.r}px * ${Math.cos(node.angle * Math.PI / 180)} - ${node.size / 2}px)`,
                        }}
                    />
                </div>
            ))}

            {/* ── Main orb shell ── */}
            <div
                className="relative z-20 flex size-44 items-center justify-center overflow-hidden rounded-full"
                style={{
                    background: c
                        ? 'radial-gradient(circle at 32% 28%, rgba(99,102,241,0.22) 0%, rgba(15,23,42,0.96) 60%)'
                        : 'radial-gradient(circle at 32% 28%, rgba(224,231,255,0.95) 0%, rgba(248,250,252,0.98) 60%)',
                    boxShadow: c
                        ? `0 0 0 1px rgba(99,102,241,0.25), 0 0 70px rgba(34,211,238,0.12), 0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.07)`
                        : `0 0 0 1px rgba(99,102,241,0.12), 0 0 50px rgba(99,102,241,0.07), 0 20px 40px rgba(79,70,229,0.07), inset 0 1px 0 rgba(255,255,255,1)`,
                }}
            >
                {/* Inner rotating accent ring */}
                <div className="animate-spin-slow absolute inset-3 rounded-full border-[1.5px] border-transparent opacity-25"
                    style={{ borderTopColor: accent, borderRightColor: accent2, animationDuration: '8s' }} />
                <div className="animate-spin-reverse absolute inset-3 rounded-full border border-transparent opacity-15"
                    style={{ borderBottomColor: c ? '#818cf8' : '#6366f1', animationDuration: '13s' }} />

                {/* Specular top-left highlight */}
                <div className="absolute left-5 top-3 size-10 rounded-full opacity-25 blur-lg"
                    style={{ background: c ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,1)' }} />

                {/* ── CENTER ICON: Browser cursor + AI spark ── */}
                {/* This represents an AI agent that clicks/surfs the web */}
                <div className="relative z-10 flex items-center justify-center">
                    {/* Glow halo */}
                    <div className="absolute size-20 rounded-full opacity-50 blur-2xl"
                        style={{ background: c ? 'rgba(34,211,238,0.25)' : 'rgba(99,102,241,0.18)' }} />

                    <img
                        src="/webgenie-logo.png"
                        alt="WebGenie Logo"
                        className="relative z-10 size-16 object-contain drop-shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                        style={{ filter: c ? 'drop-shadow(0 0 12px rgba(34,211,238,0.5))' : 'none' }}
                    />
                </div>
            </div>

            <style>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.05); } }
                @keyframes synapse-pulse { 0%, 100% { opacity: 0.1; stroke-dashoffset: 0; } 50% { opacity: 0.4; stroke-dashoffset: 10; } }
            `}</style>
        </div>
    );
};

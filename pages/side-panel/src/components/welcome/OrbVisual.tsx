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
            <div className={`absolute inset-[-25%] rounded-full blur-[90px] opacity-35 ${c ? 'bg-indigo-600/40' : 'bg-indigo-400/20'}`} style={{ animation: 'pulse 4s ease-in-out infinite' }} />
            <div className={`absolute inset-[-10%] rounded-full blur-[50px] opacity-25 ${c ? 'bg-cyan-500/30' : 'bg-violet-400/15'}`} style={{ animation: 'pulse 6s ease-in-out infinite reverse' }} />

            {/* ── Web-path orbital rings (represent browsing paths) ── */}
            <div className="absolute inset-0 rounded-full border border-dashed opacity-15 animate-spin-slow" style={{ borderColor: accent }} />
            <div className="absolute inset-[12%] rounded-full border opacity-10 animate-spin-reverse" style={{ borderColor: accent2, borderStyle: 'dashed' }} />

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

            {/* ── Orbiting nodes (represent tabs / web targets) ── */}
            {[
                { angle: 0, r: 88, dur: 10, size: 5 },
                { angle: 120, r: 88, dur: 10, size: 3.5 },
                { angle: 240, r: 88, dur: 10, size: 4 },
                { angle: 60, r: 72, dur: 14, size: 3, rev: true },
                { angle: 200, r: 72, dur: 14, size: 2.5, rev: true },
            ].map((node, i) => (
                <div
                    key={i}
                    className="absolute inset-0 pointer-events-none"
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
                className="relative z-20 size-44 rounded-full flex items-center justify-center overflow-hidden"
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
                <div className="absolute inset-3 rounded-full border-[1.5px] border-transparent animate-spin-slow opacity-25"
                    style={{ borderTopColor: accent, borderRightColor: accent2, animationDuration: '8s' }} />
                <div className="absolute inset-3 rounded-full border border-transparent animate-spin-reverse opacity-15"
                    style={{ borderBottomColor: c ? '#818cf8' : '#6366f1', animationDuration: '13s' }} />

                {/* Specular top-left highlight */}
                <div className="absolute top-3 left-5 size-10 rounded-full blur-lg opacity-25"
                    style={{ background: c ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,1)' }} />

                {/* ── CENTER ICON: Browser cursor + AI spark ── */}
                {/* This represents an AI agent that clicks/surfs the web */}
                <div className="relative z-10 flex items-center justify-center">
                    {/* Glow halo */}
                    <div className="absolute size-20 rounded-full blur-2xl opacity-50"
                        style={{ background: c ? 'rgba(34,211,238,0.25)' : 'rgba(99,102,241,0.18)' }} />

                    <svg viewBox="0 0 48 48" fill="none" className="relative z-10 size-[52px]"
                        style={{ filter: c ? 'drop-shadow(0 0 10px rgba(34,211,238,0.6))' : 'drop-shadow(0 0 8px rgba(99,102,241,0.4))' }}>

                        {/* ── Browser window frame ── */}
                        <rect x="4" y="8" width="40" height="32" rx="4" ry="4"
                            stroke={accent} strokeWidth="1.5" fill="none" opacity="0.85" />
                        {/* Title bar */}
                        <line x1="4" y1="15" x2="44" y2="15" stroke={accent} strokeWidth="1" opacity="0.5" />
                        {/* Browser dots (traffic lights) */}
                        <circle cx="9" cy="11.5" r="1.2" fill={accent} opacity="0.7" />
                        <circle cx="13" cy="11.5" r="1.2" fill={accent2} opacity="0.5" />
                        <circle cx="17" cy="11.5" r="1.2" fill={c ? '#6366f1' : '#a78bfa'} opacity="0.4" />
                        {/* URL bar */}
                        <rect x="22" y="9.5" width="18" height="3.5" rx="1.5" fill={accent} opacity="0.12" />
                        <line x1="23" y1="11.2" x2="38" y2="11.2" stroke={accent} strokeWidth="0.7" opacity="0.3" />

                        {/* ── AI cursor inside browser ── */}
                        {/* The pointer arrow */}
                        <path
                            d="M14 20 L14 34 L18 30 L21.5 37 L24 36 L20.5 29 L26 28.5 Z"
                            fill={accent}
                            opacity="0.95"
                        />

                        {/* ── AI sparkle at cursor tip ── */}
                        {/* Central spark */}
                        <circle cx="14" cy="20" r="2" fill={c ? '#ffffff' : '#ffffff'} opacity="0.95" />
                        <circle cx="14" cy="20" r="3.5" fill={accent} opacity="0.3" />
                        {/* Rays from spark */}
                        <line x1="14" y1="16.5" x2="14" y2="15" stroke={accent} strokeWidth="1" opacity="0.7" />
                        <line x1="17" y1="17" x2="18.1" y2="15.9" stroke={accent} strokeWidth="1" opacity="0.5" />
                        <line x1="11" y1="17" x2="9.9" y2="15.9" stroke={accent} strokeWidth="1" opacity="0.5" />
                        <line x1="17.5" y1="20" x2="19" y2="20" stroke={accent} strokeWidth="1" opacity="0.4" />

                        {/* AI "thinking" dots (right side of browser) */}
                        <circle cx="33" cy="22" r="1.5" fill={accent2} opacity="0.7" style={{ animation: 'pulse 1.2s ease-in-out infinite' }} />
                        <circle cx="37" cy="22" r="1.5" fill={accent2} opacity="0.5" style={{ animation: 'pulse 1.2s ease-in-out 0.4s infinite' }} />
                        <circle cx="41" cy="22" r="1.5" fill={accent2} opacity="0.35" style={{ animation: 'pulse 1.2s ease-in-out 0.8s infinite' }} />
                    </svg>
                </div>
            </div>

            <style>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

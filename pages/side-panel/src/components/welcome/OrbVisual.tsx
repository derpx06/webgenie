import React from 'react';
import Orb from '../Orb';

interface OrbVisualProps {
    isDarkMode: boolean;
}

export const OrbVisual: React.FC<OrbVisualProps> = ({ isDarkMode }) => {
    return (
        <div className="relative flex size-40 items-center justify-center">
            {/* ── Interactive WebGL Orb Background ── */}
            <div className="absolute inset-0 z-0 scale-110 overflow-hidden rounded-full">
                <Orb
                    hue={0}
                    hoverIntensity={1.0}
                    rotateOnHover={true}
                    backgroundColor="transparent"
                    innerRadius={0.7}
                    color1={isDarkMode ? '#8b5cf6' : '#d946ef'} // Violet/Fuchsia
                    color2={isDarkMode ? '#06b6d4' : '#6366f1'} // Cyan/Indigo
                />
            </div>

            {/* ── Center Logo with depth ── */}
            <div className="relative z-10 flex items-center justify-center">
                {/* Secondary inner glow for logo pop */}
                <div className={`absolute size-28 rounded-full opacity-40 blur-2xl ${isDarkMode ? 'bg-violet-400/40' : 'bg-purple-500/20'}`} />

                <img
                    src="/webgenie-logo.png"
                    alt="WebGenie Logo"
                    className="relative z-10 size-24 object-contain drop-shadow-[0_0_15px_rgba(34,211,238,0.5)] transition-transform duration-700 hover:scale-105"
                    style={{ filter: isDarkMode ? 'drop-shadow(0 0 10px rgba(139,92,246,0.4))' : 'none' }}
                />
            </div>
        </div>
    );
};

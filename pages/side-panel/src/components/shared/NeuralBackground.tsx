import React from 'react';

export const NeuralBackground: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <style>{`
        @keyframes float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(10px, -15px) scale(1.05); }
        }
        @keyframes float-up {
          0% { transform: translateY(100vh) scale(0); opacity: 0; }
          20% { opacity: 0.5; }
          80% { opacity: 0.5; }
          100% { transform: translateY(-100px) scale(1); opacity: 0; }
        }
        @keyframes noise-shift {
          0% { transform: translate(0, 0); }
          10% { transform: translate(-1%, -1%); }
          20% { transform: translate(1%, 1%); }
          30% { transform: translate(-2%, 0); }
          40% { transform: translate(2%, 2%); }
          50% { transform: translate(-1%, -2%); }
          60% { transform: translate(1%, 1%); }
          70% { transform: translate(-2%, 1%); }
          80% { transform: translate(1%, -1%); }
          90% { transform: translate(0, 2%); }
          100% { transform: translate(0, 0); }
        }
        .animate-float { animation: float infinite ease-in-out; }
        .animate-float-up { animation: float-up infinite linear; }
        .animate-noise { animation: noise-shift 0.2s steps(2) infinite; }
      `}</style>
      {/* 1. Animated Gradient Surface */}
      <div className={`animate-pulse-slow absolute inset-0 opacity-15 transition-opacity duration-1000 ${
        isDarkMode 
          ? 'bg-[radial-gradient(circle_at_50%_0%,_rgba(79,70,229,0.06),_transparent_70%)]' 
          : 'bg-[radial-gradient(circle_at_50%_0%,_rgba(79,70,229,0.02),_transparent_70%)]'
      }`} />
      
      {/* 2. Floating Atmospheric Orbs */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className={`animate-float absolute rounded-full blur-[100px] ${
              isDarkMode ? 'bg-indigo-500/[0.02]' : 'bg-indigo-400/[0.015]'
            }`}
            style={{
              width: `${250 + i * 50}px`,
              height: `${250 + i * 50}px`,
              left: `${5 + i * 25}%`,
              top: `${10 + i * 20}%`,
              animationDelay: `${i * 3}s`,
              animationDuration: `${20 + i * 8}s`
            }}
          />
        ))}
      </div>

      {/* 3. Neural Noise Texture (Grain) - Animated for high-fidelity feel */}
      <div className={`animate-noise pointer-events-none absolute inset-0 opacity-[0.02] mix-blend-soft-light ${isDarkMode ? 'contrast-125' : ''}`} 
           style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />
      
      {/* 4. Volumetric Glow (Center) */}
      <div className={`absolute left-1/2 top-1/2 size-full -translate-x-1/2 -translate-y-1/2 opacity-20 ${
        isDarkMode ? 'bg-[radial-gradient(circle_at_center,_rgba(79,70,229,0.04),_transparent_60%)]' : 'bg-[radial-gradient(circle_at_center,_rgba(79,70,229,0.01),_transparent_60%)]'
      }`} />

      {/* 5. Micro-Particles */}
      <div className="absolute inset-0">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className={`animate-float-up absolute size-px rounded-full ${
              isDarkMode ? 'bg-indigo-400/10' : 'bg-indigo-500/5'
            }`}
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 15}s`,
              animationDuration: `${25 + Math.random() * 25}s`
            }}
          />
        ))}
      </div>
    </div>
  );
};

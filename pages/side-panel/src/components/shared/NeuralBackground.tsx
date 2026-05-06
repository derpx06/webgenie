import React from 'react';

export const NeuralBackground: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* Dynamic Gradient Movement */}
      <div className={`absolute inset-0 opacity-30 transition-colors duration-1000 ${
        isDarkMode 
          ? 'bg-[radial-gradient(circle_at_50%_50%,_rgba(79,70,229,0.1),_transparent_70%)]' 
          : 'bg-[radial-gradient(circle_at_50%_50%,_rgba(79,70,229,0.05),_transparent_70%)]'
      }`} />
      
      {/* Moving Particles (CSS based) */}
      <div className="absolute inset-0">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className={`absolute rounded-full blur-[100px] animate-pulse ${
              isDarkMode ? 'bg-indigo-500/10' : 'bg-indigo-400/5'
            }`}
            style={{
              width: `${Math.random() * 300 + 200}px`,
              height: `${Math.random() * 300 + 200}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${i * 2}s`,
              animationDuration: `${10 + i * 5}s`,
            }}
          />
        ))}
      </div>

      {/* Neural Noise Texture */}
      <div className={`absolute inset-0 opacity-[0.03] mix-blend-overlay ${isDarkMode ? 'invert' : ''}`} 
           style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />
      
      {/* Volumetric Glow */}
      <div className={`absolute -top-[20%] left-1/2 h-[60%] w-[120%] -translate-x-1/2 rounded-[100%] blur-[120px] ${
        isDarkMode ? 'bg-indigo-600/10' : 'bg-indigo-300/20'
      }`} />
    </div>
  );
};

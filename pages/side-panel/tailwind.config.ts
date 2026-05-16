import baseConfig from '@extension/tailwindcss-config';
import type { Config } from 'tailwindcss/types/config';

export default {
  ...baseConfig,
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'Inter', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
      },
      colors: {
        obsidian: {
          DEFAULT: '#020617',
          muted: '#1e293b',
          accent: '#38bdf8',
          violet: '#8b5cf6',
        },
        luminous: {
          DEFAULT: '#F8FAFC',
          muted: '#64748B',
          accent: '#4F46E5',
          violet: '#8B5CF6',
          surface: '#FFFFFF',
        },
        webgenie: {
          bg: '#060b16',
          surface: '#0c1525',
          cyan: '#38bdf8',
          violet: '#818cf8',
          text: '#e8f1ff',
          sub: '#7a95bc',
          muted: '#344a68',
          green: '#34d399',
          amber: '#fbbf24',
        }
      },
      backgroundImage: {
        'glass-gradient-dark': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 100%)',
        'radial-glow-dark': 'radial-gradient(circle at center, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
        'glass-gradient-light': 'linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.4) 100%)',
        'radial-glow-light': 'radial-gradient(circle at center, rgba(79, 70, 229, 0.08) 0%, transparent 70%)',
      },
      keyframes: {
        progress: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        orbit: {
          from: { transform: 'rotate(0deg) translateX(120px) rotate(0deg)' },
          to: { transform: 'rotate(360deg) translateX(120px) rotate(-360deg)' },
        },
        'pulse-gentle': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.05)', opacity: '1' },
        },
        drift: {
          from: { transform: 'translate(0,0)' },
          to: { transform: 'translate(25px, 18px)' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        breathe: {
          '0%,100%': { 'box-shadow': '0 0 0 6px rgba(56,189,248,0.04), 0 0 24px rgba(56,189,248,0.22), inset 0 0 18px rgba(56,189,248,0.10)' },
          '50%': { 'box-shadow': '0 0 0 8px rgba(56,189,248,0.06), 0 0 38px rgba(56,189,248,0.32), inset 0 0 24px rgba(56,189,248,0.16)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        'orbit-x': {
          '0%, 100%': { transform: 'translateX(-130px)' },
          '50%': { transform: 'translateX(130px)' },
        },
        'orbit-y': {
          '0%, 100%': { transform: 'translateY(0)' },
          '25%': { transform: 'translateY(-40px)' },
          '50%': { transform: 'translateY(0)' },
          '75%': { transform: 'translateY(40px)' },
        },
        'float-capsule': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-4px) rotate(1deg)' },
        },
        moveHorizontal: {
          "0%": {
            transform: "translateX(-50%) translateY(-10%)",
          },
          "50%": {
            transform: "translateX(50%) translateY(10%)",
          },
          "100%": {
            transform: "translateX(-50%) translateY(-10%)",
          },
        },
        moveInCircle: {
          "0%": {
            transform: "rotate(0deg)",
          },
          "50%": {
            transform: "rotate(180deg)",
          },
          "100%": {
            transform: "rotate(360deg)",
          },
        },
        moveVertical: {
          "0%": {
            transform: "translateY(-50%)",
          },
          "50%": {
            transform: "translateY(50%)",
          },
          "100%": {
            transform: "translateY(-50%)",
          },
        },
      },
      animation: {
        progress: 'progress 1.5s infinite ease-in-out',
        orbit: 'orbit 10s linear infinite',
        'pulse-gentle': 'pulse-gentle 4s ease-in-out infinite',
        drift: 'drift 14s ease-in-out infinite alternate',
        'drift-reverse': 'drift 18s ease-in-out infinite alternate-reverse',
        rise: 'rise 0.55s cubic-bezier(0.16,1,0.3,1) both',
        breathe: 'breathe 4s ease-in-out infinite',
        shimmer: 'shimmer 6s linear infinite',
        'orbit-x': 'orbit-x 15s ease-in-out infinite',
        'orbit-y': 'orbit-y 15s ease-in-out infinite',
        'float-capsule': 'float-capsule 3s ease-in-out infinite',
        first: "moveVertical 30s ease infinite",
        second: "moveInCircle 20s reverse infinite",
        third: "moveInCircle 40s linear infinite",
        fourth: "moveHorizontal 40s ease infinite",
        fifth: "moveInCircle 20s ease infinite",
      },

    },
  },
} as Config;

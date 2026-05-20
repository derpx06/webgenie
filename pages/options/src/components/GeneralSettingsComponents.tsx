import React from 'react';

interface ToggleProps {
  title: string;
  desc: string;
  checked: boolean;
  isDarkMode: boolean;
  onChange: (checked: boolean) => void;
}

export const SettingToggle: React.FC<ToggleProps> = ({ title, desc, checked, isDarkMode, onChange }) => (
  <div className={`group relative flex items-center justify-between gap-6 border-b px-8 py-6 transition-all duration-300 last:border-0 ${
    isDarkMode ? 'border-white/5 hover:bg-white/[0.02]' : 'border-slate-100 hover:bg-slate-50'
  }`}>
    <div className="flex-1">
      <div className="flex items-center gap-3">
        {checked && <div className="size-1.5 animate-pulse rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,1)]"></div>}
        <h3 className={`font-outfit text-[14px] font-black uppercase tracking-wider ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
          {title}
        </h3>
      </div>
      <p className={`mt-1 text-[12px] font-medium leading-relaxed opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
        {desc}
      </p>
    </div>
    <div className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className={`peer h-6 w-11 rounded-full border transition-all duration-300 after:absolute 
        after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full 
        peer-focus:outline-none
        ${isDarkMode ? 'border-white/10 bg-white/5 after:bg-[#818cf8] peer-checked:bg-indigo-500' : 'border-slate-200 bg-slate-200 after:bg-white peer-checked:bg-indigo-600'} 
        peer-checked:after:border-white peer-checked:after:bg-white`}>
      </div>
    </div>
  </div>
);

interface InputProps {
  title: string;
  desc: string;
  value: number;
  isDarkMode: boolean;
  onChange: (val: number) => void;
  min: number;
  max: number;
  step?: number;
}

export const SettingInput: React.FC<InputProps> = ({ title, desc, value, isDarkMode, onChange, min, max, step = 1 }) => (
  <div className={`group relative flex items-center justify-between gap-6 border-b px-8 py-6 transition-all duration-300 last:border-0 ${
    isDarkMode ? 'border-white/5 hover:bg-white/[0.02]' : 'border-slate-100 hover:bg-slate-50'
  }`}>
    <div className="flex-1">
      <h3 className={`font-outfit text-[14px] font-black uppercase tracking-wider ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
        {title}
      </h3>
      <p className={`mt-1 text-[12px] font-medium leading-relaxed opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
        {desc}
      </p>
    </div>
    <div className="flex items-center gap-3">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className={`w-24 rounded-xl border px-3 py-2 text-center font-mono text-[14px] font-black transition-all duration-300 focus:outline-none
          ${isDarkMode ? 'border-white/10 bg-white/5 text-white focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20'
            : 'border-slate-200 bg-white text-slate-900 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10'}`}
      />
    </div>
  </div>
);

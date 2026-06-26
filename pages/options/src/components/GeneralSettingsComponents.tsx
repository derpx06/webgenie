import React from 'react';

interface ToggleProps {
  title: string;
  desc: string;
  checked: boolean;
  isDarkMode: boolean;
  onChange: (checked: boolean) => void;
  severity?: 'caution' | 'dangerous';
}

export const SettingToggle: React.FC<ToggleProps> = ({
  title,
  desc,
  checked,
  isDarkMode,
  onChange,
  severity,
}) => {
  // Determine on track color based on severity
  let onTrackClass = 'bg-[#7C3AED]';
  if (severity === 'caution') {
    onTrackClass = 'bg-[#F59E0B]';
  } else if (severity === 'dangerous') {
    onTrackClass = 'bg-[#F43F5E]';
  }

  return (
    <div className={`group relative flex items-center justify-between gap-6 border-b px-8 py-6 transition-all duration-300 last:border-0 ${
      isDarkMode ? 'border-white/5 hover:bg-white/[0.02]' : 'border-slate-100 hover:bg-slate-50'
    }`}>
      <div className="flex-1">
        <div className="flex items-center gap-3">
          {severity === 'caution' && <div className="size-1.5 rounded-full bg-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.6)]"></div>}
          {severity === 'dangerous' && <div className="size-1.5 rounded-full bg-[#F43F5E] shadow-[0_0_8px_rgba(244,63,94,0.6)]"></div>}
          <h3 className={`font-sans text-[14px] font-semibold tracking-normal ${
            severity === 'dangerous' ? 'text-[#F43F5E]' : isDarkMode ? 'text-slate-200' : 'text-slate-800'
          }`}>
            {severity === 'dangerous' && <span className="mr-1 text-[#F43F5E]">DANGEROUS:</span>}
            {title}
            {severity === 'caution' && (
              <span className="ml-2 rounded border border-[#F59E0B]/20 bg-[#F59E0B]/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#F59E0B]">
                Caution
              </span>
            )}
          </h3>
        </div>
        <p className={`mt-1 text-[12px] font-medium leading-relaxed opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          {desc}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className="relative inline-flex shrink-0 cursor-pointer items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
      >
        <span className={`h-6 w-11 rounded-full border transition-all duration-300 after:absolute
          after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:transition-all after:content-['']
          ${isDarkMode ? 'border-white/10 bg-white/5 after:bg-white' : 'border-slate-200 bg-slate-200 after:bg-white'}
          ${checked ? `after:translate-x-full ${onTrackClass}` : ''}
          after:transition-transform`}>
        </span>
      </button>
    </div>
  );
};

interface StepperInputProps {
  title: string;
  desc: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  isDarkMode: boolean;
  severity?: 'caution' | 'dangerous';
}

export const SettingStepperInput: React.FC<StepperInputProps> = ({
  title,
  desc,
  value,
  min,
  max,
  onChange,
  isDarkMode,
  severity,
}) => {
  const handleDecrement = (e: React.MouseEvent) => {
    e.preventDefault();
    if (value > min) onChange(value - 1);
  };
  const handleIncrement = (e: React.MouseEvent) => {
    e.preventDefault();
    if (value < max) onChange(value + 1);
  };

  return (
    <div className={`flex items-center justify-between gap-6 border-b px-8 py-6 transition-all duration-300 last:border-0 ${
      isDarkMode ? 'border-white/5 hover:bg-white/[0.02]' : 'border-slate-100 hover:bg-slate-50'
    }`}>
      <div className="flex-1">
        <div className="flex items-center gap-3">
          {severity === 'caution' && <div className="size-1.5 rounded-full bg-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.6)]"></div>}
          {severity === 'dangerous' && <div className="size-1.5 rounded-full bg-[#F43F5E] shadow-[0_0_8px_rgba(244,63,94,0.6)]"></div>}
          <h3 className={`font-sans text-[14px] font-semibold tracking-normal ${
            severity === 'dangerous' ? 'text-[#F43F5E]' : isDarkMode ? 'text-slate-200' : 'text-slate-800'
          }`}>
            {severity === 'dangerous' && <span className="mr-1 text-[#F43F5E]">DANGEROUS:</span>}
            {title}
            {severity === 'caution' && (
              <span className="ml-2 rounded border border-[#F59E0B]/20 bg-[#F59E0B]/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#F59E0B]">
                Caution
              </span>
            )}
          </h3>
        </div>
        <p className={`mt-1 text-[12px] font-medium leading-relaxed opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          {desc}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={value <= min}
          className={`flex size-8 items-center justify-center rounded-lg border text-sm font-black transition-all ${
            isDarkMode 
              ? 'border-white/10 bg-white/5 text-white hover:border-white/20 hover:bg-white/10 disabled:opacity-30' 
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-30'
          }`}
        >
          -
        </button>
        <div className={`flex h-8 min-w-14 items-center justify-center rounded-lg border px-2 text-center font-mono text-[13px] font-bold transition-all ${
          isDarkMode 
            ? 'border-white/10 bg-[#0B0C12] text-[#F2F3F7]' 
            : 'border-slate-200 bg-slate-50 text-slate-900'
        }`}>
          {value}
        </div>
        <button
          type="button"
          onClick={handleIncrement}
          disabled={value >= max}
          className={`flex size-8 items-center justify-center rounded-lg border text-sm font-black transition-all ${
            isDarkMode 
              ? 'border-white/10 bg-white/5 text-white hover:border-white/20 hover:bg-white/10 disabled:opacity-30' 
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-30'
          }`}
        >
          +
        </button>
      </div>
    </div>
  );
};

interface InlineUnitInputProps {
  title: string;
  desc: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  isDarkMode: boolean;
  severity?: 'caution' | 'dangerous';
}

export const SettingInlineUnitInput: React.FC<InlineUnitInputProps> = ({
  title,
  desc,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
  isDarkMode,
  severity,
}) => {
  return (
    <div className={`flex items-center justify-between gap-6 border-b px-8 py-6 transition-all duration-300 last:border-0 ${
      isDarkMode ? 'border-white/5 hover:bg-white/[0.02]' : 'border-slate-100 hover:bg-slate-50'
    }`}>
      <div className="flex-1">
        <div className="flex items-center gap-3">
          {severity === 'caution' && <div className="size-1.5 rounded-full bg-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.6)]"></div>}
          {severity === 'dangerous' && <div className="size-1.5 rounded-full bg-[#F43F5E] shadow-[0_0_8px_rgba(244,63,94,0.6)]"></div>}
          <h3 className={`font-sans text-[14px] font-semibold tracking-normal ${
            severity === 'dangerous' ? 'text-[#F43F5E]' : isDarkMode ? 'text-slate-200' : 'text-slate-800'
          }`}>
            {severity === 'dangerous' && <span className="mr-1 text-[#F43F5E]">DANGEROUS:</span>}
            {title}
            {severity === 'caution' && (
              <span className="ml-2 rounded border border-[#F59E0B]/20 bg-[#F59E0B]/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#F59E0B]">
                Caution
              </span>
            )}
          </h3>
        </div>
        <p className={`mt-1 text-[12px] font-medium leading-relaxed opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          {desc}
        </p>
      </div>

      <div className="flex items-center">
        <div className={`relative flex items-center rounded-lg border transition-all duration-300 focus-within:border-[#7C3AED] focus-within:ring-1 focus-within:ring-[#7C3AED]/20 ${
          isDarkMode 
            ? 'border-white/10 bg-[#0B0C12] hover:border-white/20' 
            : 'border-slate-200 bg-white hover:border-slate-300'
        }`}>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={e => onChange(parseInt(e.target.value, 10) || min)}
            className={`w-20 border-none bg-transparent py-1.5 pl-3 pr-1 text-right font-mono text-[13px] font-bold outline-none focus:ring-0 ${
              isDarkMode ? 'text-[#F2F3F7]' : 'text-slate-900'
            }`}
          />
          <span className={`select-none pl-1 pr-3 font-mono text-[11px] font-bold tracking-tight opacity-40 ${
            isDarkMode ? 'text-slate-300' : 'text-slate-700'
          }`}>
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
};

export interface TextInputProps {
  title: string;
  desc: string;
  value: string;
  placeholder?: string;
  isDarkMode: boolean;
  onChange: (val: string) => void;
  isSecret?: boolean;
}

export const SettingTextInput: React.FC<TextInputProps> = ({
  title,
  desc,
  value,
  placeholder = '',
  isDarkMode,
  onChange,
  isSecret = false,
}) => (
  <div className={`flex items-center justify-between gap-6 border-b px-8 py-6 transition-all duration-300 last:border-0 ${
    isDarkMode ? 'border-white/5 hover:bg-white/[0.02]' : 'border-slate-100 hover:bg-slate-50'
  }`}>
    <div className="flex-1">
      <h3 className={`font-sans text-[14px] font-semibold tracking-normal ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
        {title}
      </h3>
      <p className={`mt-1 text-[12px] font-medium leading-relaxed opacity-60 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
        {desc}
      </p>
    </div>
    <div className="flex w-64 items-center">
      <input
        type={isSecret ? 'password' : 'text'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full rounded-xl border px-3.5 py-2.5 font-mono text-[13px] font-medium transition-all duration-300 focus:border-[#7C3AED] focus:outline-none focus:ring-1 focus:ring-[#7C3AED]/20
          ${isDarkMode ? 'border-white/10 bg-[#0B0C12] text-white placeholder:text-white/20'
            : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-300'}`}
      />
    </div>
  </div>
);
